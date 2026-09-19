import { describe, expect, it } from "vitest";
import { coalesceTags, mergeEntriesByCanonicalUrl } from "../../src/lib/migration/merge.mjs";

describe("legacy deduplication", () => {
  it("keeps the earliest entry and unions all source tags", () => {
    const entries = [
      {
        id: "new",
        canonicalUrl: "https://example.com/a",
        createdAt: "2025-02-02T00:00:00.000Z",
        title: "new",
      },
      {
        id: "old",
        canonicalUrl: "https://example.com/a",
        createdAt: "2025-01-01T00:00:00.000Z",
        title: "old",
      },
    ];
    const result = mergeEntriesByCanonicalUrl(entries, [
      { entryId: "new", tagId: "two" },
      { entryId: "old", tagId: "one" },
      { entryId: "old", tagId: "two" },
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ id: "old", title: "old", tagIds: ["one", "two"] });
  });

  it("coalesces tag identities by normalized slug", () => {
    const result = coalesceTags([
      { id: "later", slug: "research", name: "Later", createdAt: "2025-02-01T00:00:00.000Z" },
      { id: "earlier", slug: "research", name: "Earlier", createdAt: "2025-01-01T00:00:00.000Z" },
    ]);
    expect(result.tags).toEqual([
      { id: "earlier", slug: "research", name: "Earlier", createdAt: "2025-01-01T00:00:00.000Z" },
    ]);
    expect(result.sourceIdToSlug.get("later")).toBe("research");
  });
});
