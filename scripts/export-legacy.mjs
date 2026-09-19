#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  sanitizeEntry,
  sanitizeEntryTag,
  sanitizeProfile,
  sanitizeTag,
  downloadLegacyThumbnail,
  normalizeLegacyThumbnail,
  writeThumbnailArchiveAsset,
  writeExport,
} from "../src/lib/migration/index.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_SCHEMA = Object.freeze({
  profiles: {
    table: "user_profiles",
    columns: {
      id: "id",
      email: "email",
      displayName: false,
      avatarUrl: false,
      createdAt: "created_at",
    },
  },
  entries: {
    table: "entries",
    columns: {
      id: "id",
      url: "url",
      title: "title",
      summary: "tldr",
      sourceType: "source_type",
      status: "status",
      createdBy: "created_by",
      createdAt: "created_at",
      updatedAt: "updated_at",
      thumbnailReference: "thumbnail_url",
    },
  },
  tags: {
    table: "tags",
    columns: { id: "id", name: "name", slug: "slug", color: "color", createdAt: "created_at" },
  },
  entryTags: {
    table: "entry_tags",
    columns: { entryId: "entry_id", tagId: "tag_id" },
  },
});

const REQUIRED_COLUMNS = Object.freeze({
  profiles: ["id", "email"],
  entries: ["id", "url"],
  tags: ["id", "name"],
  entryTags: ["entryId", "tagId"],
});

function usage() {
  return [
    "Usage: npm run migration:export -- [--config private.json] [--output directory] [--page-size 500] [--write]",
    "",
    "The command is read-only and writes nothing unless --write is present.",
    "Source credentials come from the private config or LEGACY_SUPABASE_URL and",
    "LEGACY_SUPABASE_SERVICE_ROLE_KEY. Authentication tables and token fields are never queried.",
  ].join("\n");
}

