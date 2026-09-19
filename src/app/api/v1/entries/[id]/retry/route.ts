import { start } from "workflow/api";
import { z } from "zod";

import {
  ApiError,
  apiErrorResponse,
  apiSuccess,
  extensionPreflight,
  extensionResponse,
  mapDatabaseError,
  prepareExtensionResponse,
} from "@/lib/api";
import { authenticateRequest } from "@/lib/auth";
import { markWorkflowDispatchFailed } from "@/lib/workflows/dispatch";
import { processEntryWorkflow } from "@/workflows/process-entry";

const methods = ["POST", "OPTIONS"] as const;
const parametersSchema = z.object({ id: z.uuid() });
const queuedEntrySchema = z.object({
  id: z.uuid(),
  status: z.literal("queued"),
  dispatch_required: z.boolean(),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let corsHeaders = new Headers();
  try {
    corsHeaders = prepareExtensionResponse(request, methods);
    const { id } = parametersSchema.parse(await context.params);
    const actor = await authenticateRequest(request, {
      roles: ["contributor", "administrator"],
      scopes: ["entries:write"],
      requireCsrf: true,
    });
    const result =
      actor.mode === "api_token"
        ? await actor.supabase.rpc("retry_entry_with_token", {
            p_token_hash: actor.tokenHash,
            p_entry_id: id,
          })
        : await actor.supabase.rpc("retry_entry", {
            p_actor_user_id: actor.user.id,
            p_entry_id: id,
          });

    if (result.error) {
      throw mapDatabaseError(result.error, "ENTRY_RETRY_FAILED", "The entry could not be retried");
    }
    const entry = queuedEntrySchema.parse(
      Array.isArray(result.data) ? result.data[0] : result.data,
    );

    if (entry.dispatch_required) {
      try {
        await start(processEntryWorkflow, [entry.id]);
      } catch {
        await markWorkflowDispatchFailed(entry.id);
        console.error("[workflow] Unable to restart entry processing", {
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
