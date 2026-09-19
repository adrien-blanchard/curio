import { promises as fs } from "node:fs";
import path from "node:path";

import sharp from "sharp";

import { atomicWriteBinary, sha256 } from "./io.mjs";

export const LEGACY_THUMBNAIL_BUCKET = "thumbnails";
export const THUMBNAIL_ARCHIVE_DIRECTORY = "thumbnails";
export const THUMBNAIL_CONTENT_TYPE = "image/webp";
export const MAX_THUMBNAIL_BYTES = 5 * 1024 * 1024;
export const MAX_THUMBNAIL_DIMENSION = 8_192;
export const MAX_THUMBNAIL_PIXELS = 40_000_000;
export const THUMBNAIL_WIDTH = 720;
export const THUMBNAIL_HEIGHT = 309;

const TRUSTED_REMOTE_HOSTS = new Set(["i.ytimg.com", "opengraph.githubassets.com"]);
const ALLOWED_FORMATS = new Set(["jpeg", "png", "webp"]);

export class MigrationThumbnailError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "MigrationThumbnailError";
    this.code = code;
  }
}

function safeSourceOrigin(input) {
  let url;
  try {
    url = new URL(input);
  } catch {
    throw new MigrationThumbnailError(
      "INVALID_SOURCE_ORIGIN",
      "The source storage origin is invalid.",
    );
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new MigrationThumbnailError(
      "INVALID_SOURCE_ORIGIN",
      "The source storage origin is invalid.",
    );
  }
  return url.origin;
}

function safeObjectPath(input) {
  if (typeof input !== "string") return null;
  let value = input
    .normalize("NFKC")
    .trim()
    .replace(/^\/+|\/+$/gu, "");
  if (value.startsWith(`${LEGACY_THUMBNAIL_BUCKET}/`)) {
    value = value.slice(LEGACY_THUMBNAIL_BUCKET.length + 1);
  }
  if (!value || value.length > 1_024 || /[\\?#\u0000-\u001f\u007f]/u.test(value)) {
    return null;
  }
  const segments = value.split("/");
  if (
    segments.some(
      (segment) => !segment || segment === "." || segment === ".." || segment.length > 255,
    )
  ) {
    return null;
  }
  return segments.join("/");
}

function storagePathFromUrl(url, sourceOrigin) {
  if (url.origin !== sourceOrigin) return null;
  const marker = `/storage/v1/object/`;
  if (!url.pathname.startsWith(marker)) return null;
  const remainder = url.pathname.slice(marker.length);
  const match = /^(?:public|sign|authenticated)\/([^/]+)\/(.+)$/u.exec(remainder);
  if (!match || match[1] !== LEGACY_THUMBNAIL_BUCKET) return null;
  try {
    return safeObjectPath(
      match[2]
        .split("/")
        .map((segment) => decodeURIComponent(segment))
        .join("/"),
    );
  } catch {
    return null;
  }
}

export function classifyLegacyThumbnailReference(input, sourceUrl) {
  if (typeof input !== "string" || !input.trim()) return null;
  const sourceOrigin = safeSourceOrigin(sourceUrl);
  const value = input.trim();

  let candidateUrl = null;
  try {
    candidateUrl = value.startsWith("/") ? new URL(value, sourceOrigin) : new URL(value);
  } catch {
    const objectPath = safeObjectPath(value);
    return objectPath ? { kind: "storage", objectPath } : null;
  }

  if (
    candidateUrl.protocol !== "https:" ||
    candidateUrl.username ||
    candidateUrl.password ||
    candidateUrl.port
  ) {
    return null;
  }

  const objectPath = storagePathFromUrl(candidateUrl, sourceOrigin);
  if (objectPath) return { kind: "storage", objectPath };
  if (!TRUSTED_REMOTE_HOSTS.has(candidateUrl.hostname.toLowerCase())) return null;

  candidateUrl.search = "";
  candidateUrl.hash = "";
  return { kind: "trusted-remote", url: candidateUrl.toString() };
}

function encodedObjectPath(objectPath) {
  return objectPath
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

async function readLimitedResponse(response) {
  if (response.status >= 300 && response.status < 400) {
    throw new MigrationThumbnailError(
      "REDIRECT_NOT_ALLOWED",
      "Thumbnail redirects are not allowed.",
    );
  }
  if (!response.ok || !response.body) {
    throw new MigrationThumbnailError("DOWNLOAD_FAILED", "The thumbnail could not be downloaded.");
  }

  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_THUMBNAIL_BYTES) {
    throw new MigrationThumbnailError("IMAGE_TOO_LARGE", "The thumbnail exceeds the 5 MiB limit.");
  }

  const chunks = [];
  let bytesRead = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    if (bytesRead > MAX_THUMBNAIL_BYTES) {
      await reader.cancel();
      throw new MigrationThumbnailError(
        "IMAGE_TOO_LARGE",
        "The thumbnail exceeds the 5 MiB limit.",
      );
    }
    chunks.push(Buffer.from(value));
  }
  return Buffer.concat(chunks);
}

