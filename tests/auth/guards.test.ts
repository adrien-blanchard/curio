import { describe, expect, it } from "vitest";

import { requireRole, requireScopes, type AuthenticatedActor } from "@/lib/auth/guards";

function actor(
  role: AuthenticatedActor["role"],
  scopes: AuthenticatedActor["scopes"],
): AuthenticatedActor {
  return {
    mode: "api_token",
    user: { id: "00000000-0000-4000-8000-000000000001", email: "user@example.test" },
    profile: {
      id: "00000000-0000-4000-8000-000000000001",
      email: "user@example.test",
      role,
      isActive: true,
    },
    role,
    scopes,
    tokenId: "00000000-0000-4000-8000-000000000002",
    tokenHash: "a".repeat(64),
    supabase: {} as AuthenticatedActor["supabase"],
  };
}

describe("actor authorization helpers", () => {
  it("returns the same actor when its role is allowed", () => {
    const contributor = actor("contributor", ["entries:write"]);
    expect(requireRole(contributor, ["contributor", "administrator"])).toBe(contributor);
  });

  it("fails with a stable 403 error when the role is insufficient", () => {
    expect(() => requireRole(actor("reader", ["tags:read"]), ["administrator"])).toThrowError(
      expect.objectContaining({ code: "INSUFFICIENT_ROLE", status: 403 }),
    );
  });

  it("requires every requested token scope", () => {
    const contributor = actor("contributor", ["entries:write", "tags:read"]);
    expect(requireScopes(contributor, ["entries:write", "tags:read"])).toBe(contributor);
    expect(() => requireScopes(contributor, ["profile:read"])).toThrowError(
      expect.objectContaining({ code: "INSUFFICIENT_SCOPE", status: 403 }),
    );
  });
});
