import "server-only";

import { createServiceRoleClient } from "@/lib/supabase/server";

/**
 * Move a queued entry to a retryable failed state when the durable workflow
 * could not be dispatched. The database function owns transition validation
 * and remains idempotent for a repeated dispatch failure.
 */
export async function markWorkflowDispatchFailed(entryId: string): Promise<void> {
  const { error } = await createServiceRoleClient().rpc("fail_entry_dispatch", {
    p_entry_id: entryId,
    p_error_code: "WORKFLOW_START_FAILED",
    p_error_message: "The durable workflow could not be started.",
  });

  if (error) {
    console.error("[workflow] Unable to record dispatch failure", {
      entryId,
      code: error.code,
    });
  }
}
