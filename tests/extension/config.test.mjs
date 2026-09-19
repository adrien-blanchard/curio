import { describe, expect, it } from "vitest";
import {
  MAX_ARTICLE_URL_LENGTH,
  REQUIRED_SCOPES,
  instancePermissionPattern,
  missingRequiredScopes,
  normalizeArticleUrl,
  normalizeInstanceUrl,
  normalizePersonalToken,
  scopesFromProfile,
} from "../../extension/lib/config.mjs";

describe("extension configuration", () => {
  it("normalizes secure instance origins", () => {
    expect(normalizeInstanceUrl(" https://curio.example.test:8443/ ")).toBe(
      "https://curio.example.test:8443",
    );
    expect(instancePermissionPattern("https://curio.example.test")).toBe(
      "https://curio.example.test/*",
    );
  });

  it("allows HTTP only for local development", () => {
    expect(normalizeInstanceUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeInstanceUrl("http://127.0.0.1:3000/")).toBe("http://127.0.0.1:3000");
    expect(instancePermissionPattern("http://localhost:3000")).toBe("http://localhost/*");
    expect(() => normalizeInstanceUrl("http://curio.example.test")).toThrow(/HTTPS/u);
  });

  it("rejects instance paths, credentials, queries, and unsupported schemes", () => {
    expect(() => normalizeInstanceUrl("https://curio.example.test/team")).toThrow(/origin only/u);
    expect(() => normalizeInstanceUrl("https://user:pass@curio.example.test")).toThrow(
      /credentials/u,
    );
    expect(() => normalizeInstanceUrl("https://curio.example.test?x=1")).toThrow(/query/u);
    expect(() => normalizeInstanceUrl("file:///tmp/curio")).toThrow(/HTTPS/u);
  });

  it("validates personal tokens without assuming a vendor format", () => {
    const token = `curio_pat_${"test".repeat(8)}`;
    expect(normalizePersonalToken(` ${token} `)).toBe(token);
    expect(() => normalizePersonalToken(`Bearer ${token}`)).toThrow(/Bearer/u);
    expect(() => normalizePersonalToken("short-token")).toThrow(/format/u);
    expect(() => normalizePersonalToken(`${token}\nsecond`)).toThrow(/format/u);
  });

  it("normalizes article URLs and strips fragments", () => {
    expect(normalizeArticleUrl("https://example.test/article?q=1#section")).toBe(
      "https://example.test/article?q=1",
    );
    expect(() => normalizeArticleUrl("chrome://extensions")).toThrow(/HTTP/u);
    expect(() => normalizeArticleUrl("https://user:pass@example.test")).toThrow(/HTTP/u);
    expect(() =>
      normalizeArticleUrl(`https://example.test/${"a".repeat(MAX_ARTICLE_URL_LENGTH)}`),
    ).toThrow(/valid page URL/u);
  });

  it("reads the exact backend scope envelope", () => {
    const payload = { data: { user: { id: "user-1" }, scopes: [...REQUIRED_SCOPES] }, error: null };
    expect(scopesFromProfile(payload)).toEqual(REQUIRED_SCOPES);
    expect(missingRequiredScopes(payload)).toEqual([]);
    expect(missingRequiredScopes({ data: { scopes: ["tags:read"] } })).toEqual([
      "entries:write",
      "profile:read",
    ]);
  });
});
