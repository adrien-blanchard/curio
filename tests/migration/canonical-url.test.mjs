import { describe, expect, it } from "vitest";
import { canonicalizeUrl, tryCanonicalizeUrl } from "../../src/lib/migration/canonical-url.mjs";

describe("canonicalizeUrl", () => {
  it("normalizes host, fragment, query order, tracking data, and trailing slash", () => {
    expect(canonicalizeUrl("HTTPS://Example.COM:443/path/?z=2&utm_source=x&a=1#private")).toBe(
      "https://example.com/path?a=1&z=2",
    );
  });

  it("removes credential-shaped query parameters", () => {
    expect(canonicalizeUrl("https://example.com/item?id=7&token=do-not-export")).toBe(
      "https://example.com/item?id=7",
    );
  });

  it("rejects embedded credentials and unsupported schemes", () => {
    expect(() => canonicalizeUrl("https://user:pass@example.com/private")).toThrow();
    expect(tryCanonicalizeUrl("file:///private/file")).toBeNull();
  });
});
