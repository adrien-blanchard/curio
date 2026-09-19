import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubValidAuthEnvironment } from "../auth/test-environment";

const extensionId = "abcdefghijklmnopabcdefghijklmnop";
const extensionOrigin = `chrome-extension://${extensionId}`;

describe("extension CORS helpers", () => {
  beforeEach(() => {
    vi.resetModules();
    stubValidAuthEnvironment({
      EXTENSION_ENABLED: "true",
      ALLOWED_EXTENSION_IDS: extensionId,
    });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("emits only the configured extension origin and requested methods", async () => {
    const { extensionCorsHeaders } = await import("@/lib/api/cors");
    const headers = extensionCorsHeaders(
      new Request("https://curio.example.test/api/v1/entries", {
        headers: { Origin: extensionOrigin },
      }),
      ["POST", "OPTIONS"],
    );

    expect(Object.fromEntries(headers)).toEqual({
      "access-control-allow-headers": "Authorization, Content-Type",
      "access-control-allow-methods": "POST, OPTIONS",
      "access-control-allow-origin": extensionOrigin,
      "access-control-max-age": "86400",
      vary: "Origin",
    });
  });

  it("does not emit cross-origin headers for a normal web origin", async () => {
    const { extensionCorsHeaders } = await import("@/lib/api/cors");
    const headers = extensionCorsHeaders(
      new Request("https://curio.example.test/api/v1/me", {
        headers: { Origin: "https://attacker.example.test" },
      }),
      ["GET", "OPTIONS"],
    );

    expect([...headers]).toEqual([]);
  });

  it("rejects an unconfigured Chrome origin before a mutating route is processed", async () => {
    const { prepareExtensionResponse } = await import("@/lib/api/extension-response");
    const request = new Request("https://curio.example.test/api/v1/entries", {
      method: "POST",
      headers: { Origin: `chrome-extension://${"p".repeat(32)}` },
    });

    expect(() => prepareExtensionResponse(request, ["POST", "OPTIONS"])).toThrowError(
      expect.objectContaining({ status: 403, code: "ORIGIN_NOT_ALLOWED" }),
    );
  });

  it("fails preflight closed when extension access is disabled", async () => {
    vi.resetModules();
    stubValidAuthEnvironment({
      EXTENSION_ENABLED: "false",
      ALLOWED_EXTENSION_IDS: "",
    });
    const { extensionPreflight } = await import("@/lib/api/cors");

    const response = extensionPreflight(
      new Request("https://curio.example.test/api/v1/me", {
        method: "OPTIONS",
        headers: { Origin: extensionOrigin },
      }),
      ["GET", "OPTIONS"],
    );

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      data: null,
      error: { code: "ORIGIN_NOT_ALLOWED", message: "Extension origin is not allowed" },
    });
  });
});
