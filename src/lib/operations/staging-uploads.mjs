const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const UPLOAD_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}[.]upload$/u;
const LIST_PAGE_SIZE = 100;

async function listPage(bucket, prefix, offset) {
  const { data, error } = await bucket.list(prefix, {
    limit: LIST_PAGE_SIZE,
    offset,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error("STAGING_UPLOAD_LIST_FAILED");
  return data ?? [];
}

export async function collectStaleUploadPaths(
  bucket,
  { now = Date.now(), olderThanMs = 60 * 60 * 1000, limit = 1_000 } = {},
) {
  if (!Number.isSafeInteger(now) || !Number.isSafeInteger(olderThanMs) || olderThanMs < 60_000) {
    throw new Error("INVALID_STAGING_CLEANUP_WINDOW");
  }
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
    throw new Error("INVALID_STAGING_CLEANUP_LIMIT");
  }

  const cutoff = now - olderThanMs;
  const paths = [];
  let scanned = 0;
  let skippedWithoutTimestamp = 0;

  for (let folderOffset = 0; paths.length < limit; folderOffset += LIST_PAGE_SIZE) {
    const folders = await listPage(bucket, "", folderOffset);
    for (const folder of folders) {
      if (!UUID_PATTERN.test(folder.name)) continue;
      for (let objectOffset = 0; paths.length < limit; objectOffset += LIST_PAGE_SIZE) {
        const objects = await listPage(bucket, folder.name, objectOffset);
        for (const object of objects) {
          if (!UPLOAD_PATTERN.test(object.name)) continue;
          scanned += 1;
          const timestamp = Date.parse(object.created_at ?? object.updated_at ?? "");
          if (!Number.isFinite(timestamp)) {
            skippedWithoutTimestamp += 1;
          } else if (timestamp <= cutoff) {
            paths.push(`${folder.name}/${object.name}`);
            if (paths.length >= limit) break;
          }
        }
        if (objects.length < LIST_PAGE_SIZE) break;
      }
      if (paths.length >= limit) break;
    }
    if (folders.length < LIST_PAGE_SIZE) break;
  }

  return { paths, scanned, skippedWithoutTimestamp };
}

export async function removeStaleUploadPaths(bucket, paths) {
  if (
    !Array.isArray(paths) ||
    paths.length > 10_000 ||
    paths.some((path) => {
      const [folder, name, extra] = String(path).split("/");
      return Boolean(extra) || !UUID_PATTERN.test(folder) || !UPLOAD_PATTERN.test(name);
    })
  ) {
    throw new Error("INVALID_STAGING_UPLOAD_PATHS");
  }
  let removed = 0;
  for (let offset = 0; offset < paths.length; offset += LIST_PAGE_SIZE) {
    const batch = paths.slice(offset, offset + LIST_PAGE_SIZE);
    const { error } = await bucket.remove(batch);
    if (error) throw new Error("STAGING_UPLOAD_REMOVE_FAILED");
    removed += batch.length;
  }
  return removed;
}
