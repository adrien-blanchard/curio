import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { stubValidAuthEnvironment } from "./test-environment";

describe("personal API token format and hashing", () => {
  beforeEach(() => {
    vi.resetModules();
    stubValidAuthEnvironment();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("generates a base64url token, a display prefix, and only its hash", async () => {
    const { API_TOKEN_PREFIX, generateApiToken, isApiToken } = await import("@/lib/auth/tokens");
    const generated = generateApiToken();

    expect(generated.rawToken).toMatch(/^curio_pat_[A-Za-z0-9_-]{43}$/u);
    expect(isApiToken(generated.rawToken)).toBe(true);
    expect(generated.tokenPrefix).toBe(generated.rawToken.slice(0, API_TOKEN_PREFIX.length + 8));
    expect(generated.tokenHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(generated.tokenHash).not.toContain(generated.rawToken);
  });

  it("hashes deterministically with the server-only pepper", async () => {
    const rawToken = `curio_pat_${"a".repeat(43)}`;
    const firstModule = await import("@/lib/auth/tokens");
    const first = firstModule.hashApiToken(rawToken);
    expect(firstModule.hashApiToken(rawToken)).toBe(first);

    vi.resetModules();
    stubValidAuthEnvironment({
      API_TOKEN_PEPPER: "a-different-synthetic-pepper-at-least-32-characters",
    });
    const secondModule = await import("@/lib/auth/tokens");
    expect(secondModule.hashApiToken(rawToken)).not.toBe(first);
  });

  it("rejects the wrong prefix and out-of-contract lengths", async () => {
    const { isApiToken } = await import("@/lib/auth/tokens");
    expect(isApiToken(`other_pat_${"a".repeat(43)}`)).toBe(false);
    expect(isApiToken("curio_pat_too-short")).toBe(false);
    expect(isApiToken(`curio_pat_${"a".repeat(129)}`)).toBe(false);
  });
});
