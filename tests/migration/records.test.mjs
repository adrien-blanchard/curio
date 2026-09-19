import { describe, expect, it } from "vitest";
import { sanitizeEntry, sanitizeProfile, sanitizeTag } from "../../src/lib/migration/records.mjs";

describe("migration record sanitizers", () => {
  it("exports only an explicit profile allowlist", () => {
    const result = sanitizeProfile({
      id: "source-profile",
      email: "Person@Example.com",
      role: "legacy-admin",
      access_token: "must-not-survive",
      user_metadata: { private: true },
    });
    expect(result).toEqual({
      id: "source-profile",
      email: "person@example.com",
      displayName: null,
      avatarUrl: null,
      createdAt: null,
    });
    expect(result).not.toHaveProperty("access_token");
    expect(result).not.toHaveProperty("role");
  });

  it("accepts only bounded display names and Google-hosted profile avatars", () => {
    expect(
      sanitizeProfile({
        id: "source-profile",
        email: "person@example.com",
        display_name: "  Ada   Lovelace ",
        avatar_url: "https://lh3.googleusercontent.com/a/example=s96-c",
      }),
    ).toMatchObject({
      displayName: "Ada Lovelace",
      avatarUrl: "https://lh3.googleusercontent.com/a/example=s96-c",
    });
    expect(
      sanitizeProfile({
        id: "source-profile",
        email: "person@example.com",
        displayName: "a".repeat(121),
        avatarUrl: "https://attacker.example/avatar.png",
      }),
    ).toMatchObject({ displayName: null, avatarUrl: null });
  });

  it.each(["x@y", "x@y.z", "x@y.1", "x@y.c0", "a@b-.co"])(
    "rejects a source profile email the catalog UI cannot parse: %s",
    (email) => {
      expect(sanitizeProfile({ id: "source-profile", email })).toBeNull();
    },
  );

  it("redacts credential-shaped text and strips token query values", () => {
    const result = sanitizeEntry({
      id: "entry-1",
      url: "https://example.com/read?token=private&id=1",
      title: "api_key=abcdefghijklmnop",
      tldr: "Bearer abcdefghijklmnopqrstuv",
      thumbnailUrl: "https://legacy-images.example.invalid/preview.jpg",
    });
    expect(result.url).toBe("https://example.com/read?id=1");
    expect(result.title).toContain("[REDACTED]");
    expect(result.summary).toContain("[REDACTED]");
    expect(result).not.toHaveProperty("thumbnailUrl");
  });

  it("preserves the legacy source classification and fails closed for unknown values", () => {
    const base = { id: "entry-source", url: "https://example.com/resource" };
    expect(sanitizeEntry({ ...base, source_type: "opensource" }).sourceType).toBe("opensource");
    expect(sanitizeEntry({ ...base, source_type: "proprietary" }).sourceType).toBe("proprietary");
    expect(sanitizeEntry({ ...base, source_type: "unknown" }).sourceType).toBe("proprietary");
  });

  it("keeps ready entries ready and makes incomplete legacy processing explicitly retryable", () => {
    const base = { id: "entry-status", url: "https://example.com/resource" };
    expect(sanitizeEntry({ ...base, status: "ready" }).status).toBe("ready");
    expect(sanitizeEntry({ ...base, status: "failed" }).status).toBe("failed");
    expect(sanitizeEntry({ ...base, status: "processing" }).status).toBe("failed");
  });

  it("normalizes tag slugs and color", () => {
    expect(sanitizeTag({ id: "tag-1", name: "Études & Notes", color: "#AABBCC" })).toMatchObject({
      slug: "etudes-notes",
      color: "#aabbcc",
    });
    expect(sanitizeTag({ id: "tag-2", name: "Uncolored" })).toMatchObject({
      color: "#64748b",
    });
  });
});
