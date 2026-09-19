import { describe, expect, it, vi } from "vitest";

import { applyMigrationEntries } from "../../src/lib/migration/import-runner.mjs";
import { opaqueFingerprint } from "../../src/lib/migration/io.mjs";

const TARGET_ENTRY_ID = "11111111-1111-4111-8111-111111111111";

function entry(id) {
  return {
    id,
    canonicalUrl: `https://example.com/${id}`,
    createdBy: "source-author",
    tagIds: [],
    sourceIds: [id],
  };
}

function argumentsFor(entries, checkpoint) {
  return {
    client: {},
    entries,
    mapAuthor: () => "target-author",
    tagSlugsBySourceId: new Map(),
    targetTagIds: new Map(),
    thumbnailBySourceEntryId: new Map(),
    thumbnailAssets: {},
    checkpoint,
    checkpointPath: "private-checkpoint.json",
  };
}

describe("apply migration runner", () => {
  it("skips checkpointed entries and persists each newly completed entry", async () => {
    const first = entry("first");
    const second = entry("second");
    const checkpoint = {
      version: 1,
      manifestDigest: "archive-digest",
      completed: new Set([opaqueFingerprint(first.canonicalUrl)]),
    };
    const applyEntry = vi.fn(async () => ({
      id: TARGET_ENTRY_ID,
      previousThumbnailPath: null,
    }));
    const persistCheckpoint = vi.fn(async () => {});
    const onProgress = vi.fn(async () => {});

    const result = await applyMigrationEntries({
      ...argumentsFor([first, second], checkpoint),
      applyEntry,
      assignPlaceholder: vi.fn(async () => ({
        status: "placeholder",
        cleanupFailed: false,
      })),
      persistCheckpoint,
      onProgress,
    });

    expect(result).toMatchObject({ applied: 1, skipped: 1, placeholdersAssigned: 1 });
    expect(applyEntry).toHaveBeenCalledTimes(1);
    expect(checkpoint.completed).toContain(opaqueFingerprint(second.canonicalUrl));
    expect(persistCheckpoint).toHaveBeenCalledTimes(1);
    expect(onProgress).toHaveBeenCalledTimes(2);
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ applied: 1, skipped: 1 }),
    );
  });

  it("does not checkpoint a failed thumbnail and retries it on the next apply", async () => {
    const sourceEntry = entry("retry");
    const asset = { sha256: "a".repeat(64) };
    const checkpoint = {
      version: 1,
      manifestDigest: "archive-digest",
      completed: new Set(),
    };
    const applyEntry = vi.fn(async () => ({
      id: TARGET_ENTRY_ID,
      previousThumbnailPath: null,
    }));
    const persistCheckpoint = vi.fn(async () => {});
    const base = {
      ...argumentsFor([sourceEntry], checkpoint),
      thumbnailBySourceEntryId: new Map([[sourceEntry.id, asset.sha256]]),
      thumbnailAssets: { [asset.sha256]: asset },
      applyEntry,
      persistCheckpoint,
    };

    const failed = await applyMigrationEntries({
      ...base,
      restoreThumbnail: vi.fn(async () => ({
        status: "failed",
        cleanupFailed: false,
      })),
    });
    expect(failed).toMatchObject({ applied: 1, thumbnailsFailed: 1 });
    expect(checkpoint.completed).toHaveLength(0);
    expect(persistCheckpoint).not.toHaveBeenCalled();

    const retried = await applyMigrationEntries({
      ...base,
      restoreThumbnail: vi.fn(async () => ({
        status: "succeeded",
        cleanupFailed: false,
      })),
    });
    expect(retried).toMatchObject({ applied: 1, thumbnailsSucceeded: 1 });
    expect(applyEntry).toHaveBeenCalledTimes(2);
    expect(checkpoint.completed).toContain(opaqueFingerprint(sourceEntry.canonicalUrl));
    expect(persistCheckpoint).toHaveBeenCalledTimes(1);
  });

  it("restores historical attribution even when an older checkpoint skips entry content", async () => {
    const sourceEntry = entry("checkpointed");
    const checkpoint = {
      version: 1,
      manifestDigest: "archive-digest",
      completed: new Set([opaqueFingerprint(sourceEntry.canonicalUrl)]),
    };
    const attribution = {
      email: "legacy@example.com",
      displayName: "Legacy Author",
      avatarUrl: null,
    };
    const findEntryByCanonicalUrl = vi.fn(async () => TARGET_ENTRY_ID);
    const applyAttribution = vi.fn(async () => {});
    const applyEntry = vi.fn();

    const result = await applyMigrationEntries({
      ...argumentsFor([sourceEntry], checkpoint),
      mapAttribution: () => attribution,
      attributionActorId: "target-admin",
      findEntryByCanonicalUrl,
      applyAttribution,
      applyEntry,
    });

    expect(result).toMatchObject({
      applied: 0,
      skipped: 1,
      attributionsRestored: 1,
      attributionsFallback: 0,
    });
    expect(applyEntry).not.toHaveBeenCalled();
    expect(findEntryByCanonicalUrl).toHaveBeenCalledWith({
      client: {},
      canonicalUrl: sourceEntry.canonicalUrl,
    });
    expect(applyAttribution).toHaveBeenCalledWith({
      client: {},
      actorUserId: "target-admin",
      entryId: TARGET_ENTRY_ID,
      attribution,
    });
  });

  it("restores attribution before checkpointing a newly imported entry", async () => {
    const sourceEntry = entry("new-attribution");
    const checkpoint = {
      version: 1,
      manifestDigest: "archive-digest",
      completed: new Set(),
    };
    const attribution = {
      email: "legacy@example.com",
      displayName: null,
      avatarUrl: null,
    };
    const applyEntry = vi.fn(async () => ({
      id: TARGET_ENTRY_ID,
      previousThumbnailPath: null,
    }));
    const applyAttribution = vi.fn(async () => {});
    const persistCheckpoint = vi.fn(async () => {});

    const result = await applyMigrationEntries({
      ...argumentsFor([sourceEntry], checkpoint),
      mapAttribution: () => attribution,
      attributionActorId: "target-admin",
      applyEntry,
      applyAttribution,
      assignPlaceholder: vi.fn(async () => ({
        status: "placeholder",
        cleanupFailed: false,
      })),
      persistCheckpoint,
    });

    expect(result).toMatchObject({
      applied: 1,
      attributionsRestored: 1,
      attributionsFallback: 0,
    });
    expect(applyAttribution).toHaveBeenCalledWith({
      client: {},
      actorUserId: "target-admin",
      entryId: TARGET_ENTRY_ID,
      attribution,
    });
    expect(persistCheckpoint).toHaveBeenCalledOnce();
  });

  it("does not checkpoint an entry whose attribution restoration fails", async () => {
    const sourceEntry = entry("failed-attribution");
    const checkpoint = {
      version: 1,
      manifestDigest: "archive-digest",
      completed: new Set(),
    };
    const persistCheckpoint = vi.fn(async () => {});
    const assignPlaceholder = vi.fn();

    await expect(
      applyMigrationEntries({
        ...argumentsFor([sourceEntry], checkpoint),
        mapAttribution: () => ({
          email: "legacy@example.com",
          displayName: null,
          avatarUrl: null,
        }),
        attributionActorId: "target-admin",
        applyEntry: vi.fn(async () => ({
          id: TARGET_ENTRY_ID,
          previousThumbnailPath: null,
        })),
        applyAttribution: vi.fn(async () => {
          throw new Error("TARGET_ENTRY_ATTRIBUTION_UPSERT_FAILED");
        }),
        assignPlaceholder,
        persistCheckpoint,
      }),
    ).rejects.toThrow("TARGET_ENTRY_ATTRIBUTION_UPSERT_FAILED");

    expect(assignPlaceholder).not.toHaveBeenCalled();
    expect(persistCheckpoint).not.toHaveBeenCalled();
    expect(checkpoint.completed).toHaveLength(0);
  });
});
