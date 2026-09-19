import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class FatalError extends Error {
    readonly fatal = true;

    constructor(message: string) {
      super(message);
      this.name = "FatalError";
    }
  }

  class RetryableError extends Error {
    readonly retryAfter: Date;

    constructor(message: string, options: { retryAfter?: number | Date } = {}) {
      super(message);
      this.name = "RetryableError";
      const delay =
        options.retryAfter instanceof Date ? options.retryAfter.getTime() : options.retryAfter;
      mocks.retryDelays.push(delay ?? 1_000);
      this.retryAfter =
        options.retryAfter instanceof Date
          ? options.retryAfter
          : new Date(Date.now() + (options.retryAfter ?? 1_000));
    }
  }

  return {
    analyzePublicResource: vi.fn(),
    createPlaceholderThumbnail: vi.fn(),
    downloadMicrolinkThumbnailOnce: vi.fn(),
    downloadTrustedThumbnailWithRetry: vi.fn(),
    getStepMetadata: vi.fn(),
    getWorkflowMetadata: vi.fn(),
    microlinkApiKey: undefined as string | undefined,
    retryDelays: [] as number[],
    thumbnailProvider: "none" as "none" | "microlink",
    workflowClientCreations: [] as boolean[],
    selectTrustedThumbnail: vi.fn(),
    FatalError,
    RetryableError,
  };
});

vi.mock("workflow", () => ({
  FatalError: mocks.FatalError,
  RetryableError: mocks.RetryableError,
  getStepMetadata: mocks.getStepMetadata,
  getWorkflowMetadata: mocks.getWorkflowMetadata,
}));

vi.mock("@/lib/ai/gemini", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/gemini")>();
  return {
    ...actual,
    analyzePublicResource: mocks.analyzePublicResource,
  };
});

vi.mock("@/lib/env/server", () => ({
  getServerEnv: () => ({
    GEMINI_API_KEY: "synthetic-test-key",
    GEMINI_MODEL: "synthetic-test-model",
    MICROLINK_API_KEY: mocks.microlinkApiKey,
    THUMBNAIL_PROVIDER: mocks.thumbnailProvider,
  }),
}));

vi.mock("@/lib/images/thumbnails", () => ({
  createPlaceholderThumbnail: mocks.createPlaceholderThumbnail,
  downloadMicrolinkThumbnailOnce: mocks.downloadMicrolinkThumbnailOnce,
  downloadTrustedThumbnailWithRetry: mocks.downloadTrustedThumbnailWithRetry,
  getWorkflowThumbnailObjectPath: (entryId: string, attemptId: string) =>
    `${entryId}/workflow-${attemptId}.webp`,
  selectTrustedThumbnail: mocks.selectTrustedThumbnail,
}));

type AttemptStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

type FakeDatabaseOptions = {
  entryId?: string;
  attemptId?: string;
  workflowRunId?: string;
  beginFailureCode?:
    "PROCESSING_ATTEMPT_ACTIVE" | "PROCESSING_ATTEMPT_TERMINAL" | "PROCESSING_TIMEOUT";
  previousThumbnailPath?: string | null;
  manualThumbnailPath?: string | null;
  finalizationAcknowledgementLost?: boolean;
  processingTimeoutAtHeartbeat?: number;
  thumbnailRemovalFails?: boolean;
  thumbnailUploadFails?: boolean;
  canonicalUrl?: string;
};