export async function downloadLegacyThumbnail(
  reference,
  { sourceUrl, serviceRoleKey, fetcher = fetch },
) {
  const classified = classifyLegacyThumbnailReference(reference, sourceUrl);
  if (!classified) {
    throw new MigrationThumbnailError(
      "UNTRUSTED_THUMBNAIL_SOURCE",
      "The legacy thumbnail source is not allowlisted.",
    );
  }

  let response;
  if (classified.kind === "storage") {
    if (typeof serviceRoleKey !== "string" || !serviceRoleKey) {
      throw new MigrationThumbnailError(
        "SOURCE_CONFIGURATION_MISSING",
        "The source storage credential is missing.",
      );
    }
    const origin = safeSourceOrigin(sourceUrl);
    const storageUrl = `${origin}/storage/v1/object/authenticated/${LEGACY_THUMBNAIL_BUCKET}/${encodedObjectPath(classified.objectPath)}`;
    response = await fetcher(storageUrl, {
      method: "GET",
      redirect: "manual",
      headers: {
        Accept: "image/jpeg,image/png,image/webp",
        Authorization: `Bearer ${serviceRoleKey}`,
        apikey: serviceRoleKey,
      },
    });
  } else {
    response = await fetcher(classified.url, {
      method: "GET",
      redirect: "manual",
      headers: { Accept: "image/jpeg,image/png,image/webp" },
    });
  }
  return readLimitedResponse(response);
}

export async function normalizeLegacyThumbnail(input) {
  if (!Buffer.isBuffer(input) || input.byteLength === 0) {
    throw new MigrationThumbnailError("INVALID_IMAGE", "The thumbnail is empty or unreadable.");
  }
  if (input.byteLength > MAX_THUMBNAIL_BYTES) {
    throw new MigrationThumbnailError("IMAGE_TOO_LARGE", "The thumbnail exceeds the 5 MiB limit.");
  }

  let metadata;
  try {
    metadata = await sharp(input, {
      animated: false,
      failOn: "warning",
      limitInputPixels: MAX_THUMBNAIL_PIXELS,
    }).metadata();
  } catch {
    throw new MigrationThumbnailError(
      "INVALID_IMAGE",
      "The thumbnail is not a safe, readable image.",
    );
  }
  if (!metadata.format || !ALLOWED_FORMATS.has(metadata.format)) {
    throw new MigrationThumbnailError(
      "UNSUPPORTED_IMAGE_TYPE",
      "Only JPEG, PNG, and WebP thumbnails are supported.",
    );
  }
  if (
    !metadata.width ||
    !metadata.height ||
    metadata.width > MAX_THUMBNAIL_DIMENSION ||
    metadata.height > MAX_THUMBNAIL_DIMENSION ||
    metadata.width * metadata.height > MAX_THUMBNAIL_PIXELS ||
    (metadata.pages ?? 1) > 1
  ) {
    throw new MigrationThumbnailError(
      "INVALID_IMAGE",
      "The thumbnail dimensions or frame count are unsupported.",
    );
  }

  const buffer = await sharp(input, {
    animated: false,
    failOn: "warning",
    limitInputPixels: MAX_THUMBNAIL_PIXELS,
  })
    .rotate()
    .resize({
      width: THUMBNAIL_WIDTH,
      height: THUMBNAIL_HEIGHT,
      fit: "cover",
      position: sharp.strategy.attention,
    })
    .webp({ quality: 76, effort: 5, smartSubsample: true })
    .toBuffer();

  return {
    buffer,
    contentType: THUMBNAIL_CONTENT_TYPE,
    width: THUMBNAIL_WIDTH,
    height: THUMBNAIL_HEIGHT,
  };
}

export async function writeThumbnailArchiveAsset(directory, buffer) {
  const digest = sha256(buffer);
  const file = `${THUMBNAIL_ARCHIVE_DIRECTORY}/${digest}.webp`;
  await atomicWriteBinary(path.join(directory, file), buffer);
  return {
    id: digest,
    file,
    bytes: buffer.byteLength,
    sha256: digest,
    contentType: THUMBNAIL_CONTENT_TYPE,
  };
}

function ownedThumbnailPath(entryId, candidate) {
  return (
    typeof candidate === "string" &&
    candidate.length <= 1_024 &&
    candidate.startsWith(`${entryId}/`) &&
    !candidate.includes("\\") &&
    !candidate.split("/").some((segment) => segment === "..")
  );
}

async function removeOwnedThumbnail(client, entryId, candidate) {
  if (!candidate) return false;
  if (!ownedThumbnailPath(entryId, candidate)) return true;
  try {
    const cleanup = await client.storage.from(LEGACY_THUMBNAIL_BUCKET).remove([candidate]);
    return Boolean(cleanup.error);
  } catch {
    return true;
  }
}

