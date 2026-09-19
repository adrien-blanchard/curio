import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
  generateApiToken: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));
vi.mock("@/lib/auth/tokens", () => ({ generateApiToken: mocks.generateApiToken }));

import { POST } from "@/app/api/v1/tokens/route";

const userId = "00000000-0000-4000-8000-000000000001";

function request(body: unknown) {
  return new Request("https://curio.example.test/api/v1/tokens", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: "https://curio.example.test" },
    body: JSON.stringify(body),
  });
}

function authenticatedActor(role: "reader" | "contributor" | "administrator") {
  const single = vi.fn().mockResolvedValue({
    data: {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Browser extension",
      scopes: ["profile:read", "tags:read"],
    },
    error: null,
  });
  const rpc = vi.fn(() => ({ single }));
  return {
    actor: { role, user: { id: userId }, supabase: { rpc } },
    rpc,
    single,
  };
}

describe("POST /api/v1/tokens", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    mocks.authenticateRequest.mockReset();
    mocks.generateApiToken.mockReset();
    mocks.generateApiToken.mockReturnValue({
      rawToken: `curio_pat_${"a".repeat(43)}`,
      tokenHash: "b".repeat(64),
      tokenPrefix: "curio_pat_aaaaaaaa",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it("deduplicates valid scopes, stores only hash metadata, and returns plaintext once", async () => {
    const { actor, rpc } = authenticatedActor("contributor");
    mocks.authenticateRequest.mockResolvedValue(actor);
    const response = await POST(
      request({
        name: "  Browser extension  ",
        scopes: ["profile:read", "tags:read", "profile:read"],
        expiresAt: "2026-02-01T01:00:00+01:00",
      }),
    );
    const payload = await response.json();

    expect(mocks.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), {
      allowApiToken: false,
      requireCsrf: true,
    });
    expect(rpc).toHaveBeenCalledWith("create_api_token", {
      p_actor_user_id: userId,
      p_name: "Browser extension",
      p_token_prefix: "curio_pat_aaaaaaaa",
      p_token_hash: "b".repeat(64),
      p_scopes: ["profile:read", "tags:read"],
      p_expires_at: "2026-02-01T00:00:00.000Z",
    });
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(payload.data.token).toBe(`curio_pat_${"a".repeat(43)}`);
    expect(JSON.stringify(payload.data.apiToken)).not.toContain("b".repeat(64));
  });

  it("prevents a reader from minting a write-scoped token", async () => {
    const { actor, rpc } = authenticatedActor("reader");
    mocks.authenticateRequest.mockResolvedValue(actor);
    const response = await POST(
      request({ name: "Writer", scopes: ["entries:write"], expiresAt: null }),
    );
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      data: null,
      error: {
        code: "SCOPE_NOT_ALLOWED",
        message: "One or more scopes are not available to this account role",
      },
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.generateApiToken).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty scope list", { name: "Token", scopes: [] }],
    ["an unknown field", { name: "Token", scopes: ["profile:read"], administrator: true }],
    ["an unknown scope", { name: "Token", scopes: ["administrator:all"] }],
  ])("rejects %s as a strict payload", async (_label, body) => {
    const { actor, rpc } = authenticatedActor("administrator");
    mocks.authenticateRequest.mockResolvedValue(actor);
    const response = await POST(request(body));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      data: null,
      error: { code: "VALIDATION_ERROR" },
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each(["2025-12-31T23:59:59Z", "2027-01-03T00:00:01Z"])(
    "rejects an expiration outside the supported window: %s",
    async (expiresAt) => {
      const { actor, rpc } = authenticatedActor("contributor");
      mocks.authenticateRequest.mockResolvedValue(actor);
      const response = await POST(request({ name: "Token", scopes: ["profile:read"], expiresAt }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        data: null,
        error: { code: "INVALID_EXPIRATION" },
      });
      expect(rpc).not.toHaveBeenCalled();
    },
  );
});
