import { start } from "workflow/api";
import { z } from "zod";

import {
  ApiError,
  apiErrorResponse,
  apiSuccess,
  extensionPreflight,
  extensionResponse,
  mapDatabaseError,
  parseJsonBody,
  prepareExtensionResponse,
} from "@/lib/api";
import { authenticateRequest } from "@/lib/auth";
import { PublicUrlError, resolvePublicUrl } from "@/lib/security/public-url";
import { markWorkflowDispatchFailed } from "@/lib/workflows/dispatch";
import { processEntryWorkflow } from "@/workflows/process-entry";

const methods = ["POST", "OPTIONS"] as const;
const inputSchema = z.strictObject({
  url: z.string().trim().min(1).max(2_048),
  sourceType: z.enum(["opensource", "proprietary"]),
  tagIds: z
    .array(z.uuid())
    .max(10)
    .default([])
    .transform((values) => [...new Set(values)]),
});
const queuedEntrySchema = z.object({
  id: z.uuid(),
  status: z.enum(["queued", "analyzing", "finalizing", "ready", "failed"]),
  created: z.boolean(),
  dispatch_required: z.boolean(),
});

function publicUrlApiError(error: PublicUrlError): ApiError {
  const status = error.code === "UNRESOLVABLE_HOST" ? 422 : 400;
  return new ApiError(status, error.code, error.message);
}

export async function POST(request: Request) {
  let corsHeaders = new Headers();
  try {
    corsHeaders = prepareExtensionResponse(request, methods);
    const actor = await authenticateRequest(request, {
      roles: ["contributor", "administrator"],
      scopes: ["entries:write"],
      requireCsrf: true,
    });
    const input = await parseJsonBody(request, inputSchema);

    let canonicalUrl: string;
    try {
      canonicalUrl = await resolvePublicUrl(input.url);
    } catch (error) {
      if (error instanceof PublicUrlError) throw publicUrlApiError(error);
      throw error;
    }

    const result =
      actor.mode === "api_token"
        ? await actor.supabase.rpc("submit_entry_with_token", {
            p_token_hash: actor.tokenHash,
            p_url: canonicalUrl,
            p_canonical_url: canonicalUrl,
            p_source_type: input.sourceType,
            p_tag_ids: input.tagIds,
          })
        : await actor.supabase.rpc("submit_entry", {
            p_actor_user_id: actor.user.id,
            p_url: canonicalUrl,
            p_canonical_url: canonicalUrl,
            p_source_type: input.sourceType,
            p_tag_ids: input.tagIds,
          });

    if (result.error) {
      throw mapDatabaseError(
        result.error,
        "ENTRY_SUBMISSION_FAILED",
        "The entry could not be submitted",
      );
    }
    const entry = queuedEntrySchema.parse(
      Array.isArray(result.data) ? result.data[0] : result.data,
    );

    if (entry.dispatch_required) {
      try {
        await start(processEntryWorkflow, [entry.id]);
      } catch {
        await markWorkflowDispatchFailed(entry.id);
        console.error("[workflow] Unable to start entry processing", {
          entryId: entry.id,
        });
        throw new ApiError(
          503,
          "WORKFLOW_START_FAILED",
          "Processing could not be started. Retry the same entry shortly",
          { entryId: entry.id },
        );
      }
    }

    return extensionResponse(
      apiSuccess(
        {
          id: entry.id,
          status: entry.status,
          created: entry.created,
          dispatchRequired: entry.dispatch_required,
        },
        {
          status: 202,
          headers: { "Cache-Control": "no-store" },
        },
      ),
      corsHeaders,
    );
  } catch (error) {
    return extensionResponse(apiErrorResponse(error), corsHeaders);
  }
}

export function OPTIONS(request: Request) {
  try {
    return extensionPreflight(request, methods);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
