import { canonicalizeUrl, tryCanonicalizeUrl } from "./canonical-url.mjs";
import { normalizeEmail, redactText, safeString } from "./redaction.mjs";

function dateOrNull(input) {
  if (!input) return null;
  const date = new Date(input);
  return Number.isNaN(date.valueOf()) ? null : date.toISOString();
}

function identifier(input) {
  if (input === null || input === undefined) return null;
  const value = String(input).trim();
  return value && value.length <= 256 ? value : null;
}

function displayNameOrNull(input) {
  if (typeof input !== "string") return null;
  const value = input.normalize("NFKC").replace(/\s+/gu, " ").trim();
  return value && value.length <= 120 && !/[\p{Cc}\p{Cf}]/u.test(value) ? value : null;
}

function googleAvatarUrlOrNull(input) {
  if (typeof input !== "string" || !input.trim()) return null;
  try {
    const url = new URL(input.trim());
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.port ||
      url.hostname.toLowerCase() !== "lh3.googleusercontent.com" ||
      url.toString().length > 2_048
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function sanitizeProfile(record) {
  const id = identifier(record.id);
  const email = normalizeEmail(record.email);
  if (!id || !email) return null;
  return Object.freeze({
    id,
    email,
    displayName: displayNameOrNull(record.displayName ?? record.display_name),
    avatarUrl: googleAvatarUrlOrNull(record.avatarUrl ?? record.avatar_url),
    createdAt: dateOrNull(record.createdAt ?? record.created_at),
  });
}

export function sanitizeEntry(record) {
  const id = identifier(record.id);
  const url = tryCanonicalizeUrl(record.url);
  if (!id || !url || redactText(url) !== url) return null;
  const sourceType = safeString(record.sourceType ?? record.source_type, {
    maximumLength: 32,
  })?.toLowerCase();
  const legacyStatus = safeString(record.status, { maximumLength: 32 })?.toLowerCase();

  return Object.freeze({
    id,
    url,
    canonicalUrl: canonicalizeUrl(url),
    title: safeString(record.title, { maximumLength: 300 }),
    summary: safeString(record.summary ?? record.tldr, { maximumLength: 5_000 }),
    // The legacy schema used the same two values as Curio v1. Unknown values
    // fail closed to the more restrictive classification.
    sourceType: sourceType === "opensource" ? "opensource" : "proprietary",
    // A legacy processing row has no durable workflow run in the new system.
    // Import it as failed so an owner can retry it explicitly after validation.
    status: legacyStatus === "ready" ? "ready" : "failed",
    createdBy: identifier(record.createdBy ?? record.created_by),
    createdAt: dateOrNull(record.createdAt ?? record.created_at),
    updatedAt: dateOrNull(record.updatedAt ?? record.updated_at),
  });
}

export function slugify(input) {
  return String(input ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 80);
}

export function sanitizeTag(record) {
  const id = identifier(record.id);
  const name = safeString(record.name, { maximumLength: 80 });
  const slug = slugify(record.slug || name);
  if (!id || !name || !slug) return null;
  const color = /^#[0-9a-f]{6}$/iu.test(String(record.color ?? ""))
    ? String(record.color).toLowerCase()
    : "#64748b";
  return Object.freeze({
    id,
    name,
    slug,
    color,
    createdAt: dateOrNull(record.createdAt ?? record.created_at),
  });
}

export function sanitizeEntryTag(record) {
  const entryId = identifier(record.entryId ?? record.entry_id);
  const tagId = identifier(record.tagId ?? record.tag_id);
  return entryId && tagId ? Object.freeze({ entryId, tagId }) : null;
}

export function sanitizeEntryThumbnail(record) {
  const entryId = identifier(record.entryId ?? record.entry_id);
  const assetSha256 = String(record.assetSha256 ?? record.asset_sha256 ?? "")
    .trim()
    .toLowerCase();
  if (!entryId || !/^[0-9a-f]{64}$/u.test(assetSha256)) return null;
  return Object.freeze({ entryId, assetSha256 });
}