function createFakeDatabase(options: FakeDatabaseOptions = {}) {
  const entryId = options.entryId ?? "20000000-0000-4000-8000-000000000001";
  const attemptId = options.attemptId ?? "30000000-0000-4000-8000-000000000001";
  const workflowRunId = options.workflowRunId ?? "workflow-run-1";
  const availableTags = [
    { id: "40000000-0000-4000-8000-000000000001", name: "Selected", slug: "selected" },
    { id: "40000000-0000-4000-8000-000000000002", name: "AI", slug: "ai" },
  ];
  const selectedTagRows = [
    { tag_id: "40000000-0000-4000-8000-000000000001" },
    { tag_id: "40000000-0000-4000-8000-000000000001" },
  ];

  let storedAttempt:
    | {
        id: string;
        attempt: number;
        status: AttemptStatus;
        workflowRunId: string;
        metadata: Record<string, unknown>;
      }
    | undefined;
  let attemptsCreated = 0;
  let heartbeatCount = 0;
  let entryStatus = "queued";
  let entryThumbnailPath: string | null =
    options.manualThumbnailPath ?? options.previousThumbnailPath ?? null;
  let entryThumbnailOrigin: "automatic" | "manual" | "placeholder" | null =
    options.manualThumbnailPath ? "manual" : options.previousThumbnailPath ? "automatic" : null;

  const upload = vi.fn(async () => ({
    error: options.thumbnailUploadFails
      ? { message: "synthetic lost upload acknowledgement" }
      : null,
  }));
  const remove = vi.fn(async () => ({
    error: options.thumbnailRemovalFails ? new Error("synthetic cleanup failure") : null,
  }));
  const rpc = vi.fn(async (operation: string, parameters: Record<string, unknown>) => {
    if (operation === "begin_processing_attempt") {
      if (options.beginFailureCode) {
        if (options.beginFailureCode !== "PROCESSING_ATTEMPT_ACTIVE") entryStatus = "failed";
        return {
          data: null,
          error: { code: "P0001", message: options.beginFailureCode },
        };
      }
      if (!storedAttempt) {
        attemptsCreated += 1;
        storedAttempt = {
          id: attemptId,
          attempt: 1,
          status: "queued",
          workflowRunId,
          metadata: {},
        };
      }
      if (parameters.p_workflow_run_id !== storedAttempt.workflowRunId) {
        return { data: null, error: new Error("Unexpected workflow run") };
      }
      return {
        data: [
          {
            id: storedAttempt.id,
            attempt: storedAttempt.attempt,
            status: storedAttempt.status,
          },
        ],
        error: null,
      };
    }

    if (!storedAttempt || parameters.p_attempt_id !== storedAttempt.id) {
      return { data: null, error: new Error("Unknown processing attempt") };
    }
    if (operation === "mark_entry_analyzing") {
      storedAttempt.status = "running";
      entryStatus = "analyzing";
    }
    if (operation === "update_processing_heartbeat") {
      heartbeatCount += 1;
      if (options.processingTimeoutAtHeartbeat === heartbeatCount) {
        storedAttempt.status = "failed";
        entryStatus = "failed";
        return { data: null, error: { code: "P0001", message: "PROCESSING_TIMEOUT" } };
      }
      return { data: "2026-08-18T12:00:00.000Z", error: null };
    }
    if (operation === "mark_entry_finalizing") entryStatus = "finalizing";
    if (operation === "finalize_entry_processing") {
      const candidateThumbnailPath = String(parameters.p_thumbnail_path);
      const candidateThumbnailOrigin = parameters.p_thumbnail_origin as "automatic" | "placeholder";
      const manualThumbnailPreserved = entryThumbnailOrigin === "manual";
      const actualThumbnailPath = manualThumbnailPreserved
        ? entryThumbnailPath
        : candidateThumbnailPath;
      const previousThumbnailPath = manualThumbnailPreserved
        ? null
        : (options.previousThumbnailPath ?? null);
      const discardedThumbnailPath = manualThumbnailPreserved ? candidateThumbnailPath : null;
      storedAttempt.status = "succeeded";
      storedAttempt.metadata = {
        thumbnail_path: actualThumbnailPath,
        thumbnail_origin: manualThumbnailPreserved ? "manual" : candidateThumbnailOrigin,
        previous_thumbnail_path: previousThumbnailPath,
        discarded_thumbnail_path: discardedThumbnailPath,
      };
      entryStatus = "ready";
      entryThumbnailPath = actualThumbnailPath;
      entryThumbnailOrigin = manualThumbnailPreserved ? "manual" : candidateThumbnailOrigin;
      if (options.finalizationAcknowledgementLost) {
        return { data: null, error: new Error("Synthetic acknowledgement loss") };
      }
      return {
        data: [
          {
            id: entryId,
            status: "ready",
            thumbnail_path: actualThumbnailPath,
            thumbnail_origin: entryThumbnailOrigin,
            previous_thumbnail_path: previousThumbnailPath,
            discarded_thumbnail_path: discardedThumbnailPath,
          },
        ],
        error: null,
      };
    }
    if (operation === "fail_entry_processing") storedAttempt.status = "failed";
    return { data: null, error: null };
  });

  const from = vi.fn((table: string) => {
    if (table === "entries") {
      return {
        select: vi.fn((columns: string) => ({
          eq: vi.fn(() =>
            columns === "id, canonical_url"
              ? {
                  single: vi.fn(async () => ({
                    data: {
                      id: entryId,
                      canonical_url: options.canonicalUrl ?? "https://example.invalid/resource",
                    },
                    error: null,
                  })),
                }
              : {
                  maybeSingle: vi.fn(async () => ({
                    data: {
                      status: entryStatus,
                      thumbnail_path: entryThumbnailPath,
                      thumbnail_origin: entryThumbnailOrigin,
                    },
                    error: null,
                  })),
                },
          ),
        })),
      };
    }
    if (table === "tags") {
      return {
        select: vi.fn(() => ({
          order: vi.fn(async () => ({ data: availableTags, error: null })),
        })),
      };
    }
    if (table === "entry_tags") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: selectedTagRows, error: null })),
        })),
      };
    }
    if (table === "processing_attempts") {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            eq: vi.fn(() => ({
              maybeSingle: vi.fn(async () => ({
                data: storedAttempt
                  ? { status: storedAttempt.status, metadata: storedAttempt.metadata }
                  : null,
                error: null,
              })),
            })),
          })),
        })),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  const client = {
    from,
    rpc,
    storage: {
      from: vi.fn(() => ({ upload, remove })),
    },
  };

  return {
    attemptId,
    client,
    entryId,
    get attemptsCreated() {
      return attemptsCreated;
    },
    get heartbeatCount() {
      return heartbeatCount;
    },
    rpc,
    remove,
    upload,
    workflowRunId,
  };
}

