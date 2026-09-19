import { FatalError, RetryableError, getStepMetadata, getWorkflowMetadata } from "workflow";

import type { AvailableTag } from "@/lib/ai/schemas";
import { getWorkflowThumbnailObjectPath } from "@/lib/images/workflow-thumbnail-path";
import {
  hasProcessingFailureCode,
  processingTerminalFailureInfo,
  workflowFailureInfo,
} from "@/lib/workflows/errors";

type EntryContext = {
  entryId: string;
  canonicalUrl: string;
  selectedTagIds: string[];
  availableTags: AvailableTag[];
};

type AnalysisPayload = {
  title: string;
  tldr: string;
  suggestedTagSlugs: string[];
  sourcePublishedAt: string | null;
  sourceDateKind: string | null;
};

type Attempt = {
  id: string;
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled";
};

type FinalizationResult = {
  thumbnail_path: string;
  thumbnail_origin: "automatic" | "manual" | "placeholder";
  previous_thumbnail_path: string | null;
  discarded_thumbnail_path: string | null;
};

type WorkflowThumbnailOrigin = "automatic" | "placeholder";

type PreviewFailure = {
  provider: "youtube" | "github" | "microlink" | null;
  code: string;
  attempts: number;
};

type StoredWorkflowThumbnail = {
  path: string;
  origin: WorkflowThumbnailOrigin;
  provider: "youtube" | "github" | "microlink" | null;
  attempts: number;
  failures: PreviewFailure[];
};

type ReconciledProcessingState = {
  committed: boolean;
  terminal: boolean;
  actualThumbnailPath: string | null;
  cleanupPaths: string[];
};

function firstRpcRow<T>(data: unknown, operation: string): T {
  const row = Array.isArray(data) ? data[0] : data;
  if (!row || typeof row !== "object") {
    throw new Error(`${operation} returned no row.`);
  }
  return row as T;
}

function throwProcessingMutationError(error: unknown, message: string): never {
  const terminalFailure = processingTerminalFailureInfo(error);
  if (terminalFailure) {
    throw new FatalError(`${terminalFailure.code}|${terminalFailure.message}`);
  }
  throw new Error(`DATABASE_ERROR|${message}`);
}

function cleanupPaths(
  actualThumbnailPath: string | null,
  ...candidates: Array<string | null | undefined>
): string[] {
  return [
    ...new Set(
      candidates.filter(
        (candidate): candidate is string =>
          typeof candidate === "string" &&
          candidate.length > 0 &&
          candidate !== actualThumbnailPath,
      ),
    ),
  ];
}

async function beginAttempt(entryId: string, workflowRunId: string): Promise<Attempt | null> {
  "use step";

  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const client = createWorkflowServiceRoleClient();
  const { data, error } = await client.rpc("begin_processing_attempt", {
    p_entry_id: entryId,
    p_workflow_run_id: workflowRunId,
  });
  if (error) {
    if (hasProcessingFailureCode(error, "PROCESSING_ATTEMPT_ACTIVE")) return null;
    throwProcessingMutationError(error, "Could not begin processing.");
  }
  return firstRpcRow<Attempt>(data, "begin_processing_attempt");
}
beginAttempt.maxRetries = 5;

async function loadEntryContext(entryId: string): Promise<EntryContext> {
  "use step";

  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const client = createWorkflowServiceRoleClient();
  const [entryResult, tagsResult, selectedResult] = await Promise.all([
    client.from("entries").select("id, canonical_url").eq("id", entryId).single(),
    client.from("tags").select("id, name, slug").order("sort_order"),
    client.from("entry_tags").select("tag_id").eq("entry_id", entryId),
  ]);
  if (entryResult.error || !entryResult.data) {
    throw new FatalError("ENTRY_NOT_FOUND|The entry no longer exists.");
  }
  if (tagsResult.error || selectedResult.error) {
    throw new Error("DATABASE_ERROR|Could not load the organization taxonomy.");
  }
  return {
    entryId: entryResult.data.id,
    canonicalUrl: entryResult.data.canonical_url,
    selectedTagIds: (selectedResult.data ?? []).map(({ tag_id }: { tag_id: string }) => tag_id),
    availableTags: (tagsResult.data ?? []) as AvailableTag[],
  };
}
loadEntryContext.maxRetries = 5;

