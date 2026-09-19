import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AuthenticationError } from "@/lib/auth/errors";

import { stubValidAuthEnvironment } from "../auth/test-environment";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const extensionOrigin = `chrome-extension://${extensionId}`;
const userId = "00000000-0000-4000-8000-000000000301";

const mocks = vi.hoisted(() => ({
  authenticateRequest: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ authenticateRequest: mocks.authenticateRequest }));

import { GET, OPTIONS } from "@/app/api/v1/me/route";

function request(method = "GET", origin = extensionOrigin) {
  return new Request("https://curio.example.test/api/v1/me", {
    method,
    headers: { Origin: origin },
  });
}

describe("/api/v1/me", () => {
  beforeEach(() => {
    stubValidAuthEnvironment({
      EXTENSION_ENABLED: "true",
      ALLOWED_EXTENSION_IDS: extensionId,
    });
    mocks.authenticateRequest.mockReset();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.clearAllMocks();
  });

  it("returns the authenticated profile in the stable envelope with extension CORS", async () => {
    mocks.authenticateRequest.mockResolvedValue({
      user: { id: userId },
      profile: { email: "member@example.test" },
      role: "contributor",
      scopes: ["entries:write", "tags:read", "profile:read"],
    });

    const response = await GET(request());

    expect(mocks.authenticateRequest).toHaveBeenCalledWith(expect.any(Request), {
      scopes: ["profile:read"],
    });
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
    expect(response.headers.get("vary")).toBe("Origin");
    expect(await response.json()).toEqual({
      data: {
        user: {
          id: userId,
          email: "member@example.test",
          role: "contributor",
        },
        scopes: ["entries:write", "tags:read", "profile:read"],
      },
      error: null,
    });
  });

  it("preserves CORS headers on an authentication error envelope", async () => {
    mocks.authenticateRequest.mockRejectedValue(
      new AuthenticationError("INVALID_API_TOKEN", "Invalid API token"),
    );

    const response = await GET(request());

    expect(response.status).toBe(401);
    expect(response.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
    expect(await response.json()).toEqual({
      data: null,
      error: { code: "INVALID_API_TOKEN", message: "Invalid API token" },
    });
  });

  it("answers an allowed extension preflight without a response body", async () => {
    const response = OPTIONS(request("OPTIONS"));

    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-origin")).toBe(extensionOrigin);
    expect(response.headers.get("access-control-allow-methods")).toBe("GET, OPTIONS");
    expect(response.headers.get("access-control-allow-headers")).toBe(
      "Authorization, Content-Type",
    );
    expect(await response.text()).toBe("");
    expect(mocks.authenticateRequest).not.toHaveBeenCalled();
  });

  it("rejects a preflight from an unconfigured extension ID", async () => {
    const response = OPTIONS(request("OPTIONS", `chrome-extension://${"p".repeat(32)}`));

    expect(response.status).toBe(403);
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    expect(await response.json()).toEqual({
      data: null,
      error: { code: "ORIGIN_NOT_ALLOWED", message: "Extension origin is not allowed" },
    });
  });
});