async function resetThumbnail(client, entryId, previousThumbnailPath) {
  let result;
  try {
    result = await client.from("entries").update({ thumbnail_path: null }).eq("id", entryId);
  } catch {
    return { cleared: false, cleanupFailed: true };
  }
  if (result.error) return { cleared: false, cleanupFailed: true };
  const cleanupFailed = await removeOwnedThumbnail(client, entryId, previousThumbnailPath);
  return { cleared: true, cleanupFailed };
}

export async function validateArchivedThumbnailAsset(asset) {
  if (
    !asset ||
    typeof asset.absolutePath !== "string" ||
    !/^[0-9a-f]{64}$/u.test(asset.sha256 ?? "") ||
    !Number.isSafeInteger(asset.bytes) ||
    asset.bytes < 1 ||
    asset.bytes > MAX_THUMBNAIL_BYTES ||
    asset.contentType !== THUMBNAIL_CONTENT_TYPE
  ) {
    throw new MigrationThumbnailError(
      "INVALID_ARCHIVE_ASSET",
      "The archived thumbnail metadata is invalid.",
    );
  }

  let buffer;
  let metadata;
  try {
    buffer = await fs.readFile(asset.absolutePath);
    if (
      buffer.byteLength !== asset.bytes ||
      buffer.byteLength > MAX_THUMBNAIL_BYTES ||
      sha256(buffer) !== asset.sha256
    ) {
      throw new Error("checksum");
    }
    metadata = await sharp(buffer, {
      animated: false,
      failOn: "warning",
      limitInputPixels: MAX_THUMBNAIL_PIXELS,
    }).metadata();
  } catch {
    throw new MigrationThumbnailError(
      "INVALID_ARCHIVE_ASSET",
      "The archived thumbnail is missing, modified, or unreadable.",
    );
  }
  if (
    metadata.format !== "webp" ||
    metadata.width !== THUMBNAIL_WIDTH ||
    metadata.height !== THUMBNAIL_HEIGHT ||
    (metadata.pages ?? 1) !== 1
  ) {
    throw new MigrationThumbnailError(
      "INVALID_ARCHIVE_ASSET",
      "The archived thumbnail is not a normalized Curio WebP image.",
    );
  }
  try {
    await sharp(buffer, {
      animated: false,
      failOn: "warning",
      limitInputPixels: MAX_THUMBNAIL_PIXELS,
    })
      .raw()
      .toBuffer();
  } catch {
    throw new MigrationThumbnailError(
      "INVALID_ARCHIVE_ASSET",
      "The archived thumbnail cannot be fully decoded.",
    );
  }
  return buffer;
}

export async function applyThumbnailPlaceholder({ client, entryId, previousThumbnailPath }) {
  const reset = await resetThumbnail(client, entryId, previousThumbnailPath);
  return {
    status: reset.cleared ? "placeholder" : "failed",
    placeholderAssigned: reset.cleared,
    cleanupFailed: reset.cleanupFailed,
  };
}

export async function applyArchivedThumbnail({ client, entryId, previousThumbnailPath, asset }) {
  let buffer;
  try {
    buffer = await validateArchivedThumbnailAsset(asset);
  } catch {
    const reset = await resetThumbnail(client, entryId, previousThumbnailPath);
    return {
      status: "failed",
      placeholderAssigned: reset.cleared,
      cleanupFailed: reset.cleanupFailed,
    };
  }
  const objectPath = `${entryId}/migration-${asset.sha256}.webp`;

  let upload;
  try {
    upload = await client.storage.from(LEGACY_THUMBNAIL_BUCKET).upload(objectPath, buffer, {
      contentType: THUMBNAIL_CONTENT_TYPE,
      cacheControl: "31536000, immutable",
      upsert: true,
    });
  } catch {
    upload = { error: true };
  }
  if (upload.error) {
    const reset = await resetThumbnail(client, entryId, previousThumbnailPath);
    return {
      status: "failed",
      placeholderAssigned: reset.cleared,
      cleanupFailed: reset.cleanupFailed,
    };
  }

  let link;
  try {
    link = await client.from("entries").update({ thumbnail_path: objectPath }).eq("id", entryId);
  } catch {
    link = { error: true };
  }
  if (link.error) {
    const uploadedCleanupFailed = await removeOwnedThumbnail(client, entryId, objectPath);
    const reset = await resetThumbnail(client, entryId, previousThumbnailPath);
    return {
      status: "failed",
      placeholderAssigned: reset.cleared,
      cleanupFailed: uploadedCleanupFailed || reset.cleanupFailed,
    };
  }

  let cleanupFailed = false;
  if (previousThumbnailPath && previousThumbnailPath !== objectPath) {
    cleanupFailed = await removeOwnedThumbnail(client, entryId, previousThumbnailPath);
  }
  return { status: "succeeded", objectPath, cleanupFailed };
}
