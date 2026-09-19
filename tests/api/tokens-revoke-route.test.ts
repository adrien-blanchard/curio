import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
}));
vi.mock("@/lib/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));

import { DELETE } from "@/app/api/v1/tokens/[id]/route";

const tokenId = "00000000-0000-4000-8000-000000000002";

function request() {
  return new Request(`https://curio.example.test/api/v1/tokens/${tokenId}`, {
    method: "DELETE",
    headers: { Origin: "https://curio.example.test" },
  });
}

function actorWithRevocation(result: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(result);
  const rpc = vi.fn(() => ({ single }));
  return {
    actor: {
      user: { id: "00000000-0000-4000-8000-000000000001" },
      supabase: { rpc },
    },
    rpc,
  };
}

describe("DELETE /api/v1/tokens/:id", () => {
  beforeEach(() => {
    mocks.authenticateRequest.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("requires a CSRF-protected browser session and revokes only the requested ID", async () => {
    const revoked = { id: tokenId, revoked_at: "2026-01-01T00:00:00.000Z" };
    const { actor, rpc } = actorWithRevocation({ data: revoked, error: null });
    mocks.authenticateRequest.mockResolvedValue(actor);
    const response = await DELETE(request(), { params: Promise.resolve({ id: tokenId }) });

    expect(mocks.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), {
      allowApiToken: false,
      requireCsrf: true,
    });
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("revoke_api_token", {
      p_actor_user_id: "00000000-0000-4000-8000-000000000001",
      p_token_id: tokenId,
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ data: { token: revoked }, error: null });
  });

  it("returns a stable not-found envelope when no owned active token is revoked", async () => {
    const { actor } = actorWithRevocation({
      data: null,
      error: { code: "P0002", message: "TOKEN_NOT_FOUND" },
    });
    mocks.authenticateRequest.mockResolvedValue(actor);
    const response = await DELETE(request(), { params: Promise.resolve({ id: tokenId }) });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      data: null,
      error: { code: "TOKEN_NOT_FOUND", message: "API token not found" },
    });
  });

  it("rejects an invalid path ID before calling the revocation RPC", async () => {
    const { actor, rpc } = actorWithRevocation({ data: {}, error: null });
    mocks.authenticateRequest.mockResolvedValue(actor);
    const response = await DELETE(request(), { params: Promise.resolve({ id: "not-a-uuid" }) });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });
});
