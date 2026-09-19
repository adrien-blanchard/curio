import { describe, expect, it } from "vitest";

import { getTrustedOAuthIdentity } from "@/lib/auth/identity";

describe("getTrustedOAuthIdentity", () => {
  it("normalizes the Google display name and accepts its trusted avatar", () => {
    expect(
      getTrustedOAuthIdentity({
        full_name: "  Ada   Lovelace  ",
        avatar_url: "https://lh3.googleusercontent.com/a/example=s96-c",
      }),
    ).toEqual({
      displayName: "Ada Lovelace",
      avatarUrl: "https://lh3.googleusercontent.com/a/example=s96-c",
    });
  });

  it("supports Google's alternate name and picture metadata keys", () => {
    expect(
      getTrustedOAuthIdentity({
        name: "Grace Hopper",
        picture: "https://lh3.googleusercontent.com/a/alternate=s96-c",
      }),
    ).toEqual({
      displayName: "Grace Hopper",
      avatarUrl: "https://lh3.googleusercontent.com/a/alternate=s96-c",
    });
  });

  it("drops unsafe or oversized identity metadata", () => {
    expect(
      getTrustedOAuthIdentity({
        full_name: "a".repeat(121),
        avatar_url: "https://attacker.example/avatar.png",
      }),
    ).toEqual({ displayName: null, avatarUrl: null });
  });

  it.each([null, undefined, "metadata", [], 42])(
    "handles a non-object metadata value %s",
    (metadata) => {
      expect(getTrustedOAuthIdentity(metadata)).toEqual({
        displayName: null,
        avatarUrl: null,
      });
    },
  );
});
