import "server-only";

import { getRun } from "workflow/api";
import { z } from "zod";

import { withTimeout } from "@/lib/http/fetch-with-timeout";
import { createServiceRoleClient } from "@/lib/supabase/server";

export const PROCESSING_TIMEOUT_MS = 15 * 60 * 1_000;
const MINIMUM_SWEEP_INTERVAL_MS = 15 * 1_000;
const DASHBOARD_SWEEP_DEADLINE_MS = 5 * 1_000;
const PROVIDER_CANCEL_DEADLINE_MS = 2 * 1_000;

const expiredEntrySchema = z.object({
  entry_id: z.uuid(),
  attempt_id: z.uuid().nullable(),
  workflow_run_id: z.string().min(1).nullable(),
  expired_at: z.string(),
});

export type ProcessingRecoveryResult = {
  expired: number;
  cancellationFailures: number;
};

let lastSuccessfulSweepAt = 0;
let activeSweep: Promise<ProcessingRecoveryResult> | null = null;

async function runRecoverySweep(now: number): Promise<ProcessingRecoveryResult> {
  const cutoff = new Date(now - PROCESSING_TIMEOUT_MS).toISOString();
  const { data, error } = await withTimeout(
    createServiceRoleClient().rpc("expire_stale_entry_processing", {
      p_cutoff: cutoff,
    }),
    {
      timeoutMs: DASHBOARD_SWEEP_DEADLINE_MS,
      timeoutMessage: "The stale processing recovery sweep timed out.",
    },
  );

  if (error) {
    throw new Error("Stale processing recovery failed.");
  }

  const expiredEntries = z.array(expiredEntrySchema).parse(data ?? []);
  let cancellationFailures = 0;

  await Promise.all(
    expiredEntries.map(async ({ workflow_run_id: workflowRunId }) => {
      if (!workflowRunId) return;
      try {
        await withTimeout(getRun(workflowRunId).cancel(), {
          timeoutMs: PROVIDER_CANCEL_DEADLINE_MS,
          timeoutMessage: "The workflow cancellation request timed out.",
        });
      } catch {
        // The database fence is authoritative. Provider cancellation is only a
        // cost-saving best effort because an in-flight model call may not stop.
        cancellationFailures += 1;
      }
    }),
  );

  lastSuccessfulSweepAt = now;
  return { expired: expiredEntries.length, cancellationFailures };
}

/**
 * Fence stale processing in the database before asking the workflow provider
 * to cancel any associated runs. Calls are coalesced per server instance; the
 * database function remains idempotent across instances.
 */
export async function recoverStaleEntryProcessing(options?: {
  force?: boolean;
  now?: number;
}): Promise<ProcessingRecoveryResult> {
  const now = options?.now ?? Date.now();
  if (!options?.force && now - lastSuccessfulSweepAt < MINIMUM_SWEEP_INTERVAL_MS) {
    return { expired: 0, cancellationFailures: 0 };
  }
  if (activeSweep) return activeSweep;

  activeSweep = runRecoverySweep(now).finally(() => {
    activeSweep = null;
  });
  return activeSweep;
}

/** Keep dashboard reads available if operational recovery itself is unavailable. */
export async function recoverStaleEntryProcessingBestEffort(): Promise<void> {
  try {
    const result = await recoverStaleEntryProcessing();
    if (result.cancellationFailures > 0) {
      console.error("[workflow] Some expired runs could not be cancelled", {
        count: result.cancellationFailures,
      });
    }
  } catch {
    console.error("[workflow] Stale processing recovery sweep failed");
  }
}