async function markAnalyzing(entryId: string, attemptId: string): Promise<void> {
  "use step";
  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const { error } = await createWorkflowServiceRoleClient().rpc("mark_entry_analyzing", {
    p_entry_id: entryId,
    p_attempt_id: attemptId,
  });
  if (error) {
    throwProcessingMutationError(error, "Could not mark analysis started.");
  }
}
markAnalyzing.maxRetries = 5;

async function updateProcessingHeartbeat(entryId: string, attemptId: string): Promise<void> {
  "use step";

  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const { error } = await createWorkflowServiceRoleClient().rpc("update_processing_heartbeat", {
    p_entry_id: entryId,
    p_attempt_id: attemptId,
  });
  if (error) {
    throwProcessingMutationError(error, "Could not refresh the processing heartbeat.");
  }
}
updateProcessingHeartbeat.maxRetries = 5;

async function analyzeEntry(context: EntryContext): Promise<AnalysisPayload> {
  "use step";

  const [{ GeminiAnalysisError, analyzePublicResource }, { getServerEnv }] = await Promise.all([
    import("@/lib/ai/gemini"),
    import("@/lib/env/server"),
  ]);
  const env = getServerEnv();
  try {
    const result = await analyzePublicResource({
      url: context.canonicalUrl,
      tags: context.availableTags,
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_MODEL,
    });
    return {
      title: result.title,
      tldr: result.tldr,
      suggestedTagSlugs: result.suggested_tag_slugs,
      sourcePublishedAt: result.source_published_at ?? null,
      sourceDateKind: result.source_date_kind ?? null,
    };
  } catch (error) {
    if (error instanceof GeminiAnalysisError) {
      if (!error.retryable) throw new FatalError(`${error.code}|${error.message}`);
      const attempt = getStepMetadata().attempt;
      throw new RetryableError(`${error.code}|${error.message}`, {
        retryAfter: Math.min(60_000, 1_000 * 2 ** Math.max(0, attempt - 1)),
      });
    }
    throw new RetryableError("GEMINI_TEMPORARILY_UNAVAILABLE|Gemini analysis failed.", {
      retryAfter: 2_000,
    });
  }
}
analyzeEntry.maxRetries = 5;

async function createAndStoreThumbnail(
  context: EntryContext,
  attemptId: string,
): Promise<StoredWorkflowThumbnail> {
  "use step";

  const [thumbnailModule, { getServerEnv }, { createWorkflowServiceRoleClient }] =
    await Promise.all([
      import("@/lib/images/thumbnails"),
      import("@/lib/env/server"),
      import("@/lib/supabase/server"),
    ]);
  const {
    createPlaceholderThumbnail,
    downloadMicrolinkThumbnailOnce,
    downloadTrustedThumbnailWithRetry,
    selectTrustedThumbnail,
  } = thumbnailModule;
  const failures: PreviewFailure[] = [];
  let provider: StoredWorkflowThumbnail["provider"] = null;
  let attempts = 0;
  let thumbnail: Awaited<ReturnType<typeof createPlaceholderThumbnail>> | null = null;

  const trustedSelection = selectTrustedThumbnail(context.canonicalUrl);
  if (trustedSelection) {
    const result = await downloadTrustedThumbnailWithRetry(trustedSelection.url);
    attempts += result.attempts;
    if (result.ok) {
      provider = trustedSelection.provider;
      thumbnail = result.thumbnail;
    } else {
      failures.push({
        provider: trustedSelection.provider,
        code: result.code,
        attempts: result.attempts,
      });
    }
  }

  const environment = getServerEnv();
  if (!thumbnail && environment.THUMBNAIL_PROVIDER === "microlink") {
    const result = await downloadMicrolinkThumbnailOnce(context.canonicalUrl, {
      apiKey: environment.MICROLINK_API_KEY,
    });
    attempts += result.attempts;
    if (result.ok) {
      provider = "microlink";
      thumbnail = result.thumbnail;
    } else {
      failures.push({ provider: "microlink", code: result.code, attempts: result.attempts });
    }
  }

  if (!thumbnail) {
    if (failures.length === 0) {
      failures.push({
        provider: null,
        code:
          environment.THUMBNAIL_PROVIDER === "none"
            ? "PREVIEW_PROVIDER_DISABLED"
            : "NO_PREVIEW_AVAILABLE",
        attempts: 0,
      });
    }
    thumbnail = await createPlaceholderThumbnail();
    console.warn("[workflow] Preview unavailable; using a generated placeholder", { failures });
  } else if (failures.length > 0) {
    console.info("[workflow] Preview fallback succeeded", { provider, failures });
  }

  const origin: WorkflowThumbnailOrigin = provider ? "automatic" : "placeholder";

  const objectPath = getWorkflowThumbnailObjectPath(context.entryId, attemptId);
  const { error } = await createWorkflowServiceRoleClient()
    .storage.from("thumbnails")
    .upload(objectPath, thumbnail.buffer, {
      contentType: thumbnail.contentType,
      cacheControl: "31536000, immutable",
      upsert: true,
    });
  if (error) {
    throw new Error("THUMBNAIL_STORAGE_FAILED|Could not store the thumbnail.");
  }
  return { path: objectPath, origin, provider, attempts, failures };
}
// This step contains external preview requests. Do not replay it automatically:
// a manual entry retry is preferable to silently multiplying provider quota.
createAndStoreThumbnail.maxRetries = 0;

