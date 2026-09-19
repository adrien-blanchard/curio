import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubValidAuthEnvironment } from "./test-environment";

describe("cookie-request Origin protection", () => {
  beforeEach(() => {
    vi.resetModules();
    stubValidAuthEnvironment();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it.each(["GET", "HEAD", "OPTIONS"])(
    "does not require Origin for safe %s requests",
    async (method) => {
      const { assertCsrfOrigin } = await import("@/lib/auth/csrf");
      expect(() =>
        assertCsrfOrigin(new Request("https://curio.example.test/api", { method })),
      ).not.toThrow();
    },
  );

  it("accepts the exact configured origin independent of URL path", async () => {
    const { assertCsrfOrigin } = await import("@/lib/auth/csrf");
    const request = new Request("https://curio.example.test/api", {
      method: "POST",
      headers: { Origin: "https://CURIO.example.test:443/some/path" },
    });
    expect(() => assertCsrfOrigin(request)).not.toThrow();
  });

  it.each([
    ["missing", undefined],
    ["malformed", "not a URL"],
    ["subdomain", "https://sub.curio.example.test"],
    ["lookalike", "https://curio.example.test.evil.invalid"],
    ["different scheme", "http://curio.example.test"],
    ["different port", "https://curio.example.test:444"],
  ])("rejects a %s Origin on a mutation", async (_label, origin) => {
    const { assertCsrfOrigin } = await import("@/lib/auth/csrf");
    const headers = new Headers();
    if (origin) headers.set("Origin", origin);
    const request = new Request("https://curio.example.test/api", {
      method: "DELETE",
      headers,
    });
    expect(() => assertCsrfOrigin(request)).toThrowError(
      expect.objectContaining({ code: "CSRF_ORIGIN_MISMATCH", status: 403 }),
    );
  });
});
