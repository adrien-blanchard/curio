import { createHash, timingSafeEqual } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

export const DEFAULT_REPAIR_LIMIT = 1_000;
export const MAX_REPAIR_LIMIT = 10_000;
export const CURRENT_PLACEHOLDER_SHA256 =
  "6d19a3998af2d084ca8deeda3695f2addd1cd23a0d272c459a9296879c306fcf";

const CANDIDATE_COLUMNS = "id,thumbnail_path,thumbnail_origin";
const LIST_PAGE_SIZE = 100;
const MAX_OBJECT_BYTES = 5 * 1024 * 1024;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

// Keep this source and the Sharp options byte-for-byte aligned with
// createPlaceholderThumbnail(). The parity test prevents either copy from
// changing unnoticed while this one-off historical repair remains available.
const CURRENT_PLACEHOLDER_SVG = `
    <svg width="720" height="309" viewBox="0 0 720 309" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="background" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="#e8f4fc"/>
          <stop offset="1" stop-color="#f4f7fe"/>
        </linearGradient>
      </defs>
      <rect width="720" height="309" fill="url(#background)"/>
      <circle cx="360" cy="154.5" r="58" fill="#0075c9" opacity="0.10"/>
      <circle cx="360" cy="154.5" r="32" fill="none" stroke="#0075c9" stroke-width="12"/>
      <circle cx="382" cy="132" r="8" fill="#f4f7fe"/>
    </svg>
  `;

export class PlaceholderRepairError extends Error {
  constructor(code) {
    super(code);
    this.name = "PlaceholderRepairError";
    this.code = code;
  }
}

function fail(code) {
  throw new PlaceholderRepairError(code);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest();
}

export function usage() {
  return [
    "Usage: node scripts/reclassify-placeholder-thumbnails.mjs [options]",
    "",
    "Options:",
    "  --apply                 Reclassify exact matches; omitted means read-only dry run",
    "  --confirm-host <host>   Exact Supabase hostname required with --apply",
    `  --limit <1-${MAX_REPAIR_LIMIT}>       Maximum eligible rows to inspect (default: ${DEFAULT_REPAIR_LIMIT})`,
    "  --help                  Show this help",
    "",
    "Dedicated credentials: CURIO_PLACEHOLDER_REPAIR_SUPABASE_URL and",
    "CURIO_PLACEHOLDER_REPAIR_SERVICE_ROLE_KEY.",
  ].join("\n");
}

export function parseArguments(argumentsList) {
  const options = {
    apply: false,
    confirmHost: null,
    help: false,
    limit: DEFAULT_REPAIR_LIMIT,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (argument === "--confirm-host" || argument === "--limit") {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) fail("PLACEHOLDER_REPAIR_OPTION_VALUE_REQUIRED");
      index += 1;
      if (argument === "--confirm-host") {
        options.confirmHost = value.toLowerCase();
      } else {
        if (!/^\d+$/u.test(value)) fail("PLACEHOLDER_REPAIR_LIMIT_INVALID");
        options.limit = Number(value);
      }
    } else {
      fail("PLACEHOLDER_REPAIR_ARGUMENT_UNKNOWN");
    }
  }

  if (options.help) return options;
  if (
    !Number.isSafeInteger(options.limit) ||
    options.limit < 1 ||
    options.limit > MAX_REPAIR_LIMIT
  ) {
    fail("PLACEHOLDER_REPAIR_LIMIT_INVALID");
  }
  if (!options.apply && options.confirmHost) {
    fail("PLACEHOLDER_REPAIR_CONFIRMATION_WITHOUT_APPLY");
  }
  return options;
}

function requiredCredential(environment, name) {
  const value = environment[name]?.trim();
  if (!value) fail("PLACEHOLDER_REPAIR_CREDENTIALS_REQUIRED");
  return value;
}

function isLocalTarget(target) {
  const hostname = target.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    /^127(?:[.]\d{1,3}){3}$/u.test(hostname)
  );
}

