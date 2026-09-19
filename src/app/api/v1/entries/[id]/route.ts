import { z } from "zod";
import { isValidSourceDate, SOURCE_DATE_KINDS } from "@/lib/ui/source-age";

import { apiErrorResponse, apiSuccess, mapDatabaseError, parseJsonBody } from "@/lib/api";
import { authenticateRequest } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

const parametersSchema = z.object({ id: z.uuid() });
const updateSchema = z
  .strictObject({
    title: z.string().trim().min(3).max(100).optional(),
    tldr: z.string().trim().min(30).max(800).optional(),
    sourceType: z.enum(["opensource", "proprietary"]).optional(),
    sourcePublishedAt: z
      .string()
      .refine(
        (value) => isValidSourceDate(value),
        "Use a valid source date that is not in the future",
      )
      .nullable()
      .optional(),
    sourceDateKind: z.enum(SOURCE_DATE_KINDS).nullable().optional(),
    tagIds: z
      .array(z.uuid())
      .max(10)
      .transform((values) => [...new Set(values)])
      .optional(),
  })
  .refine(
    (value) => {
      const hasDate = Object.hasOwn(value, "sourcePublishedAt");
      const hasKind = Object.hasOwn(value, "sourceDateKind");
      return (
        hasDate === hasKind &&
        (!hasDate || (value.sourcePublishedAt === null) === (value.sourceDateKind === null))
      );
    },
    { message: "Provide source date and its type together, or clear both" },
  )
  .refine((value) => Object.keys(value).length > 0, {
    message: "Provide at least one field to update",
  });
const updatedEntrySchema = z.object({
  id: z.uuid(),
  title: z.string(),
  tldr: z.string(),
  source_type: z.enum(["opensource", "proprietary"]),
  status: z.enum(["ready", "failed"]),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = parametersSchema.parse(await context.params);
    const actor = await authenticateRequest(request, {
      roles: ["contributor", "administrator"],
      allowApiToken: false,
      requireCsrf: true,
    });
    const input = await parseJsonBody(request, updateSchema);
    const { data, error } = await actor.supabase.rpc("update_entry", {
      p_actor_user_id: actor.user.id,
      p_entry_id: id,
      p_title: input.title ?? null,
      p_tldr: input.tldr ?? null,
      p_source_type: input.sourceType ?? null,
      p_tag_ids: input.tagIds ?? null,
      ...(Object.hasOwn(input, "sourcePublishedAt")
        ? {
            p_update_source_date: true,
            p_source_published_at: input.sourcePublishedAt ?? null,
            p_source_date_kind: input.sourceDateKind ?? null,
          }
        : {}),
    });
    if (error) {
      throw mapDatabaseError(error, "ENTRY_UPDATE_FAILED", "The entry could not be updated");
    }
    const entry = updatedEntrySchema.parse(Array.isArray(data) ? data[0] : data);
    return apiSuccess(
      {
        id: entry.id,
        title: entry.title,
        tldr: entry.tldr,
        sourceType: entry.source_type,
        status: entry.status,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = parametersSchema.parse(await context.params);
    const actor = await authenticateRequest(request, {
      roles: ["contributor", "administrator"],
      allowApiToken: false,
      requireCsrf: true,
    });

    const { data: deletedThumbnailPath, error: deleteError } = await actor.supabase.rpc(
      "delete_entry",
      {
        p_actor_user_id: actor.user.id,
        p_entry_id: id,
      },
    );
    if (deleteError) {
      throw mapDatabaseError(deleteError, "ENTRY_DELETE_FAILED", "The entry could not be deleted");
    }

    let thumbnailCleanupPending = false;
    if (deletedThumbnailPath) {
      const backend = createServiceRoleClient();
      const { error: storageError } = await backend.storage
        .from("thumbnails")
        .remove([deletedThumbnailPath]);
      if (storageError) {
        thumbnailCleanupPending = true;
        console.error("[storage] Deleted entry left a private thumbnail for later cleanup", {
          entryId: id,
        });
      }
    }

    return apiSuccess({ id, deleted: true, thumbnailCleanupPending });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
