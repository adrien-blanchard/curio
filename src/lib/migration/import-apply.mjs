export async function applyImportedEntry({ client, entry, authorId, tagSlugs, targetTagIds }) {
  const isReady = entry.status === "ready";
  const row = {
    url: entry.url,
    canonical_url: entry.canonicalUrl,
    title: entry.title ?? new URL(entry.url).hostname,
    tldr: entry.summary || "Imported from the legacy Curio catalog.",
    source_type: entry.sourceType,
    status: isReady ? "ready" : "failed",
    error_code: isReady ? null : "LEGACY_IMPORT_RETRY_REQUIRED",
    error_message: isReady
      ? null
      : "This legacy entry was not ready at export time. Review and retry it in Curio.",
    created_by: authorId,
    created_at: entry.createdAt ?? undefined,
    updated_at: entry.updatedAt ?? entry.createdAt ?? undefined,
    published_at: isReady ? (entry.updatedAt ?? entry.createdAt ?? new Date().toISOString()) : null,
  };
  const { data, error } = await client
    .from("entries")
    .upsert(row, { onConflict: "canonical_url" })
    .select("id,thumbnail_path")
    .single();
  if (error || !data?.id) throw new Error("TARGET_ENTRY_UPSERT_FAILED");

  const relations = tagSlugs.map((slug) => {
    const tagId = targetTagIds.get(slug);
    if (typeof tagId !== "string" || !tagId) {
      throw new Error("TARGET_TAG_UPSERT_FAILED");
    }
    return { entry_id: data.id, tag_id: tagId };
  });
  if (relations.length) {
    const relationResult = await client
      .from("entry_tags")
      .upsert(relations, { onConflict: "entry_id,tag_id" });
    if (relationResult.error) throw new Error("TARGET_ENTRY_TAG_UPSERT_FAILED");
  }
  return {
    id: data.id,
    previousThumbnailPath: typeof data.thumbnail_path === "string" ? data.thumbnail_path : null,
  };
}

export async function findImportedEntryByCanonicalUrl({ client, canonicalUrl }) {
  const { data, error } = await client
    .from("entries")
    .select("id")
    .eq("canonical_url", canonicalUrl)
    .single();
  if (error || typeof data?.id !== "string" || !data.id) {
    throw new Error("TARGET_ENTRY_LOOKUP_FAILED");
  }
  return data.id;
}

export async function applyImportedAttribution({ client, actorUserId, entryId, attribution }) {
  const { error } = await client.rpc("upsert_entry_attribution", {
    p_actor_user_id: actorUserId,
    p_entry_id: entryId,
    p_author_email: attribution.email,
    p_display_name: attribution.displayName ?? null,
    p_avatar_url: attribution.avatarUrl ?? null,
  });
  if (error) throw new Error("TARGET_ENTRY_ATTRIBUTION_UPSERT_FAILED");
}

export function selectEntryThumbnailAsset(entry, relationByEntryId, assetsById) {
  const sourceIds = [
    entry.id,
    ...(entry.sourceIds ?? []).filter((sourceId) => sourceId !== entry.id),
  ];
  for (const sourceId of sourceIds) {
    const assetId = relationByEntryId.get(sourceId);
    if (!assetId) continue;
    const asset = assetsById[assetId];
    if (asset) return asset;
  }
  return null;
}
