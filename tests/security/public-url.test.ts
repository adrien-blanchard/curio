import { describe, expect, it } from "vitest";

import {
  PublicUrlError,
  canonicalizeUrl,
  isPublicIpAddress,
  resolvePublicUrl,
} from "@/lib/security/public-url";

const publicResolver = async () => [{ address: "8.8.8.8", family: 4 }];

describe("public URL policy", () => {
  it("canonicalizes tracking parameters and YouTube variants", () => {
    expect(canonicalizeUrl("https://Example.com/repo/?utm_source=test&b=2&a=1#readme")).toBe(
      "https://example.com/repo?a=1&b=2",
    );
    expect(canonicalizeUrl("https://youtu.be/dQw4w9WgXcQ?t=10")).toBe(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    );
  });

  it("removes secret-bearing query parameters before storage or analysis", () => {
    expect(
      canonicalizeUrl(
        "https://example.com/article?id=42&api_key=private&X-Amz-Signature=private&custom_token=private",
      ),
    ).toBe("https://example.com/article?id=42");
  });

  it.each([
    "http://localhost/path",
    "http://127.0.0.1/path",
    "http://2130706433/path",
    "http://[::1]/path",
    "http://[fc00::1]/path",
    "http://metadata.internal/path",
    "http://example.com:8080/path",
    "https://user:password@example.com/path",
    "file:///etc/passwd",
  ])("rejects unsafe URL %s", (url) => {
    expect(() => canonicalizeUrl(url)).toThrow(PublicUrlError);
  });

  it("rejects a hostname if any DNS answer is private", async () => {
    await expect(
      resolvePublicUrl("https://example.com", async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "10.0.0.5", family: 4 },
      ]),
    ).rejects.toMatchObject({ code: "PRIVATE_HOST" });
  });

  it("accepts public IPv4 and IPv6 results", async () => {
    expect(isPublicIpAddress("93.184.216.34")).toBe(true);
    expect(isPublicIpAddress("2606:4700:4700::1111")).toBe(true);
    expect(await resolvePublicUrl("https://example.com/", publicResolver)).toBe(
      "https://example.com/",
    );
  });
});
