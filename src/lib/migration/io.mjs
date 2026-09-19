import { createHash } from "node:crypto";
import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";

export const MIGRATION_FORMAT = "curio-private-migration";
export const MIGRATION_VERSION = 1;
const MAX_ARCHIVE_ASSET_BYTES = 5 * 1024 * 1024;

export function sha256(input) {
  return createHash("sha256").update(input).digest("hex");
}

export function opaqueFingerprint(input) {
  return sha256(String(input)).slice(0, 24);
}

export function encodeNdjson(records) {
  return `${records.map((record) => JSON.stringify(record)).join("\n")}${records.length ? "\n" : ""}`;
}

export function decodeNdjson(text, label = "NDJSON") {
  const records = [];
  for (const [index, line] of text.split(/\r?\n/u).entries()) {
    if (!line.trim()) continue;
    try {
      records.push(JSON.parse(line));
    } catch {
      throw new Error(`${label} contains invalid JSON at line ${index + 1}.`);
    }
  }
  return records;
}

export async function atomicWrite(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, contents, { encoding: "utf8", mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

export async function atomicWriteBinary(filePath, contents) {
  await fs.mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporaryPath, contents, { mode: 0o600 });
  await fs.rename(temporaryPath, filePath);
}

function safeRelativeAssetFile(file) {
  return (
    typeof file === "string" &&
    /^thumbnails\/[0-9a-f]{64}\.webp$/u.test(file) &&
    path.posix.normalize(file) === file
  );
}

async function safeArchiveFile(directory, relativeFile) {
  const root = await fs.realpath(directory);
  const requested = path.resolve(directory, relativeFile);
  let resolved;
  try {
    resolved = await fs.realpath(requested);
  } catch {
    throw new Error("The migration archive contains a missing file.");
  }
  const relative = path.relative(root, resolved);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("The migration archive contains an unsafe file reference.");
  }
  const details = await fs.lstat(requested);
  if (!details.isFile() || details.isSymbolicLink()) {
    throw new Error("The migration archive contains an unsafe file reference.");
  }
  return resolved;
}

async function digestFile(filePath, maximumBytes = Number.POSITIVE_INFINITY) {
  const hash = createHash("sha256");
  let bytes = 0;
  for await (const chunk of createReadStream(filePath)) {
    bytes += chunk.byteLength;
    if (bytes > maximumBytes) {
      throw new Error("The migration export asset exceeds the 5 MiB limit.");
    }
    hash.update(chunk);
  }
  return { sha256: hash.digest("hex"), bytes };
}

export async function writeExport(
  directory,
  collections,
  createdAt = new Date().toISOString(),
  { assets = {} } = {},
) {
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const files = {};
  for (const [name, records] of Object.entries(collections).sort(([left], [right]) =>
    left.localeCompare(right, "en"),
  )) {
    const fileName = `${name}.ndjson`;
    const contents = encodeNdjson(records);
    await atomicWrite(path.join(directory, fileName), contents);
    files[name] = { file: fileName, count: records.length, sha256: sha256(contents) };
  }

  const manifestAssets = {};
  for (const [assetType, records] of Object.entries(assets)) {
    if (assetType !== "thumbnails" || !Array.isArray(records)) {
      throw new Error("The migration export contains unsupported assets.");
    }
    manifestAssets[assetType] = {};
    for (const record of records) {
      if (
        !record ||
        !/^[0-9a-f]{64}$/u.test(record.id ?? "") ||
        record.sha256 !== record.id ||
        !safeRelativeAssetFile(record.file) ||
        record.file !== `thumbnails/${record.id}.webp` ||
        record.contentType !== "image/webp" ||
        !Number.isSafeInteger(record.bytes) ||
        record.bytes < 1 ||
        record.bytes > MAX_ARCHIVE_ASSET_BYTES
      ) {
        throw new Error("The migration export contains invalid asset metadata.");
      }
      const absolutePath = await safeArchiveFile(directory, record.file);
      const actual = await digestFile(absolutePath, MAX_ARCHIVE_ASSET_BYTES);
      if (actual.sha256 !== record.sha256 || actual.bytes !== record.bytes) {
        throw new Error("The migration export asset checksum is invalid.");
      }
      manifestAssets[assetType][record.id] = {
        file: record.file,
        bytes: record.bytes,
        sha256: record.sha256,
        contentType: record.contentType,
      };
    }
  }

  const manifest = {
    format: MIGRATION_FORMAT,
    version: MIGRATION_VERSION,
    createdAt,
    files,
    ...(Object.keys(manifestAssets).length ? { assets: manifestAssets } : {}),
  };
  await atomicWrite(
    path.join(directory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return manifest;
}

export async function readExport(directory) {
  let manifest;
  try {
    const manifestPath = await safeArchiveFile(directory, "manifest.json");
    manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  } catch {
    throw new Error("The migration manifest is missing or invalid.");
  }
  if (manifest.format !== MIGRATION_FORMAT || manifest.version !== MIGRATION_VERSION) {
    throw new Error("The migration format or version is unsupported.");
  }

  const collections = {};
  for (const [name, metadata] of Object.entries(manifest.files ?? {})) {
    if (
      !/^[a-z][a-z-]*$/u.test(name) ||
      !metadata ||
      path.basename(metadata.file ?? "") !== metadata.file ||
      !Number.isSafeInteger(metadata.count) ||
      metadata.count < 0 ||
      !/^[0-9a-f]{64}$/u.test(metadata.sha256 ?? "")
    ) {
      throw new Error("The migration manifest contains an unsafe file reference.");
    }
    const absolutePath = await safeArchiveFile(directory, metadata.file);
    const contents = await fs.readFile(absolutePath, "utf8");
    if (sha256(contents) !== metadata.sha256) throw new Error(`Checksum mismatch for ${name}.`);
    const records = decodeNdjson(contents, metadata.file);
    if (records.length !== metadata.count) throw new Error(`Record count mismatch for ${name}.`);
    collections[name] = records;
  }

  const assets = {};
  for (const [assetType, records] of Object.entries(manifest.assets ?? {})) {
    if (assetType !== "thumbnails" || !records || Array.isArray(records)) {
      throw new Error("The migration manifest contains unsupported assets.");
    }
    assets[assetType] = {};
    for (const [id, metadata] of Object.entries(records)) {
      if (
        !/^[0-9a-f]{64}$/u.test(id) ||
        metadata?.sha256 !== id ||
        !safeRelativeAssetFile(metadata?.file) ||
        metadata.file !== `thumbnails/${id}.webp` ||
        metadata.contentType !== "image/webp" ||
        !Number.isSafeInteger(metadata.bytes) ||
        metadata.bytes < 1 ||
        metadata.bytes > MAX_ARCHIVE_ASSET_BYTES
      ) {
        throw new Error("The migration manifest contains invalid asset metadata.");
      }
      const absolutePath = await safeArchiveFile(directory, metadata.file);
      const actual = await digestFile(absolutePath, MAX_ARCHIVE_ASSET_BYTES);
      if (actual.sha256 !== id || actual.bytes !== metadata.bytes) {
        throw new Error(`Checksum mismatch for ${assetType} asset.`);
      }
      assets[assetType][id] = { ...metadata, absolutePath };
    }
  }
  return { manifest, collections, assets };
}
