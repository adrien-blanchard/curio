import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubValidAuthEnvironment } from "../auth/test-environment";

const entryId = "00000000-0000-4000-8000-000000000101";
const userId = "00000000-0000-4000-8000-000000000102";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  markWorkflowDispatchFailed: vi.fn(),
  resolvePublicUrl: vi.fn(),
  rpc: vi.fn(),
  start: vi.fn(),
}));

vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/lib/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/workflows/dispatch", () => ({
  markWorkflowDispatchFailed: mocks.markWorkflowDispatchFailed,
}));
vi.mock("@/lib/security/public-url", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/security/public-url")>();
  return { ...original, resolvePublicUrl: mocks.resolvePublicUrl };
});
vi.mock("@/workflows/process-entry", () => ({
  processEntryWorkflow: vi.fn(),
}));

import { POST } from "@/app/api/v1/entries/route";
import { processEntryWorkflow } from "@/workflows/process-entry";

function request() {
  return new Request("https://curio.example.test/api/v1/entries", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: "https://curio.example.test",
    },
    body: JSON.stringify({
      url: "https://example.com/article?utm_source=test",
      sourceType: "opensource",
      tagIds: [],
    }),
  });
}

describe("POST /api/v1/entries", () => {
  beforeEach(() => {
    stubValidAuthEnvironment();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.authenticateRequest.mockResolvedValue({
      mode: "cookie",
      user: { id: userId },
      supabase: { rpc: mocks.rpc },
    });
    mocks.resolvePublicUrl.mockResolvedValue("https://example.com/article");
    mocks.markWorkflowDispatchFailed.mockResolvedValue(undefined);
    mocks.start.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("starts one durable workflow for a newly created canonical entry", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: entryId, status: "queued", created: true, dispatch_required: true }],
      error: null,
    });

    const response = await POST(request());

    expect(mocks.rpc).toHaveBeenCalledWith("submit_entry", {
      p_actor_user_id: userId,
      p_url: "https://example.com/article",
      p_canonical_url: "https://example.com/article",
      p_source_type: "opensource",
      p_tag_ids: [],
    });
    expect(mocks.start).toHaveBeenCalledWith(processEntryWorkflow, [entryId]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      data: {
        id: entryId,
        status: "queued",
        created: true,
        dispatchRequired: true,
      },
      error: null,
    });
  });

  it("returns an existing canonical entry without starting a duplicate workflow", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: entryId, status: "ready", created: false, dispatch_required: false }],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      data: {
        id: entryId,
        status: "ready",
        created: false,
        dispatchRequired: false,
      },
      error: null,
    });
  });

  it("recovers a committed queued entry whose workflow was never dispatched", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: entryId, status: "queued", created: false, dispatch_required: true }],
      error: null,
    });

    const response = await POST(request());

    expect(response.status).toBe(202);
    expect(mocks.start).toHaveBeenCalledWith(processEntryWorkflow, [entryId]);
    expect(await response.json()).toMatchObject({
      data: { id: entryId, created: false, dispatchRequired: true },
      error: null,
    });
  });

  it("records a dispatch failure and returns the stable entry ID", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: entryId, status: "queued", created: true, dispatch_required: true }],
      error: null,
    });
    mocks.start.mockRejectedValue(new Error("synthetic dispatch failure"));

    const response = await POST(request());

    expect(mocks.markWorkflowDispatchFailed).toHaveBeenCalledWith(entryId);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      data: null,
      error: {
        code: "WORKFLOW_START_FAILED",
        message: "Processing could not be started. Retry the same entry shortly",
        details: { entryId },
      },
    });
  });
});
