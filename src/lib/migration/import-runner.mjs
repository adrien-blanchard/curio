import { opaqueFingerprint } from "./io.mjs";
import {
  applyImportedAttribution,
  applyImportedEntry,
  findImportedEntryByCanonicalUrl,
  selectEntryThumbnailAsset,
} from "./import-apply.mjs";
import { saveMigrationCheckpoint } from "./checkpoint.mjs";
import { applyArchivedThumbnail, applyThumbnailPlaceholder } from "./thumbnail.mjs";

export async function applyMigrationEntries({
  client,
  entries,
  mapAuthor,
  mapAttribution = () => null,
  attributionActorId,
  tagSlugsBySourceId,
  targetTagIds,
  thumbnailBySourceEntryId,
  thumbnailAssets,
  checkpoint,
  checkpointPath,
  applyEntry = applyImportedEntry,
  applyAttribution = applyImportedAttribution,
  findEntryByCanonicalUrl = findImportedEntryByCanonicalUrl,
  restoreThumbnail = applyArchivedThumbnail,
  assignPlaceholder = applyThumbnailPlaceholder,
  persistCheckpoint = saveMigrationCheckpoint,
  onProgress = async () => {},
}) {
  const result = {
    applied: 0,
    skipped: 0,
    thumbnailsSucceeded: 0,
    thumbnailsFailed: 0,
    placeholdersAssigned: 0,
    cleanupFailures: 0,
    attributionsRestored: 0,
    attributionsFallback: 0,
  };

  for (const entry of entries) {
    const entryFingerprint = opaqueFingerprint(entry.canonicalUrl);
    const attribution = mapAttribution(entry.createdBy);
    if (
      attribution &&
      (typeof attributionActorId !== "string" || attributionActorId.length === 0)
    ) {
      throw new Error("TARGET_ATTRIBUTION_ACTOR_REQUIRED");
    }
    if (checkpoint.completed.has(entryFingerprint)) {
      if (attribution) {
        const entryId = await findEntryByCanonicalUrl({
          client,
          canonicalUrl: entry.canonicalUrl,
        });
        await applyAttribution({
          client,
          actorUserId: attributionActorId,
          entryId,
          attribution,
        });
        result.attributionsRestored += 1;
      } else {
        result.attributionsFallback += 1;
      }
      result.skipped += 1;
      await onProgress({ ...result });
      continue;
    }

    const tagSlugs = entry.tagIds.map((tagId) => tagSlugsBySourceId.get(tagId)).filter(Boolean);
    const appliedEntry = await applyEntry({
      client,
      entry,
      authorId: mapAuthor(entry.createdBy),
      tagSlugs,
      targetTagIds,
    });
    result.applied += 1;

    if (attribution) {
      await applyAttribution({
        client,
        actorUserId: attributionActorId,
        entryId: appliedEntry.id,
        attribution,
      });
      result.attributionsRestored += 1;
    } else {
      result.attributionsFallback += 1;
    }

    const asset = selectEntryThumbnailAsset(entry, thumbnailBySourceEntryId, thumbnailAssets);
    const thumbnailResult = asset
      ? await restoreThumbnail({
          client,
          entryId: appliedEntry.id,
          previousThumbnailPath: appliedEntry.previousThumbnailPath,
          asset,
        })
      : await assignPlaceholder({
          client,
          entryId: appliedEntry.id,
          previousThumbnailPath: appliedEntry.previousThumbnailPath,
        });

    if (thumbnailResult.status === "succeeded") {
      result.thumbnailsSucceeded += 1;
    } else if (thumbnailResult.status === "placeholder") {
      result.placeholdersAssigned += 1;
    } else {
      result.thumbnailsFailed += 1;
      if (thumbnailResult.placeholderAssigned) result.placeholdersAssigned += 1;
    }
    if (thumbnailResult.cleanupFailed) result.cleanupFailures += 1;

    if (thumbnailResult.status !== "failed") {
      checkpoint.completed.add(entryFingerprint);
      await persistCheckpoint(checkpointPath, checkpoint);
    }
    await onProgress({ ...result });
  }

  return result;
}