async function markFinalizing(entryId: string, attemptId: string): Promise<void> {
  "use step";
  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const { error } = await createWorkflowServiceRoleClient().rpc("mark_entry_finalizing", {
    p_entry_id: entryId,
    p_attempt_id: attemptId,
  });
  if (error) {
    throwProcessingMutationError(error, "Could not mark finalization started.");
  }
}
markFinalizing.maxRetries = 5;

async function finalizeEntry(
  context: EntryContext,
  attemptId: string,
  analysis: AnalysisPayload,
  thumbnail: Pick<StoredWorkflowThumbnail, "path" | "origin">,
): Promise<FinalizationResult> {
  "use step";

  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const suggestedIds = context.availableTags
    .filter(({ slug }) => analysis.suggestedTagSlugs.includes(slug))
    .map(({ id }) => id);
  const finalTagIds = [...new Set([...context.selectedTagIds, ...suggestedIds])].slice(0, 10);
  const { data, error } = await createWorkflowServiceRoleClient().rpc("finalize_entry_processing", {
    p_entry_id: context.entryId,
    p_attempt_id: attemptId,
    p_title: analysis.title,
    p_tldr: analysis.tldr,
    p_thumbnail_path: thumbnail.path,
    p_thumbnail_origin: thumbnail.origin,
    p_tag_ids: finalTagIds,
    p_source_published_at: analysis.sourcePublishedAt ?? null,
    p_source_date_kind: analysis.sourceDateKind ?? null,
  });
  if (error) {
    throwProcessingMutationError(error, "Could not finalize the entry.");
  }
  return firstRpcRow<FinalizationResult>(data, "finalize_entry_processing");
}
finalizeEntry.maxRetries = 5;

async function reconcileProcessingState(
  entryId: string,
  attemptId: string,
): Promise<ReconciledProcessingState> {
  "use step";

  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const client = createWorkflowServiceRoleClient();
  const [entryResult, attemptResult] = await Promise.all([
    client
      .from("entries")
      .select("status, thumbnail_path, thumbnail_origin")
      .eq("id", entryId)
      .maybeSingle(),
    client
      .from("processing_attempts")
      .select("status, metadata")
      .eq("id", attemptId)
      .eq("entry_id", entryId)
      .maybeSingle(),
  ]);
  if (entryResult.error || attemptResult.error) {
    throw new Error("DATABASE_ERROR|Could not reconcile processing state.");
  }

  const entry = entryResult.data;
  const attempt = attemptResult.data;
  const metadata =
    attempt?.metadata && typeof attempt.metadata === "object"
      ? (attempt.metadata as Record<string, unknown>)
      : null;
  const actualThumbnailPath =
    typeof entry?.thumbnail_path === "string" ? entry.thumbnail_path : null;
  const previousThumbnailPath =
    typeof metadata?.previous_thumbnail_path === "string" ? metadata.previous_thumbnail_path : null;
  const discardedThumbnailPath =
    typeof metadata?.discarded_thumbnail_path === "string"
      ? metadata.discarded_thumbnail_path
      : null;
  const status = attempt?.status as Attempt["status"] | undefined;

  return {
    committed: status === "succeeded" && entry?.status === "ready",
    terminal: status === "succeeded" || status === "failed" || status === "cancelled",
    actualThumbnailPath,
    cleanupPaths: cleanupPaths(actualThumbnailPath, previousThumbnailPath, discardedThumbnailPath),
  };
}
reconcileProcessingState.maxRetries = 5;

