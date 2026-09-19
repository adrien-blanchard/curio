import { beforeEach, describe, expect, it, vi } from "vitest";

const userId = "00000000-0000-4000-8000-000000000901";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
  synchronizeAllowedEmailAccess: vi.fn(),
}));

vi.mock("@/lib/env/server", () => ({
  getAuthEnv: () => ({
    APP_ORIGIN: "http://localhost:3000",
    ALLOWED_EMAIL_DOMAINS: ["example.test"],
    ALLOWED_EMAIL_ADDRESSES: [],
    DEFAULT_USER_ROLE: "contributor",
    INITIAL_ADMIN_EMAILS: ["admin@example.test"],
  }),
}));
vi.mock("@/lib/auth/domain-configuration", () => ({
  synchronizeAllowedEmailAccess: mocks.synchronizeAllowedEmailAccess,
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      signOut: mocks.signOut,
    },
  }),
  createServiceRoleClient: () => ({ rpc: mocks.rpc }),
}));

import { GET } from "@/app/auth/callback/route";

describe("Google OAuth callback", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.synchronizeAllowedEmailAccess.mockResolvedValue(undefined);
    mocks.exchangeCodeForSession.mockResolvedValue({
      data: {
        user: {
          id: userId,
          email: "member@example.test",
          user_metadata: {
            full_name: "  Ada   Lovelace ",
            avatar_url: "https://lh3.googleusercontent.com/a/curio=s96-c",
          },
        },
      },
      error: null,
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
  });

  it("bootstraps the profile and synchronizes the trusted Google identity", async () => {
    const response = await GET(new Request("http://localhost:3000/auth/callback?code=oauth-code"));

    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "bootstrap_profile", {
      p_user_id: userId,
      p_email: "member@example.test",
      p_default_role: "contributor",
      p_is_initial_administrator: false,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "sync_profile_identity", {
      p_user_id: userId,
      p_display_name: "Ada Lovelace",
      p_avatar_url: "https://lh3.googleusercontent.com/a/curio=s96-c",
    });
    expect(mocks.signOut).not.toHaveBeenCalled();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/dashboard");
  });

  it("ends the session when the identity snapshot cannot be persisted", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mocks.rpc
      .mockResolvedValueOnce({ data: null, error: null })
      .mockResolvedValueOnce({ data: null, error: { code: "DATABASE_ERROR" } });

    const response = await GET(new Request("http://localhost:3000/auth/callback?code=oauth-code"));

    expect(mocks.signOut).toHaveBeenCalledOnce();
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "http://localhost:3000/login?error=account_unavailable",
    );
    consoleError.mockRestore();
  });
});
