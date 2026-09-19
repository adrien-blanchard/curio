import { z } from "zod";

import { ApiError, apiErrorResponse, apiSuccess, mapDatabaseError, parseJsonBody } from "@/lib/api";
import { authenticateRequest, type AuthenticatedActor } from "@/lib/auth";
import {
  MAX_THUMBNAIL_INPUT_BYTES,
  ThumbnailError,
  createThumbnailWebp,
  getThumbnailObjectPath,
  getThumbnailUploadObjectPath,
} from "@/lib/images/thumbnails";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const STAGING_BUCKET = "thumbnail_uploads";
const FINAL_BUCKET = "thumbnails";
const MAX_STAGING_OBJECTS_TO_CLEAN = 100;
const STAGING_UPLOAD_RETENTION_MS = 60 * 60 * 1_000;
const acceptedContentTypeSchema = z.enum(["image/jpeg", "image/png", "image/webp"]);
const parametersSchema = z.object({ id: z.uuid() });
const requestSchema = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("prepare"),
    contentType: acceptedContentTypeSchema,
    fileSize: z.number().int().positive().max(MAX_THUMBNAIL_INPUT_BYTES),
  }),
  z.strictObject({
    action: z.literal("finalize"),
    uploadPath: z
      .string()
      .regex(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.upload$/,
      ),
  }),
]);
const entrySchema = z.object({
  id: z.uuid(),
  created_by: z.uuid().nullable(),
  status: z.enum(["ready", "failed"]),
});
const thumbnailReplacementSchema = z.object({
  id: z.uuid(),
  thumbnail_path: z.string(),
  previous_thumbnail_path: z.string().nullable(),
});
type ThumbnailReplacement = z.infer<typeof thumbnailReplacementSchema>;
const attachedThumbnailSchema = z.object({
  id: z.uuid(),
  thumbnail_path: z.string().nullable(),
});

function thumbnailApiError(error: ThumbnailError): ApiError {
  if (error.code === "IMAGE_TOO_LARGE") {
    return new ApiError(413, error.code, error.message);
  }
  return new ApiError(400, error.code, error.message);
}