async function removeThumbnail(path: string): Promise<void> {
  "use step";
  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const { error } = await createWorkflowServiceRoleClient()
    .storage.from("thumbnails")
    .remove([path]);
  if (error) {
    throw new Error("THUMBNAIL_CLEANUP_FAILED|Could not remove the thumbnail.");
  }
}
removeThumbnail.maxRetries = 5;

async function removeThumbnailsBestEffort(paths: string[]): Promise<void> {
  for (const path of paths) {
    try {
      await removeThumbnail(path);
    } catch {
      // A committed or terminal entry remains valid. Operators can reconcile
      // an orphaned private object without changing the entry state.
    }
  }
}

async function failEntry(
  entryId: string,
  attemptId: string,
  code: string,
  message: string,
): Promise<boolean> {
  "use step";
  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const { error } = await createWorkflowServiceRoleClient().rpc("fail_entry_processing", {
    p_entry_id: entryId,
    p_attempt_id: attemptId,
    p_error_code: code,
    p_error_message: message,
    p_retryable: false,
  });
  if (error) {
    if (processingTerminalFailureInfo(error)) return false;
    throw new Error("DATABASE_ERROR|Could not record the pipeline failure.");
  }
  return true;
}
failEntry.maxRetries = 5;

async function failQueuedEntry(entryId: string, code: string, message: string): Promise<void> {
  "use step";
  const { createWorkflowServiceRoleClient } = await import("@/lib/supabase/server");
  const { error } = await createWorkflowServiceRoleClient().rpc("fail_entry_dispatch", {
    p_entry_id: entryId,
    p_error_code: code,
    p_error_message: message,
  });
  if (error) {
    throw new Error("DATABASE_ERROR|Could not record the pipeline dispatch failure.");
  }
}
failQueuedEntry.maxRetries = 5;

export async function processEntryWorkflow(entryId: string): Promise<{ entryId: string }> {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  let attemptId: string | null = null;
  let thumbnailPath: string | null = null;
  try {
    const attempt = await beginAttempt(entryId, workflowRunId);
    if (!attempt) return { entryId };
    attemptId = attempt.id;
    if (["succeeded", "failed", "cancelled"].includes(attempt.status)) {
      return { entryId };
    }
    const context = await loadEntryContext(entryId);
    await markAnalyzing(entryId, attemptId);
    await updateProcessingHeartbeat(entryId, attemptId);
    const analysis = await analyzeEntry(context);
    await updateProcessingHeartbeat(entryId, attemptId);
    const thumbnail = await createAndStoreThumbnail(context, attemptId);
    thumbnailPath = thumbnail.path;
    await updateProcessingHeartbeat(entryId, attemptId);
    await markFinalizing(entryId, attemptId);
    await updateProcessingHeartbeat(entryId, attemptId);
    const finalization = await finalizeEntry(context, attemptId, analysis, thumbnail);
    thumbnailPath = null;
    await removeThumbnailsBestEffort(
      cleanupPaths(
        finalization.thumbnail_path,
        finalization.previous_thumbnail_path,
        finalization.discarded_thumbnail_path,
      ),
    );
    return { entryId };
  } catch (error) {
    const terminalFailure = processingTerminalFailureInfo(error);
    if (attemptId) {
      // A timeout fence or an acknowledgement loss can race the worker. Read
      // durable state before deleting an object or writing another terminal
      // result. This also makes workflow replay safe after a database commit.
      const state = await reconcileProcessingState(entryId, attemptId);
      if (state.committed) {
        thumbnailPath = null;
        await removeThumbnailsBestEffort(state.cleanupPaths);
        return { entryId };
      }

      const candidateThumbnailPath =
        thumbnailPath ?? getWorkflowThumbnailObjectPath(entryId, attemptId);
      if (state.actualThumbnailPath !== candidateThumbnailPath) {
        await removeThumbnailsBestEffort([candidateThumbnailPath]);
      }
      thumbnailPath = null;

      if (state.terminal || terminalFailure) return { entryId };
    } else if (terminalFailure) {
      return { entryId };
    }

    if (thumbnailPath) {
      await removeThumbnailsBestEffort([thumbnailPath]);
      thumbnailPath = null;
    }

    const failure = workflowFailureInfo(error);
    if (attemptId) {
      const recorded = await failEntry(entryId, attemptId, failure.code, failure.message);
      if (!recorded) return { entryId };
    } else {
      await failQueuedEntry(entryId, failure.code, failure.message);
    }
    throw new Error(`${failure.code}: ${failure.message}`);
  }
}
