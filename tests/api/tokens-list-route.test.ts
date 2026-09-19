import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ authenticateRequest: vi.fn() }));
vi.mock("@/lib/auth", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/auth")>();
  return { ...original, authenticateRequest: mocks.authenticateRequest };
});

import { GET } from "@/app/api/v1/tokens/route";

const userId = "00000000-0000-4000-8000-000000000301";
const tokenId = "00000000-0000-4000-8000-000000000302";
const token = {
  id: tokenId,
  user_id: userId,
  name: "Browser extension",
  token_prefix: "curio_pat_example1",
  scopes: ["entries:write", "tags:read", "profile:read"],
  expires_at: null,
  last_used_at: null,
  revoked_at: null,
  created_at: "2026-08-14T00:00:00.000Z",
};

function organizationSupabase() {
  const tokenRange = vi.fn().mockResolvedValue({ data: [token], error: null, count: 1 });
  const tokenOrder = vi.fn(() => ({ range: tokenRange }));
  const tokenSelect = vi.fn(() => ({ order: tokenOrder }));
  const profileIn = vi.fn().mockResolvedValue({
    data: [{ id: userId, email: "owner@example.test" }],
    error: null,
  });
  const profileSelect = vi.fn(() => ({ in: profileIn }));
  const from = vi.fn((table: string) => {
    if (table === "api_tokens") return { select: tokenSelect };
    if (table === "profiles") return { select: profileSelect };
    throw new Error(`Unexpected table ${table}`);
  });
  return { from };
}

describe("GET /api/v1/tokens", () => {
  beforeEach(() => {
    mocks.authenticateRequest.mockReset();
  });

  it("returns a bounded organization inventory to administrators without token hashes", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      role: "administrator",
      user: { id: userId },
      supabase: organizationSupabase(),
    });

    const response = await GET(
      new Request("https://curio.example.test/api/v1/tokens?view=organization&page=1"),
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      data: {
        tokens: [{ id: tokenId, owner_email: "owner@example.test" }],
        total: 1,
        page: 1,
        pageSize: 50,
      },
      error: null,
    });
    expect(JSON.stringify(payload)).not.toContain("token_hash");
  });

  it("rejects an organization inventory request from a contributor", async () => {
    const from = vi.fn();
    mocks.authenticateRequest.mockResolvedValue({
      role: "contributor",
      user: { id: userId },
      supabase: { from },
    });

    const response = await GET(
      new Request("https://curio.example.test/api/v1/tokens?view=organization"),
    );
    expect(response.status).toBe(403);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects unknown token-list query parameters", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      role: "administrator",
      user: { id: userId },
      supabase: { from: vi.fn() },
    });
    const response = await GET(
      new Request("https://curio.example.test/api/v1/tokens?include_hash=true"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("rejects repeated token-list query parameters", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      role: "administrator",
      user: { id: userId },
      supabase: { from: vi.fn() },
    });
    const response = await GET(
      new Request("https://curio.example.test/api/v1/tokens?view=organization&page=1&page=2"),
    );
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });
});