async function requireEntryOwner(actor: AuthenticatedActor, entryId: string) {
  const { data, error } = await actor.supabase
    .from("entries")
    .select("id, created_by, status")
    .eq("id", entryId)
    .maybeSingle();
  if (error) {
    throw mapDatabaseError(error, "ENTRY_READ_FAILED", "The entry could not be loaded");
  }

  const entry = entrySchema.safeParse(data);
  if (!entry.success) {
    throw new ApiError(404, "ENTRY_NOT_FOUND", "The entry was not found or is not editable");
  }
  if (actor.role !== "administrator" && entry.data.created_by !== actor.user.id) {
    throw new ApiError(403, "ENTRY_FORBIDDEN", "You cannot modify this entry");
  }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = parametersSchema.parse(await context.params);
    const actor = await authenticateRequest(request, {
      roles: ["contributor", "administrator"],
      allowApiToken: false,
      requireCsrf: true,
    });
    const input = await parseJsonBody(request, requestSchema);
    await requireEntryOwner(actor, id);
    const backend = createServiceRoleClient();

    if (input.action === "prepare") {
      const { error: reservationError } = await backend.rpc("reserve_thumbnail_upload", {
        p_actor_user_id: actor.user.id,
        p_entry_id: id,
      });
      if (reservationError) {
        const mapped = mapDatabaseError(
          reservationError,
          "THUMBNAIL_UPLOAD_PREPARE_FAILED",
          "The private upload could not be prepared",
        );
        if (mapped.code === "RATE_LIMIT_EXCEEDED") {
          throw new ApiError(
            429,
            mapped.code,
            "No more than five thumbnail uploads may be prepared every ten minutes",
          );
        }
        throw mapped;
      }

      const staging = backend.storage.from(STAGING_BUCKET);
      const { data: existingUploads, error: listError } = await staging.list(id, {
        limit: MAX_STAGING_OBJECTS_TO_CLEAN,
        sortBy: { column: "created_at", order: "asc" },
      });
      if (listError) {
        throw new ApiError(
          503,
          "THUMBNAIL_STAGING_UNAVAILABLE",
          "The private upload area is temporarily unavailable",
        );
      }
      const staleCutoff = Date.now() - STAGING_UPLOAD_RETENTION_MS;
      const stalePaths = (existingUploads ?? [])
        .filter((object) => {
          // A second tab or administrator may still be finalizing a recent upload.
          // Missing or invalid timestamps are not evidence that deletion is safe.
          const createdAt = Date.parse(object.created_at ?? "");
          return Number.isFinite(createdAt) && createdAt <= staleCutoff;
        })
        .map((object) => object.name)
        .filter((name) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]upload$/.test(
            name,
          ),
        )
        .map((name) => `${id}/${name}`);
      if (stalePaths.length > 0) {
        const { error: cleanupError } = await staging.remove(stalePaths);
        if (cleanupError) {
          throw new ApiError(
            503,
            "THUMBNAIL_STAGING_UNAVAILABLE",
            "The private upload area could not be reconciled",
          );
        }
      }

      const uploadPath = getThumbnailUploadObjectPath(id);
      const { data, error } = await staging.createSignedUploadUrl(uploadPath, { upsert: false });
      if (error || !data?.token) {
        throw new ApiError(
          500,
          "THUMBNAIL_UPLOAD_PREPARE_FAILED",
          "The private upload could not be prepared",
        );
      }

      return apiSuccess(
        {
          upload: {
            bucket: STAGING_BUCKET,
            path: uploadPath,
            token: data.token,
            contentType: input.contentType,
            maximumBytes: MAX_THUMBNAIL_INPUT_BYTES,
          },
        },
        { status: 201, headers: { "Cache-Control": "no-store" } },
      );
    }

    if (!input.uploadPath.startsWith(`${id}/`)) {
      throw new ApiError(400, "INVALID_UPLOAD_PATH", "The private upload path is invalid");
    }

    try {
      const { data: stagedFile, error: downloadError } = await backend.storage
        .from(STAGING_BUCKET)
        .download(input.uploadPath);
      if (downloadError || !stagedFile) {
        throw new ApiError(400, "UPLOAD_NOT_FOUND", "The private upload was not found");
      }
      if (stagedFile.size === 0 || stagedFile.size > MAX_THUMBNAIL_INPUT_BYTES) {
        throw new ApiError(
          stagedFile.size > MAX_THUMBNAIL_INPUT_BYTES ? 413 : 400,
          stagedFile.size > MAX_THUMBNAIL_INPUT_BYTES ? "IMAGE_TOO_LARGE" : "INVALID_IMAGE",
          stagedFile.size > MAX_THUMBNAIL_INPUT_BYTES
            ? "The image exceeds the 5 MiB upload limit"
            : "The image file is empty",
        );
      }

      let thumbnail;
      try {
        thumbnail = await createThumbnailWebp(Buffer.from(await stagedFile.arrayBuffer()));
      } catch (error) {
        if (error instanceof ThumbnailError) throw thumbnailApiError(error);
        throw error;
      }

      const objectPath = getThumbnailObjectPath(id);
      const { error: uploadError } = await backend.storage
        .from(FINAL_BUCKET)
        .upload(objectPath, thumbnail.buffer, {
          contentType: thumbnail.contentType,
          cacheControl: "31536000, immutable",
          upsert: false,
        });
      if (uploadError) {
        throw new ApiError(500, "THUMBNAIL_UPLOAD_FAILED", "The thumbnail could not be stored");
      }

      const { data: replacementData, error: updateError } = await backend
        .rpc("replace_entry_thumbnail", {
          p_actor_user_id: actor.user.id,
          p_entry_id: id,
          p_thumbnail_path: objectPath,
        })
        .maybeSingle();
      let replacement: ThumbnailReplacement;
      if (updateError || !replacementData) {
        // A network error can arrive after PostgreSQL committed the RPC. Read the
        // authoritative row before compensating, otherwise deleting objectPath
        // could break a thumbnail that is already attached.
        const { data: currentData, error: reconciliationError } = await backend
          .from("entries")
          .select("id, thumbnail_path")
          .eq("id", id)
          .maybeSingle();
        const current = attachedThumbnailSchema.safeParse(currentData);
        if (current.success && current.data.thumbnail_path === objectPath) {
          replacement = {
            id: current.data.id,
            thumbnail_path: objectPath,
            previous_thumbnail_path: null,
          };
          console.warn("[storage] Thumbnail attachment acknowledgement was reconciled", {
            entryId: id,
          });
        } else if (reconciliationError) {
          // Preserve the object while commit state is unknown. A bounded operator
          // reconciliation may remove an orphan; deleting here risks data loss.
          throw new ApiError(
            503,
            "THUMBNAIL_RECONCILIATION_REQUIRED",
            "The thumbnail attachment result could not be confirmed. Retry shortly",
          );
        } else {
          await backend.storage.from(FINAL_BUCKET).remove([objectPath]);
          if (updateError) {
            throw mapDatabaseError(
              updateError,
              "THUMBNAIL_UPDATE_FAILED",
              "The thumbnail could not be attached to the entry",
            );
          }
          throw new ApiError(403, "ENTRY_FORBIDDEN", "You cannot modify this entry");
        }
      } else {
        replacement = thumbnailReplacementSchema.parse(replacementData);
      }

      if (
        replacement.previous_thumbnail_path &&
        replacement.previous_thumbnail_path !== objectPath
      ) {
        const { error: cleanupError } = await backend.storage
          .from(FINAL_BUCKET)
          .remove([replacement.previous_thumbnail_path]);
        if (cleanupError) {
          console.error("[storage] Unable to remove replaced thumbnail", { entryId: id });
        }
      }

      const { data: signed, error: signedUrlError } = await backend.storage
        .from(FINAL_BUCKET)
        .createSignedUrl(objectPath, 15 * 60);
      if (signedUrlError) {
        throw new ApiError(
          500,
          "THUMBNAIL_SIGN_FAILED",
          "The thumbnail was stored but its preview could not be created",
        );
      }

      return apiSuccess(
        { id, thumbnailUrl: signed.signedUrl },
        { headers: { "Cache-Control": "no-store" } },
      );
    } finally {
      const { error: cleanupError } = await backend.storage
        .from(STAGING_BUCKET)
        .remove([input.uploadPath]);
      if (cleanupError) {
        console.error("[storage] Unable to remove private thumbnail upload", { entryId: id });
      }
    }
  } catch (error) {
    return apiErrorResponse(error);
  }
}
