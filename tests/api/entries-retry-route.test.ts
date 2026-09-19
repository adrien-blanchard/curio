import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubValidAuthEnvironment } from "../auth/test-environment";

const entryId = "00000000-0000-4000-8000-000000000201";
const userId = "00000000-0000-4000-8000-000000000202";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  markWorkflowDispatchFailed: vi.fn(),
  rpc: vi.fn(),
  start: vi.fn(),
}));

vi.mock("workflow/api", () => ({ start: mocks.start }));
vi.mock("@/lib/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/workflows/dispatch", () => ({
  markWorkflowDispatchFailed: mocks.markWorkflowDispatchFailed,
}));
vi.mock("@/workflows/process-entry", () => ({ processEntryWorkflow: vi.fn() }));

import { POST } from "@/app/api/v1/entries/[id]/retry/route";
import { processEntryWorkflow } from "@/workflows/process-entry";

function request() {
  return new Request(`https://curio.example.test/api/v1/entries/${entryId}/retry`, {
    method: "POST",
    headers: { Origin: "https://curio.example.test" },
  });
}

function context() {
  return { params: Promise.resolve({ id: entryId }) };
}

describe("POST /api/v1/entries/:id/retry", () => {
  beforeEach(() => {
    stubValidAuthEnvironment();
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.authenticateRequest.mockResolvedValue({
      mode: "cookie",
      user: { id: userId },
      supabase: { rpc: mocks.rpc },
    });
    mocks.markWorkflowDispatchFailed.mockResolvedValue(undefined);
    mocks.start.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("starts the durable workflow only when the database grants a dispatch lease", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: entryId, status: "queued", dispatch_required: true }],
      error: null,
    });

    const response = await POST(request(), context());

    expect(mocks.rpc).toHaveBeenCalledWith("retry_entry", {
      p_actor_user_id: userId,
      p_entry_id: entryId,
    });
    expect(mocks.start).toHaveBeenCalledWith(processEntryWorkflow, [entryId]);
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      data: { id: entryId, status: "queued", dispatchRequired: true },
      error: null,
    });
  });

  it("returns an already leased queued entry without creating a duplicate run", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: entryId, status: "queued", dispatch_required: false }],
      error: null,
    });

    const response = await POST(request(), context());

    expect(response.status).toBe(202);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      data: { id: entryId, dispatchRequired: false },
      error: null,
    });
  });

  it("records a dispatch failure without losing the stable entry ID", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: entryId, status: "queued", dispatch_required: true }],
      error: null,
    });
    mocks.start.mockRejectedValue(new Error("synthetic dispatch failure"));

    const response = await POST(request(), context());

    expect(mocks.markWorkflowDispatchFailed).toHaveBeenCalledWith(entryId);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "WORKFLOW_START_FAILED", details: { entryId } },
    });
  });
});
