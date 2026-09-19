import { describe, expect, it } from "vitest";

import { getTrustedAvatarUrl } from "@/lib/auth/avatar";

describe("getTrustedAvatarUrl", () => {
  it("accepts the Google OAuth avatar host over HTTPS", () => {
    expect(getTrustedAvatarUrl("https://lh3.googleusercontent.com/a/example=s96-c")).toBe(
      "https://lh3.googleusercontent.com/a/example=s96-c",
    );
  });

  it.each([
    "http://lh3.googleusercontent.com/a/example",
    "https://lh3.googleusercontent.com.evil.example/a/example",
    "https://example.com/avatar.png",
    "data:image/png;base64,AA==",
    "not a URL",
    "",
    null,
    undefined,
  ])("rejects untrusted avatar input %s", (value) => {
    expect(getTrustedAvatarUrl(value)).toBeNull();
  });
});