export function targetConfiguration(environment = process.env) {
  const rawUrl = requiredCredential(environment, "CURIO_PLACEHOLDER_REPAIR_SUPABASE_URL");
  const serviceRoleKey = requiredCredential(
    environment,
    "CURIO_PLACEHOLDER_REPAIR_SERVICE_ROLE_KEY",
  );
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    fail("PLACEHOLDER_REPAIR_TARGET_INVALID");
  }
  if (
    !["http:", "https:"].includes(target.protocol) ||
    target.username ||
    target.password ||
    target.search ||
    target.hash ||
    (target.pathname !== "/" && target.pathname !== "") ||
    (target.protocol !== "https:" && !isLocalTarget(target))
  ) {
    fail("PLACEHOLDER_REPAIR_TARGET_INVALID");
  }
  return { serviceRoleKey, target };
}

export function assertSafeApplyTarget(target, options, environment = process.env) {
  if (!options.apply) return;
  if (environment.CI === "true" || environment.VERCEL) {
    fail("PLACEHOLDER_REPAIR_APPLY_FORBIDDEN_IN_AUTOMATION");
  }
  if (options.confirmHost !== target.hostname.toLowerCase()) {
    fail("PLACEHOLDER_REPAIR_HOST_CONFIRMATION_REQUIRED");
  }
}

export async function createCurrentPlaceholderBuffer() {
  const buffer = await sharp(Buffer.from(CURRENT_PLACEHOLDER_SVG))
    .webp({ quality: 82, effort: 5, smartSubsample: true })
    .toBuffer();
  if (sha256(buffer).toString("hex") !== CURRENT_PLACEHOLDER_SHA256) {
    fail("PLACEHOLDER_REPAIR_GENERATOR_DRIFT");
  }
  return buffer;
}

function validateCandidate(row) {
  const normalizedId = typeof row?.id === "string" ? row.id.toLowerCase() : "";
  const pathSegments = typeof row?.thumbnail_path === "string" ? row.thumbnail_path.split("/") : [];
  if (
    !row ||
    !UUID_PATTERN.test(normalizedId) ||
    row.thumbnail_origin !== "automatic" ||
    typeof row.thumbnail_path !== "string" ||
    row.thumbnail_path.length < 1 ||
    row.thumbnail_path.length > 1_024 ||
    /[\u0000-\u001f\u007f\\]/u.test(row.thumbnail_path) ||
    pathSegments.length !== 2 ||
    pathSegments[0]?.toLowerCase() !== normalizedId ||
    !/^[A-Za-z0-9][A-Za-z0-9._-]{0,255}[.]webp$/u.test(pathSegments[1] ?? "")
  ) {
    fail("PLACEHOLDER_REPAIR_CANDIDATE_INVALID");
  }
  return {
    id: normalizedId,
    thumbnailPath: row.thumbnail_path,
  };
}

function assertNoCandidateCollisions(candidates) {
  const ids = new Set();
  const paths = new Set();
  for (const candidate of candidates) {
    if (ids.has(candidate.id) || paths.has(candidate.thumbnailPath)) {
      fail("PLACEHOLDER_REPAIR_CANDIDATE_COLLISION");
    }
    ids.add(candidate.id);
    paths.add(candidate.thumbnailPath);
  }
}

async function toBoundedBuffer(value) {
  if (!value || typeof value.arrayBuffer !== "function") {
    fail("PLACEHOLDER_REPAIR_OBJECT_INVALID");
  }
  if (typeof value.size === "number" && value.size > MAX_OBJECT_BYTES) {
    fail("PLACEHOLDER_REPAIR_OBJECT_TOO_LARGE");
  }
  let buffer;
  try {
    buffer = Buffer.from(await value.arrayBuffer());
  } catch {
    fail("PLACEHOLDER_REPAIR_OBJECT_INVALID");
  }
  if (buffer.byteLength > MAX_OBJECT_BYTES) fail("PLACEHOLDER_REPAIR_OBJECT_TOO_LARGE");
  return buffer;
}

