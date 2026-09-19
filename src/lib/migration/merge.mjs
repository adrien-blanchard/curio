function comparableDate(value) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(timestamp) ? Number.POSITIVE_INFINITY : timestamp;
}

function chooseEarlier(left, right) {
  const leftDate = comparableDate(left.createdAt);
  const rightDate = comparableDate(right.createdAt);
  if (leftDate !== rightDate) return leftDate < rightDate ? left : right;
  return String(left.id).localeCompare(String(right.id), "en") <= 0 ? left : right;
}

export function mergeEntriesByCanonicalUrl(entries, entryTags = []) {
  const tagsByEntry = new Map();
  for (const relation of entryTags) {
    if (!tagsByEntry.has(relation.entryId)) tagsByEntry.set(relation.entryId, new Set());
    tagsByEntry.get(relation.entryId).add(relation.tagId);
  }

  const groups = new Map();
  for (const entry of entries) {
    const existing = groups.get(entry.canonicalUrl);
    if (!existing) {
      groups.set(entry.canonicalUrl, {
        entry,
        sourceIds: new Set([entry.id]),
        tagIds: new Set(tagsByEntry.get(entry.id) ?? []),
      });
      continue;
    }

    existing.entry = chooseEarlier(existing.entry, entry);
    existing.sourceIds.add(entry.id);
    for (const tagId of tagsByEntry.get(entry.id) ?? []) existing.tagIds.add(tagId);
  }

  return [...groups.values()]
    .map(({ entry, sourceIds, tagIds }) =>
      Object.freeze({
        ...entry,
        sourceIds: [...sourceIds].sort((left, right) => left.localeCompare(right, "en")),
        tagIds: [...tagIds].sort((left, right) => left.localeCompare(right, "en")),
      }),
    )
    .sort((left, right) => left.canonicalUrl.localeCompare(right.canonicalUrl, "en"));
}

export function coalesceTags(tags) {
  const bySlug = new Map();
  const sourceIdToSlug = new Map();
  for (const tag of [...tags].sort((left, right) => {
    const dateDifference = comparableDate(left.createdAt) - comparableDate(right.createdAt);
    return dateDifference || left.id.localeCompare(right.id, "en");
  })) {
    if (!bySlug.has(tag.slug)) bySlug.set(tag.slug, tag);
    sourceIdToSlug.set(tag.id, tag.slug);
  }
  return Object.freeze({
    tags: [...bySlug.values()].sort((left, right) => left.slug.localeCompare(right.slug, "en")),
    sourceIdToSlug,
  });
}