let fakeDatabase = createFakeDatabase();

vi.mock("@/lib/supabase/server", () => ({
  createWorkflowServiceRoleClient: () => {
    mocks.workflowClientCreations.push(true);
    return fakeDatabase.client;
  },
}));

import { GeminiAnalysisError } from "@/lib/ai/gemini";
import { processEntryWorkflow } from "@/workflows/process-entry";

describe("processEntryWorkflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.retryDelays.length = 0;
    mocks.workflowClientCreations.length = 0;
    mocks.microlinkApiKey = undefined;
    mocks.thumbnailProvider = "none";
    fakeDatabase = createFakeDatabase();
    mocks.getWorkflowMetadata.mockReturnValue({ workflowRunId: fakeDatabase.workflowRunId });
    mocks.getStepMetadata.mockReturnValue({ attempt: 1 });
    mocks.selectTrustedThumbnail.mockReturnValue(null);
    mocks.createPlaceholderThumbnail.mockResolvedValue({
      buffer: Buffer.from("synthetic-thumbnail"),
      contentType: "image/webp",
      extension: "webp",
      width: 720,
      height: 309,
    });
    mocks.analyzePublicResource.mockResolvedValue({
      title: "Synthetic resource",
      tldr: "A sufficiently detailed synthetic summary for the direct workflow unit test.",
      suggested_tag_slugs: ["selected", "ai", "ai"],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("finalizes a successful run with unique selected and suggested tags", async () => {
    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    const finalization = fakeDatabase.rpc.mock.calls.find(
      ([operation]) => operation === "finalize_entry_processing",
    );
    expect(finalization?.[1]).toMatchObject({
      p_attempt_id: fakeDatabase.attemptId,
      p_entry_id: fakeDatabase.entryId,
      p_tag_ids: ["40000000-0000-4000-8000-000000000001", "40000000-0000-4000-8000-000000000002"],
      p_thumbnail_origin: "placeholder",
      p_thumbnail_path: `${fakeDatabase.entryId}/workflow-${fakeDatabase.attemptId}.webp`,
    });
    expect(new Set(finalization?.[1].p_tag_ids as string[]).size).toBe(2);
    expect(fakeDatabase.upload).toHaveBeenCalledWith(
      `${fakeDatabase.entryId}/workflow-${fakeDatabase.attemptId}.webp`,
      expect.any(Buffer),
      expect.objectContaining({ upsert: true }),
    );
    expect(fakeDatabase.heartbeatCount).toBe(4);
    expect(mocks.workflowClientCreations.length).toBeGreaterThan(0);
  });

  it("stores a trusted YouTube preview as automatic without creating a placeholder", async () => {
    const trustedThumbnail = {
      buffer: Buffer.from("trusted-youtube-thumbnail"),
      contentType: "image/webp" as const,
      extension: "webp" as const,
      width: 720 as const,
      height: 309 as const,
    };
    mocks.selectTrustedThumbnail.mockReturnValue({
      provider: "youtube",
      url: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    });
    mocks.downloadTrustedThumbnailWithRetry.mockResolvedValue({
      ok: true,
      thumbnail: trustedThumbnail,
      attempts: 1,
    });

    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    const finalization = fakeDatabase.rpc.mock.calls.find(
      ([operation]) => operation === "finalize_entry_processing",
    );
    expect(finalization?.[1]).toMatchObject({ p_thumbnail_origin: "automatic" });
    expect(fakeDatabase.upload).toHaveBeenCalledWith(
      expect.any(String),
      trustedThumbnail.buffer,
      expect.any(Object),
    );
    expect(mocks.downloadMicrolinkThumbnailOnce).not.toHaveBeenCalled();
    expect(mocks.createPlaceholderThumbnail).not.toHaveBeenCalled();
  });

  it("falls back from a failed trusted preview to one Microlink attempt", async () => {
    const microlinkThumbnail = {
      buffer: Buffer.from("microlink-thumbnail"),
      contentType: "image/webp" as const,
      extension: "webp" as const,
      width: 720 as const,
      height: 309 as const,
    };
    mocks.thumbnailProvider = "microlink";
    mocks.microlinkApiKey = "synthetic-provider-key";
    mocks.selectTrustedThumbnail.mockReturnValue({
      provider: "github",
      url: "https://opengraph.githubassets.com/1/example/project",
    });
    mocks.downloadTrustedThumbnailWithRetry.mockResolvedValue({
      ok: false,
      code: "IMAGE_DOWNLOAD_TIMEOUT",
      attempts: 2,
    });
    mocks.downloadMicrolinkThumbnailOnce.mockResolvedValue({
      ok: true,
      thumbnail: microlinkThumbnail,
      attempts: 1,
    });

    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(mocks.downloadTrustedThumbnailWithRetry).toHaveBeenCalledWith(
      "https://opengraph.githubassets.com/1/example/project",
    );
    expect(mocks.downloadMicrolinkThumbnailOnce).toHaveBeenCalledWith(
      "https://example.invalid/resource",
      { apiKey: "synthetic-provider-key" },
    );
    expect(fakeDatabase.rpc).toHaveBeenCalledWith(
      "finalize_entry_processing",
      expect.objectContaining({ p_thumbnail_origin: "automatic" }),
    );
    expect(fakeDatabase.upload).toHaveBeenCalledWith(
      expect.any(String),
      microlinkThumbnail.buffer,
      expect.any(Object),
    );
    expect(mocks.createPlaceholderThumbnail).not.toHaveBeenCalled();
  });

  it("uses a marked placeholder when every optional preview attempt fails", async () => {
    mocks.thumbnailProvider = "microlink";
    mocks.selectTrustedThumbnail.mockReturnValue({
      provider: "github",
      url: "https://opengraph.githubassets.com/1/example/project",
    });
    mocks.downloadTrustedThumbnailWithRetry.mockResolvedValue({
      ok: false,
      code: "IMAGE_DOWNLOAD_FAILED",
      attempts: 2,
    });
    mocks.downloadMicrolinkThumbnailOnce.mockResolvedValue({
      ok: false,
      code: "INVALID_IMAGE",
      attempts: 1,
    });

    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(mocks.downloadTrustedThumbnailWithRetry).toHaveBeenCalledOnce();
    expect(mocks.downloadMicrolinkThumbnailOnce).toHaveBeenCalledOnce();
    expect(mocks.createPlaceholderThumbnail).toHaveBeenCalledOnce();
    expect(fakeDatabase.rpc).toHaveBeenCalledWith(
      "finalize_entry_processing",
      expect.objectContaining({ p_thumbnail_origin: "placeholder" }),
    );
    expect(
      fakeDatabase.rpc.mock.calls.filter(([operation]) => operation === "fail_entry_processing"),
    ).toHaveLength(0);
  });

  it("does not call Microlink when the optional provider is disabled", async () => {
    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(mocks.downloadMicrolinkThumbnailOnce).not.toHaveBeenCalled();
    expect(mocks.downloadTrustedThumbnailWithRetry).not.toHaveBeenCalled();
    expect(fakeDatabase.rpc).toHaveBeenCalledWith(
      "finalize_entry_processing",
      expect.objectContaining({ p_thumbnail_origin: "placeholder" }),
    );
  });

  it("reconciles the deterministic thumbnail path after a lost upload acknowledgement", async () => {
    fakeDatabase = createFakeDatabase({ thumbnailUploadFails: true });
    mocks.getWorkflowMetadata.mockReturnValue({ workflowRunId: fakeDatabase.workflowRunId });

    await expect(processEntryWorkflow(fakeDatabase.entryId)).rejects.toThrow(
      "THUMBNAIL_STORAGE_FAILED: Could not store the thumbnail.",
    );

    const candidatePath = `${fakeDatabase.entryId}/workflow-${fakeDatabase.attemptId}.webp`;
    expect(fakeDatabase.remove).toHaveBeenCalledWith([candidatePath]);
    expect(fakeDatabase.rpc).toHaveBeenCalledWith(
      "fail_entry_processing",
      expect.objectContaining({ p_error_code: "THUMBNAIL_STORAGE_FAILED" }),
    );
  });

  it("keeps the workflow as the only retry authority for a Gemini timeout", async () => {
    mocks.getStepMetadata.mockReturnValue({ attempt: 2 });
    mocks.analyzePublicResource.mockRejectedValue(
      new GeminiAnalysisError(
        "GEMINI_REQUEST_TIMEOUT",
        "Gemini did not respond within 120 seconds.",
        true,
      ),
    );

    await expect(processEntryWorkflow(fakeDatabase.entryId)).rejects.toThrow(
      "GEMINI_REQUEST_TIMEOUT: Gemini did not respond within 120 seconds.",
    );

    expect(mocks.retryDelays).toEqual([2_000]);
    expect(fakeDatabase.rpc).toHaveBeenCalledWith(
      "fail_entry_processing",
      expect.objectContaining({ p_error_code: "GEMINI_REQUEST_TIMEOUT" }),
    );
  });

  it("maps a retryable Gemini quota error and records a terminal failure at the workflow boundary", async () => {
    mocks.getStepMetadata.mockReturnValue({ attempt: 3 });
    mocks.analyzePublicResource.mockRejectedValue(
      new GeminiAnalysisError("GEMINI_QUOTA_EXCEEDED", "Gemini is currently rate limited.", true),
    );

    // Direct-unit mode has no Workflow compiler/runtime, so the retryable step
    // error reaches the workflow catch immediately instead of being scheduled.
    await expect(processEntryWorkflow(fakeDatabase.entryId)).rejects.toThrow(
      "GEMINI_QUOTA_EXCEEDED: Gemini is currently rate limited.",
    );

    expect(mocks.retryDelays).toEqual([4_000]);
    expect(fakeDatabase.rpc).toHaveBeenCalledWith("fail_entry_processing", {
      p_attempt_id: fakeDatabase.attemptId,
      p_entry_id: fakeDatabase.entryId,
      p_error_code: "GEMINI_QUOTA_EXCEEDED",
      p_error_message: "Gemini is currently rate limited.",
      p_retryable: false,
    });
    expect(fakeDatabase.upload).not.toHaveBeenCalled();
  });

  it("treats a timeout fence before attempt creation as an already completed no-op", async () => {
    fakeDatabase = createFakeDatabase({ beginFailureCode: "PROCESSING_TIMEOUT" });
    mocks.getWorkflowMetadata.mockReturnValue({ workflowRunId: fakeDatabase.workflowRunId });

    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(mocks.analyzePublicResource).not.toHaveBeenCalled();
    expect(
      fakeDatabase.rpc.mock.calls.filter(([operation]) => operation === "fail_entry_dispatch"),
    ).toHaveLength(0);
  });

  it("does not compete with another active workflow run for the same entry", async () => {
    fakeDatabase = createFakeDatabase({ beginFailureCode: "PROCESSING_ATTEMPT_ACTIVE" });
    mocks.getWorkflowMetadata.mockReturnValue({ workflowRunId: fakeDatabase.workflowRunId });

    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(mocks.analyzePublicResource).not.toHaveBeenCalled();
    expect(fakeDatabase.rpc).toHaveBeenCalledTimes(1);
  });

  it("replays a succeeded workflow run without creating another attempt or side effect", async () => {
    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });
    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(fakeDatabase.attemptsCreated).toBe(1);
    expect(
      fakeDatabase.rpc.mock.calls.filter(([operation]) => operation === "begin_processing_attempt"),
    ).toHaveLength(2);
    expect(
      fakeDatabase.rpc.mock.calls.filter(
        ([operation]) => operation === "finalize_entry_processing",
      ),
    ).toHaveLength(1);
    expect(fakeDatabase.upload).toHaveBeenCalledTimes(1);
    expect(mocks.analyzePublicResource).toHaveBeenCalledTimes(1);
  });

  it("preserves a manual thumbnail and cleans only the discarded automatic candidate", async () => {
    const manualPath = `${fakeDatabase.entryId}/manual.webp`;
    const candidatePath = `${fakeDatabase.entryId}/workflow-${fakeDatabase.attemptId}.webp`;
    fakeDatabase = createFakeDatabase({
      manualThumbnailPath: manualPath,
      thumbnailRemovalFails: true,
    });
    mocks.getWorkflowMetadata.mockReturnValue({ workflowRunId: fakeDatabase.workflowRunId });

    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(fakeDatabase.remove).toHaveBeenCalledWith([candidatePath]);
    expect(fakeDatabase.remove).not.toHaveBeenCalledWith([manualPath]);
    expect(
      fakeDatabase.rpc.mock.calls.filter(([operation]) => operation === "fail_entry_processing"),
    ).toHaveLength(0);
  });

  it("reconciles a committed finalization when its acknowledgement is lost", async () => {
    const previousPath = `${fakeDatabase.entryId}/automatic-old.webp`;
    fakeDatabase = createFakeDatabase({
      previousThumbnailPath: previousPath,
      finalizationAcknowledgementLost: true,
    });
    mocks.getWorkflowMetadata.mockReturnValue({ workflowRunId: fakeDatabase.workflowRunId });

    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(fakeDatabase.remove).toHaveBeenCalledWith([previousPath]);
    expect(fakeDatabase.remove).not.toHaveBeenCalledWith([
      `${fakeDatabase.entryId}/workflow-${fakeDatabase.attemptId}.webp`,
    ]);
    expect(
      fakeDatabase.rpc.mock.calls.filter(([operation]) => operation === "fail_entry_processing"),
    ).toHaveLength(0);
  });

  it("honors the timeout fence, cleans its uncommitted thumbnail, and replays safely", async () => {
    fakeDatabase = createFakeDatabase({ processingTimeoutAtHeartbeat: 3 });
    mocks.getWorkflowMetadata.mockReturnValue({ workflowRunId: fakeDatabase.workflowRunId });
    const candidatePath = `${fakeDatabase.entryId}/workflow-${fakeDatabase.attemptId}.webp`;

    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });
    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(fakeDatabase.heartbeatCount).toBe(3);
    expect(fakeDatabase.upload).toHaveBeenCalledTimes(1);
    expect(fakeDatabase.remove).toHaveBeenCalledWith([candidatePath]);
    expect(
      fakeDatabase.rpc.mock.calls.filter(
        ([operation]) => operation === "finalize_entry_processing",
      ),
    ).toHaveLength(0);
    expect(
      fakeDatabase.rpc.mock.calls.filter(([operation]) => operation === "fail_entry_processing"),
    ).toHaveLength(0);
  });

  it("does not repeat side effects when a terminal failed run is replayed", async () => {
    mocks.analyzePublicResource.mockRejectedValue(
      new GeminiAnalysisError("SOURCE_RETRIEVAL_FAILED", "The source was unavailable.", false),
    );

    await expect(processEntryWorkflow(fakeDatabase.entryId)).rejects.toThrow(
      "SOURCE_RETRIEVAL_FAILED: The source was unavailable.",
    );
    await expect(processEntryWorkflow(fakeDatabase.entryId)).resolves.toEqual({
      entryId: fakeDatabase.entryId,
    });

    expect(fakeDatabase.attemptsCreated).toBe(1);
    expect(mocks.analyzePublicResource).toHaveBeenCalledTimes(1);
    expect(
      fakeDatabase.rpc.mock.calls.filter(([operation]) => operation === "fail_entry_processing"),
    ).toHaveLength(1);
    expect(fakeDatabase.upload).not.toHaveBeenCalled();
  });
});
