import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieClient: vi.fn(),
  tokenClient: vi.fn(),
  sync: vi.fn(),
  getUser: vi.fn(),
  profile: vi.fn(),
  token: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: mocks.cookieClient,
  createAnonymousSupabaseClient: mocks.tokenClient,
}));
vi.mock("@/lib/auth/domain-configuration", () => ({
  synchronizeAllowedEmailAccess: mocks.sync,
}));

import { authenticateRequest } from "@/lib/auth/guards";
import { generateApiToken } from "@/lib/auth/tokens";
import { stubValidAuthEnvironment } from "./test-environment";

const userId = "00000000-0000-4000-8000-000000000001";
const email = "member@example.test";
const profile = { id: userId, email, role: "contributor", is_active: true };
const identity = {
  token_id: "00000000-0000-4000-8000-000000000002",
  user_id: userId,
  email,
  role: "contributor",
  scopes: ["entries:write"],
};

function request(headers: HeadersInit = {}) {
  return new Request("https://curio.example.test/api/v1/entries", {
    method: "POST",
    headers,
  });
}

describe("request authentication boundary", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    stubValidAuthEnvironment();
    mocks.sync.mockResolvedValue(undefined);
    mocks.getUser.mockResolvedValue({ data: { user: { id: userId, email } }, error: null });
    mocks.profile.mockResolvedValue({ data: profile, error: null });
    mocks.cookieClient.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      from: () => ({ select: () => ({ eq: () => ({ maybeSingle: mocks.profile }) }) }),
    });
    mocks.token.mockResolvedValue({ data: identity, error: null });
    mocks.rpc.mockReturnValue({ maybeSingle: mocks.token });
    mocks.tokenClient.mockReturnValue({ rpc: mocks.rpc });
  });
  afterEach(() => vi.unstubAllEnvs());

  it("authenticates a same-origin session using its active database role", async () => {
    const actor = await authenticateRequest(request({ Origin: "https://curio.example.test" }), {
      requireCsrf: true,
      roles: ["contributor"],
      scopes: ["entries:write"],
    });
    expect(actor).toMatchObject({ mode: "cookie", role: "contributor", tokenHash: null });
  });

  it("rejects a cross-origin cookie mutation before consulting the session", async () => {
    await expect(
      authenticateRequest(request({ Origin: "https://untrusted.example.test" }), {
        requireCsrf: true,
      }),
    ).rejects.toMatchObject({ code: "CSRF_ORIGIN_MISMATCH", status: 403 });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it("rejects an expired session", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    await expect(authenticateRequest(request())).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
  });

  it("rejects inactive members even with a valid session", async () => {
    mocks.profile.mockResolvedValue({ data: { ...profile, is_active: false }, error: null });
    await expect(authenticateRequest(request())).rejects.toMatchObject({
      code: "ACCOUNT_UNAVAILABLE",
    });
  });

  it("rejects a session outside the configured email allowlist", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: { id: userId, email: "member@untrusted.test" } },
      error: null,
    });
    await expect(authenticateRequest(request())).rejects.toMatchObject({
      code: "DOMAIN_NOT_ALLOWED",
    });
  });

  it("hashes a token before the database call and does not fall back to cookies", async () => {
    const token = generateApiToken();
    const actor = await authenticateRequest(
      request({ Authorization: `Bearer ${token.rawToken}` }),
      { requireCsrf: true, scopes: ["entries:write"] },
    );
    expect(actor.mode).toBe("api_token");
    expect(mocks.rpc).toHaveBeenCalledWith("authenticate_api_token", {
      p_token_hash: token.tokenHash,
      p_required_scopes: ["entries:write"],
    });
    expect(mocks.cookieClient).not.toHaveBeenCalled();
  });

  it("rejects revoked tokens without falling back to a browser session", async () => {
    mocks.token.mockResolvedValue({ data: null, error: null });
    await expect(
      authenticateRequest(request({ Authorization: `Bearer ${generateApiToken().rawToken}` })),
    ).rejects.toMatchObject({ code: "INVALID_API_TOKEN" });
    expect(mocks.cookieClient).not.toHaveBeenCalled();
  });

  it("rejects tokens on session-only routes", async () => {
    await expect(
      authenticateRequest(request({ Authorization: `Bearer ${generateApiToken().rawToken}` }), {
        allowApiToken: false,
      }),
    ).rejects.toMatchObject({ code: "AUTHENTICATION_REQUIRED" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects cookies on token-only routes", async () => {
    await expect(authenticateRequest(request(), { allowCookie: false })).rejects.toMatchObject({
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(mocks.cookieClient).not.toHaveBeenCalled();
  });

  it("checks required scopes even if the database returns an identity", async () => {
    await expect(
      authenticateRequest(request({ Authorization: `Bearer ${generateApiToken().rawToken}` }), {
        scopes: ["tags:read"],
      }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SCOPE", status: 403 });
  });

  it("checks token email access against current configuration", async () => {
    mocks.token.mockResolvedValue({
      data: { ...identity, email: "member@untrusted.test" },
      error: null,
    });
    await expect(
      authenticateRequest(request({ Authorization: `Bearer ${generateApiToken().rawToken}` })),
    ).rejects.toMatchObject({ code: "DOMAIN_NOT_ALLOWED" });
  });

  it("enforces the database role on authenticated requests", async () => {
    await expect(
      authenticateRequest(request(), { roles: ["administrator"] }),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_ROLE", status: 403 });
  });
});