export function createSupabaseRepository(client) {
  return {
    async listCandidates(limit) {
      const rows = [];
      while (rows.length <= limit) {
        const remaining = limit + 1 - rows.length;
        const pageSize = Math.min(LIST_PAGE_SIZE, remaining);
        const offset = rows.length;
        const { data, error } = await client
          .from("entries")
          .select(CANDIDATE_COLUMNS)
          .eq("thumbnail_origin", "automatic")
          .not("thumbnail_path", "is", null)
          .order("id", { ascending: true })
          .range(offset, offset + pageSize - 1);
        if (error || !Array.isArray(data)) fail("PLACEHOLDER_REPAIR_LIST_FAILED");
        rows.push(...data);
        if (data.length < pageSize) break;
      }
      if (rows.length > limit) fail("PLACEHOLDER_REPAIR_LIMIT_EXCEEDED");
      return rows;
    },

    async downloadObject(objectPath) {
      const { data, error } = await client.storage.from("thumbnails").download(objectPath);
      if (error || !data) fail("PLACEHOLDER_REPAIR_DOWNLOAD_FAILED");
      return data;
    },

    async reclassify(candidate) {
      const { data, error } = await client
        .from("entries")
        .update({ thumbnail_origin: "placeholder" })
        .eq("id", candidate.id)
        .eq("thumbnail_origin", "automatic")
        .eq("thumbnail_path", candidate.thumbnailPath)
        .select(CANDIDATE_COLUMNS);
      if (error) fail("PLACEHOLDER_REPAIR_UPDATE_FAILED");
      if (
        !Array.isArray(data) ||
        data.length !== 1 ||
        data[0]?.id?.toLowerCase() !== candidate.id ||
        data[0]?.thumbnail_path !== candidate.thumbnailPath ||
        data[0]?.thumbnail_origin !== "placeholder"
      ) {
        fail("PLACEHOLDER_REPAIR_UPDATE_CONFLICT");
      }
    },
  };
}

export async function executePlaceholderRepair(
  repository,
  { apply = false, limit = DEFAULT_REPAIR_LIMIT, placeholderBuffer, hashBuffer = sha256 } = {},
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_REPAIR_LIMIT) {
    fail("PLACEHOLDER_REPAIR_LIMIT_INVALID");
  }

  const expected = placeholderBuffer ?? (await createCurrentPlaceholderBuffer());
  if (!Buffer.isBuffer(expected) || expected.byteLength === 0) {
    fail("PLACEHOLDER_REPAIR_FINGERPRINT_INVALID");
  }
  const expectedHash = hashBuffer(expected);
  if (!Buffer.isBuffer(expectedHash) || expectedHash.byteLength !== 32) {
    fail("PLACEHOLDER_REPAIR_FINGERPRINT_INVALID");
  }

  const rawCandidates = await repository.listCandidates(limit);
  if (!Array.isArray(rawCandidates) || rawCandidates.length > limit) {
    fail("PLACEHOLDER_REPAIR_LIST_FAILED");
  }
  const candidates = rawCandidates.map(validateCandidate);
  assertNoCandidateCollisions(candidates);

  const matches = [];
  for (const candidate of candidates) {
    const downloaded = await toBoundedBuffer(
      await repository.downloadObject(candidate.thumbnailPath),
    );
    const downloadedHash = hashBuffer(downloaded);
    if (!Buffer.isBuffer(downloadedHash) || downloadedHash.byteLength !== 32) {
      fail("PLACEHOLDER_REPAIR_FINGERPRINT_INVALID");
    }
    if (!timingSafeEqual(downloadedHash, expectedHash)) continue;
    if (downloaded.byteLength !== expected.byteLength || !timingSafeEqual(downloaded, expected)) {
      fail("PLACEHOLDER_REPAIR_HASH_COLLISION");
    }
    matches.push(candidate);
  }

  let updated = 0;
  if (apply) {
    for (const candidate of matches) {
      await repository.reclassify(candidate);
      updated += 1;
    }
  }

  return {
    matched: matches.length,
    notMatched: candidates.length - matches.length,
    scanned: candidates.length,
    updated,
  };
}

export async function run(options, environment = process.env, clientFactory = createClient) {
  const { serviceRoleKey, target } = targetConfiguration(environment);
  assertSafeApplyTarget(target, options, environment);
  const client = clientFactory(target.origin, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
  return executePlaceholderRepair(createSupabaseRepository(client), options);
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const report = await run(options);
    process.stdout.write(`${JSON.stringify(report)}\n`);
    if (!options.apply) {
      process.stdout.write("Dry run only. Re-run with --apply and the exact confirmed host.\n");
    }
  } catch (error) {
    const code =
      error instanceof PlaceholderRepairError ? error.code : "UNEXPECTED_PLACEHOLDER_REPAIR_ERROR";
    process.stderr.write(`Placeholder repair failed: ${code}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
