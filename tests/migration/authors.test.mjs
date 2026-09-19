import { describe, expect, it } from "vitest";
import {
  createAttributionMapper,
  createAuthorMapper,
  resolveInitialAdministrator,
} from "../../src/lib/migration/authors.mjs";

const sourceProfiles = [
  { id: "source-match", email: "member@example.com" },
  { id: "source-missing", email: "former@example.com" },
];
const targetProfiles = [
  { id: "target-match", email: "member@example.com", role: "contributor" },
  { id: "target-admin", email: "admin@example.com", role: "administrator" },
];

describe("legacy author mapping", () => {
  it("maps only an exact profile email and otherwise uses the configured initial admin", () => {
    const mapAuthor = createAuthorMapper({
      sourceProfiles,
      targetProfiles,
      initialAdminEmails: ["admin@example.com"],
    });
    expect(mapAuthor("source-match")).toBe("target-match");
    expect(mapAuthor("source-missing")).toBe("target-admin");
    expect(mapAuthor("unknown")).toBe("target-admin");
  });

  it("fails closed when the fallback is not an administrator", () => {
    expect(() =>
      createAuthorMapper({
        sourceProfiles,
        targetProfiles,
        initialAdminEmails: ["member@example.com"],
      }),
    ).toThrow(/administrator/u);
  });

  it("resolves the initial administrator without exposing it in migration reports", () => {
    expect(
      resolveInitialAdministrator({
        targetProfiles,
        initialAdminEmails: ["ADMIN@EXAMPLE.COM"],
      }),
    ).toEqual(targetProfiles[1]);
  });

  it("keeps historical display attribution separate from ownership", () => {
    const mapAttribution = createAttributionMapper({
      sourceProfiles: [
        {
          id: "source-match",
          email: "Member@Example.com",
          displayName: "Source Member",
          avatarUrl: "https://lh3.googleusercontent.com/a/source=s96-c",
        },
      ],
    });

    expect(mapAttribution("source-match")).toEqual({
      email: "member@example.com",
      displayName: "Source Member",
      avatarUrl: "https://lh3.googleusercontent.com/a/source=s96-c",
    });
    expect(mapAttribution("unknown")).toBeNull();
  });

  it("accepts private identity overrides and validates their source and avatar host", () => {
    const source = [{ id: "legacy-user", email: "legacy@example.com" }];
    expect(
      createAttributionMapper({
        sourceProfiles: source,
        overrides: [
          {
            sourceProfileId: "legacy-user",
            displayName: "  Legacy   Author ",
            avatarUrl: "https://lh3.googleusercontent.com/a/legacy=s96-c",
          },
        ],
      })("legacy-user"),
    ).toEqual({
      email: "legacy@example.com",
      displayName: "Legacy Author",
      avatarUrl: "https://lh3.googleusercontent.com/a/legacy=s96-c",
    });

    expect(() =>
      createAttributionMapper({
        sourceProfiles: source,
        overrides: [
          {
            sourceProfileId: "legacy-user",
            avatarUrl: "https://attacker.example/avatar.png",
          },
        ],
      }),
    ).toThrow("MIGRATION_ATTRIBUTION_CONFIGURATION_INVALID");
    expect(() =>
      createAttributionMapper({
        sourceProfiles: source,
        overrides: [{ sourceProfileId: "unknown", displayName: "Unknown" }],
      }),
    ).toThrow("MIGRATION_ATTRIBUTION_CONFIGURATION_INVALID");
  });
});
