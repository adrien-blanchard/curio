import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cancel: vi.fn(),
  getRun: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("workflow/api", () => ({
  getRun: mocks.getRun,
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));

describe("processing recovery", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    mocks.cancel.mockResolvedValue(undefined);
    mocks.getRun.mockReturnValue({ cancel: mocks.cancel });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("expires entries using a fifteen-minute cutoff and cancels their runs", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          entry_id: "20000000-0000-4000-8000-000000000001",
          attempt_id: "30000000-0000-4000-8000-000000000001",
          workflow_run_id: "workflow-run-1",
          expired_at: "2026-08-18T10:00:00.000Z",
        },
        {
          entry_id: "20000000-0000-4000-8000-000000000002",
          attempt_id: null,
          workflow_run_id: null,
          expired_at: "2026-08-18T10:00:00.000Z",
        },
      ],
      error: null,
    });
    const { PROCESSING_TIMEOUT_MS, recoverStaleEntryProcessing } =
      await import("@/lib/workflows/recovery");
    const now = Date.parse("2026-08-18T10:00:00.000Z");

    await expect(recoverStaleEntryProcessing({ force: true, now })).resolves.toEqual({
      expired: 2,
      cancellationFailures: 0,
    });
    expect(mocks.rpc).toHaveBeenCalledWith("expire_stale_entry_processing", {
      p_cutoff: new Date(now - PROCESSING_TIMEOUT_MS).toISOString(),
    });
    expect(mocks.getRun).toHaveBeenCalledWith("workflow-run-1");
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
  });

  it("coalesces concurrent sweeps within one server instance", async () => {
    let resolveRpc: ((value: { data: []; error: null }) => void) | undefined;
    mocks.rpc.mockReturnValue(
      new Promise((resolve) => {
        resolveRpc = resolve;
      }),
    );
    const { recoverStaleEntryProcessing } = await import("@/lib/workflows/recovery");

    const first = recoverStaleEntryProcessing({ force: true, now: 1_000_000 });
    const second = recoverStaleEntryProcessing({ force: true, now: 1_000_001 });
    resolveRpc?.({ data: [], error: null });

    await expect(Promise.all([first, second])).resolves.toEqual([
      { expired: 0, cancellationFailures: 0 },
      { expired: 0, cancellationFailures: 0 },
    ]);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it("keeps the database fence successful when provider cancellation fails", async () => {
    mocks.rpc.mockResolvedValue({
      data: [
        {
          entry_id: "20000000-0000-4000-8000-000000000001",
          attempt_id: "30000000-0000-4000-8000-000000000001",
          workflow_run_id: "workflow-run-1",
          expired_at: "2026-08-18T10:00:00.000Z",
        },
      ],
      error: null,
    });
    mocks.cancel.mockRejectedValue(new Error("provider unavailable"));
    const { recoverStaleEntryProcessing } = await import("@/lib/workflows/recovery");

    await expect(recoverStaleEntryProcessing({ force: true, now: Date.now() })).resolves.toEqual({
      expired: 1,
      cancellationFailures: 1,
    });
  });

  it("does not block the dashboard when provider cancellation never responds", async () => {
    vi.useFakeTimers();
    mocks.rpc.mockResolvedValue({
      data: [
        {
          entry_id: "20000000-0000-4000-8000-000000000001",
          attempt_id: "30000000-0000-4000-8000-000000000001",
          workflow_run_id: "workflow-run-1",
          expired_at: "2026-08-18T10:00:00.000Z",
        },
      ],
      error: null,
    });
    mocks.cancel.mockReturnValue(new Promise(() => undefined));
    const { recoverStaleEntryProcessing } = await import("@/lib/workflows/recovery");

    const recovery = recoverStaleEntryProcessing({ force: true, now: Date.now() });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(recovery).resolves.toEqual({ expired: 1, cancellationFailures: 1 });
  });

  it("bounds an unavailable database recovery call", async () => {
    vi.useFakeTimers();
    mocks.rpc.mockReturnValue(new Promise(() => undefined));
    const { recoverStaleEntryProcessing } = await import("@/lib/workflows/recovery");

    const recovery = recoverStaleEntryProcessing({ force: true, now: Date.now() });
    const timeoutExpectation = expect(recovery).rejects.toMatchObject({
      name: "RequestTimeoutError",
    });
    await vi.advanceTimersByTimeAsync(5_000);

    await timeoutExpectation;
  });

  it("fails closed on malformed database output", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ entry_id: "not-a-uuid" }], error: null });
    const { recoverStaleEntryProcessing } = await import("@/lib/workflows/recovery");

    await expect(recoverStaleEntryProcessing({ force: true, now: Date.now() })).rejects.toThrow();
  });
});
