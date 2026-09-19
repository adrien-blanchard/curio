import { describe, expect, it } from "vitest";

import {
  applyImportedAttribution,
  applyImportedEntry,
  findImportedEntryByCanonicalUrl,
  selectEntryThumbnailAsset,
} from "../../src/lib/migration/import-apply.mjs";
import { mergeEntriesByCanonicalUrl } from "../../src/lib/migration/merge.mjs";
import { sanitizeEntry } from "../../src/lib/migration/records.mjs";

const TARGET_ENTRY_ID = "11111111-1111-4111-8111-111111111111";
const AUTHOR_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

function importClient({ previousThumbnailPath = null } = {}) {
  const calls = { entries: [], relations: [], lookups: [], rpc: [] };
  const client = {
    async rpc(name, parameters) {
      calls.rpc.push({ name, parameters });
      return { data: [], error: null };
    },
    from(table) {
      if (table === "entries") {
        return {
          select(columns) {
            expect(columns).toBe("id");
            return {
              eq(column, value) {
                calls.lookups.push({ column, value });
                return {
                  async single() {
                    return { data: { id: TARGET_ENTRY_ID }, error: null };
                  },
                };
              },
            };
          },
          upsert(row, options) {
            calls.entries.push({ row, options });
            return {
              select(columns) {
                expect(columns).toBe("id,thumbnail_path");
                return {
                  async single() {
                    return {
                      data: {
                        id: TARGET_ENTRY_ID,
                        thumbnail_path: previousThumbnailPath,
                      },
                      error: null,
                    };
                  },
                };
              },
            };
          },
        };
      }
      if (table === "entry_tags") {
        return {
          async upsert(rows, options) {
            calls.relations.push({ rows, options });
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table: ${table}`);
    },
  };
  return { client, calls };
}

describe("migration apply rows", () => {
  it.each([
    ["processing", "opensource"],
    ["failed", "proprietary"],
  ])(
    "maps legacy %s to a constraint-valid failed row with exact %s source_type",
    async (legacyStatus, sourceType) => {
      const entry = sanitizeEntry({
        id: `legacy-${legacyStatus}`,
        url: `https://example.com/${legacyStatus}`,
        sourceType,
        status: legacyStatus,
        createdAt: "2025-01-01T00:00:00.000Z",
        updatedAt: "2025-02-01T00:00:00.000Z",
      });
      const { client, calls } = importClient();

      await applyImportedEntry({
        client,
        entry,
        authorId: AUTHOR_ID,
        tagSlugs: [],
        targetTagIds: new Map(),
      });

      expect(calls.entries[0]).toMatchObject({
        options: { onConflict: "canonical_url" },
        row: {
          source_type: sourceType,
          status: "failed",
          error_code: "LEGACY_IMPORT_RETRY_REQUIRED",
          error_message:
            "This legacy entry was not ready at export time. Review and retry it in Curio.",
          published_at: null,
          created_by: AUTHOR_ID,
          created_at: "2025-01-01T00:00:00.000Z",
          updated_at: "2025-02-01T00:00:00.000Z",
        },
      });
    },
  );

  it("keeps a ready row valid and preserves its dates", async () => {
    const entry = sanitizeEntry({
      id: "legacy-ready",
      url: "https://example.com/ready",
      title: "Ready title",
      summary: "Ready summary",
      sourceType: "opensource",
      status: "ready",
      createdAt: "2025-01-01T00:00:00.000Z",
      updatedAt: "2025-03-01T00:00:00.000Z",
    });
    const { client, calls } = importClient();

    await applyImportedEntry({
      client,
      entry,
      authorId: AUTHOR_ID,
      tagSlugs: [],
      targetTagIds: new Map(),
    });

    expect(calls.entries[0].row).toMatchObject({
      source_type: "opensource",
      status: "ready",
      error_code: null,
      error_message: null,
      published_at: "2025-03-01T00:00:00.000Z",
      created_at: "2025-01-01T00:00:00.000Z",
      updated_at: "2025-03-01T00:00:00.000Z",
    });
  });

  it("merges a canonical conflict, unions tags, and uses a duplicate thumbnail fallback", async () => {
    const older = {
      ...sanitizeEntry({
        id: "older",
        url: "https://example.com/article?utm_source=old",
        sourceType: "proprietary",
        status: "ready",
        createdAt: "2025-01-01T00:00:00.000Z",
      }),
    };
    const newer = {
      ...sanitizeEntry({
        id: "newer",
        url: "https://example.com/article",
        sourceType: "proprietary",
        status: "ready",
        createdAt: "2025-02-01T00:00:00.000Z",
      }),
    };
    const [merged] = mergeEntriesByCanonicalUrl(
      [newer, older],
      [
        { entryId: "older", tagId: "tag-one" },
        { entryId: "newer", tagId: "tag-two" },
      ],
    );
    const relationByEntryId = new Map([["newer", "b".repeat(64)]]);
    const duplicateAsset = { sha256: "b".repeat(64) };
    const { client, calls } = importClient({
      previousThumbnailPath: `${TARGET_ENTRY_ID}/previous.webp`,
    });

    const result = await applyImportedEntry({
      client,
      entry: merged,
      authorId: AUTHOR_ID,
      tagSlugs: ["one", "two"],
      targetTagIds: new Map([
        ["one", "tag-target-one"],
        ["two", "tag-target-two"],
      ]),
    });

    expect(merged).toMatchObject({ id: "older", tagIds: ["tag-one", "tag-two"] });
    expect(calls.entries[0].options).toEqual({ onConflict: "canonical_url" });
    expect(calls.relations[0]).toEqual({
      rows: [
        { entry_id: TARGET_ENTRY_ID, tag_id: "tag-target-one" },
        { entry_id: TARGET_ENTRY_ID, tag_id: "tag-target-two" },
      ],
      options: { onConflict: "entry_id,tag_id" },
    });
    expect(result.previousThumbnailPath).toBe(`${TARGET_ENTRY_ID}/previous.webp`);
    expect(
      selectEntryThumbnailAsset(merged, relationByEntryId, {
        [duplicateAsset.sha256]: duplicateAsset,
      }),
    ).toBe(duplicateAsset);
  });

  it("resolves a checkpointed entry and restores attribution through the guarded RPC", async () => {
    const { client, calls } = importClient();
    const entryId = await findImportedEntryByCanonicalUrl({
      client,
      canonicalUrl: "https://example.com/article",
    });
    await applyImportedAttribution({
      client,
      actorUserId: AUTHOR_ID,
      entryId,
      attribution: {
        email: "legacy@example.com",
        displayName: "Legacy Author",
        avatarUrl: "https://lh3.googleusercontent.com/a/legacy=s96-c",
      },
    });

    expect(calls.lookups).toEqual([
      { column: "canonical_url", value: "https://example.com/article" },
    ]);
    expect(calls.rpc).toEqual([
      {
        name: "upsert_entry_attribution",
        parameters: {
          p_actor_user_id: AUTHOR_ID,
          p_entry_id: TARGET_ENTRY_ID,
          p_author_email: "legacy@example.com",
          p_display_name: "Legacy Author",
          p_avatar_url: "https://lh3.googleusercontent.com/a/legacy=s96-c",
        },
      },
    ]);
  });
});