function parseArguments(argumentsList) {
  const result = { write: false, pageSize: 500 };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--write") result.write = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else if (["--config", "--output", "--page-size"].includes(argument)) {
      const value = argumentsList[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      if (argument === "--config") result.configPath = value;
      if (argument === "--output") result.outputDirectory = value;
      if (argument === "--page-size") result.pageSize = Number(value);
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  if (!Number.isSafeInteger(result.pageSize) || result.pageSize < 1 || result.pageSize > 1_000) {
    throw new Error("--page-size must be an integer from 1 to 1000.");
  }
  return result;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

function identifier(input, label) {
  if (typeof input !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/u.test(input)) {
    throw new Error(`${label} must be a simple SQL identifier.`);
  }
  return input;
}

function normalizeSchema(overrides = {}) {
  const schema = {};
  for (const collectionName of Object.keys(DEFAULT_SCHEMA)) {
    const defaults = DEFAULT_SCHEMA[collectionName];
    const override = overrides[collectionName] ?? {};
    const providedColumns = override.columns ?? {};
    const columns = {};
    for (const logicalName of Object.keys(defaults.columns)) {
      const configured = Object.hasOwn(providedColumns, logicalName)
        ? providedColumns[logicalName]
        : defaults.columns[logicalName];
      if (configured === false || configured === null) continue;
      columns[logicalName] = identifier(configured, `${collectionName}.${logicalName}`);
    }
    for (const requiredName of REQUIRED_COLUMNS[collectionName]) {
      if (!columns[requiredName]) throw new Error(`${collectionName}.${requiredName} is required.`);
    }
    schema[collectionName] = {
      table: identifier(override.table ?? defaults.table, `${collectionName}.table`),
      columns,
    };
  }
  return schema;
}

function selectExpression(columns) {
  return Object.entries(columns)
    .map(([logicalName, physicalName]) =>
      logicalName === physicalName ? physicalName : `${logicalName}:${physicalName}`,
    )
    .join(",");
}

async function readCollection(client, specification, pageSize) {
  const rows = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await client
      .from(specification.table)
      .select(selectExpression(specification.columns))
      .order(specification.columns.id ?? Object.values(specification.columns)[0], {
        ascending: true,
      })
      .range(from, from + pageSize - 1);
    if (error) throw new Error("SOURCE_QUERY_FAILED");
    rows.push(...(data ?? []));
    if (!data || data.length < pageSize) return rows;
  }
}

function sanitized(records, sanitizer) {
  const accepted = [];
  let rejected = 0;
  for (const record of records) {
    const result = sanitizer(record);
    if (result) accepted.push(result);
    else rejected += 1;
  }
  return { accepted, rejected };
}

async function assertOutputIsNew(directory) {
  try {
    const entries = await fs.readdir(directory);
    if (entries.length) throw new Error("The output directory already contains files.");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function assertPrivateOutput(directory) {
  const relative = path.relative(REPOSITORY_ROOT, directory);
  const insideRepository =
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (
    insideRepository &&
    relative !== "migration-private" &&
    !relative.startsWith(`migration-private${path.sep}`)
  ) {
    throw new Error("OUTPUT_NOT_PRIVATE");
  }
}

async function main() {
  const argumentsObject = parseArguments(process.argv.slice(2));
  if (argumentsObject.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }

  if (argumentsObject.configPath) {
    assertPrivateOutput(path.resolve(argumentsObject.configPath));
  }

  const privateConfig = argumentsObject.configPath
    ? await readJson(argumentsObject.configPath)
    : {};
  const sourceUrl = privateConfig.source?.url ?? process.env.LEGACY_SUPABASE_URL;
  const serviceRoleKey =
    privateConfig.source?.serviceRoleKey ?? process.env.LEGACY_SUPABASE_SERVICE_ROLE_KEY;
  if (!sourceUrl || !serviceRoleKey) throw new Error("SOURCE_CONFIGURATION_MISSING");

  const sourceSchema = normalizeSchema(privateConfig.source?.schema);
  const client = createClient(sourceUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { "X-Client-Info": "curio-private-migration-export/1" } },
  });

  process.stdout.write(
    "Reading allowlisted legacy fields (no authentication or token tables)...\n",
  );
  const raw = {};
  for (const collectionName of ["profiles", "entries", "tags", "entryTags"]) {
    raw[collectionName] = await readCollection(
      client,
      sourceSchema[collectionName],
      argumentsObject.pageSize,
    );
  }

  const profiles = sanitized(raw.profiles, sanitizeProfile);
  const entries = sanitized(raw.entries, sanitizeEntry);
  const tags = sanitized(raw.tags, sanitizeTag);
  const rawEntryTags = sanitized(raw.entryTags, sanitizeEntryTag);
  const acceptedEntryIds = new Set(entries.accepted.map((entry) => entry.id));
  const acceptedTagIds = new Set(tags.accepted.map((tag) => tag.id));
  const acceptedEntryTags = rawEntryTags.accepted.filter(
    (relation) => acceptedEntryIds.has(relation.entryId) && acceptedTagIds.has(relation.tagId),
  );
  const entryTags = {
    accepted: acceptedEntryTags,
    rejected: rawEntryTags.rejected + rawEntryTags.accepted.length - acceptedEntryTags.length,
  };
  const collections = {
    profiles: profiles.accepted,
    entries: entries.accepted,
    tags: tags.accepted,
    "entry-tags": entryTags.accepted,
  };

  const thumbnailCandidates = raw.entries.filter(
    (entry) =>
      acceptedEntryIds.has(String(entry.id ?? "").trim()) &&
      typeof entry.thumbnailReference === "string" &&
      entry.thumbnailReference.trim(),
  );

  for (const [name, result] of Object.entries({ profiles, entries, tags, entryTags })) {
    process.stdout.write(
      `${name}: ${result.accepted.length} accepted, ${result.rejected} rejected\n`,
    );
  }

  if (!argumentsObject.write) {
    process.stdout.write(
      "Dry run complete. No export files were written. Re-run with --write after reviewing counts.\n",
    );
    process.stdout.write(
      `thumbnails: ${thumbnailCandidates.length} allowlisted candidates; bytes are fetched only with --write\n`,
    );
    return;
  }

  const timestamp = new Date().toISOString().replace(/[:.]/gu, "-");
  const outputDirectory = path.resolve(
    argumentsObject.outputDirectory ??
      privateConfig.outputDirectory ??
      path.join(REPOSITORY_ROOT, "migration-private", `export-${timestamp}`),
  );
  assertPrivateOutput(outputDirectory);
  await assertOutputIsNew(outputDirectory);
  await fs.mkdir(outputDirectory, { recursive: true, mode: 0o700 });

  const thumbnailRelations = [];
  const thumbnailAssets = new Map();
  let thumbnailFailures = 0;
  for (const entry of thumbnailCandidates) {
    try {
      const downloaded = await downloadLegacyThumbnail(entry.thumbnailReference, {
        sourceUrl,
        serviceRoleKey,
      });
      const normalized = await normalizeLegacyThumbnail(downloaded);
      const asset = await writeThumbnailArchiveAsset(outputDirectory, normalized.buffer);
      thumbnailAssets.set(asset.id, asset);
      thumbnailRelations.push({
        entryId: String(entry.id).trim(),
        assetSha256: asset.sha256,
      });
    } catch {
      thumbnailFailures += 1;
    }
  }
  collections["entry-thumbnails"] = thumbnailRelations;
  await writeExport(outputDirectory, collections, new Date().toISOString(), {
    assets: { thumbnails: [...thumbnailAssets.values()] },
  });
  process.stdout.write(
    `thumbnails: ${thumbnailRelations.length} archived, ${thumbnailFailures} unavailable\n`,
  );
  process.stdout.write("Private export written.\n");
}

main().catch((error) => {
  const safeMessages = new Set([
    "SOURCE_CONFIGURATION_MISSING",
    "SOURCE_QUERY_FAILED",
    "OUTPUT_NOT_PRIVATE",
    "The output directory already contains files.",
  ]);
  const message = safeMessages.has(error.message)
    ? error.message
    : "Migration export failed. Review the private configuration and schema mapping.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
