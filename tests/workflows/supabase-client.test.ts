import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(),
  getAuthEnv: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: mocks.createClient,
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(),
}));

vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

vi.mock("@/lib/env/public", () => ({
  getPublicSupabaseEnv: vi.fn(),
}));

vi.mock("@/lib/env/server", () => ({
  getAuthEnv: mocks.getAuthEnv,
}));

import { createWorkflowServiceRoleClient } from "@/lib/supabase/server";
import { WORKFLOW_SUPABASE_REQUEST_TIMEOUT_MS } from "@/lib/workflows/timeouts";

describe("createWorkflowServiceRoleClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getAuthEnv.mockReturnValue({
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.test",
      SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key",
    });
    mocks.createClient.mockReturnValue({});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("installs an abortable transport deadline for RPC and Storage requests", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise<Response>(() => undefined)),
    );

    createWorkflowServiceRoleClient();
    const clientOptions = mocks.createClient.mock.calls[0]?.[2] as {
      global?: { fetch?: typeof fetch };
    };
    expect(clientOptions.global?.fetch).toEqual(expect.any(Function));

    const pendingRequest = clientOptions.global!.fetch!("https://example.supabase.test/storage");
    const timeoutExpectation = expect(pendingRequest).rejects.toMatchObject({
      name: "RequestTimeoutError",
      timeoutMs: WORKFLOW_SUPABASE_REQUEST_TIMEOUT_MS,
    });
    await vi.advanceTimersByTimeAsync(WORKFLOW_SUPABASE_REQUEST_TIMEOUT_MS);

    await timeoutExpectation;
  });
});
