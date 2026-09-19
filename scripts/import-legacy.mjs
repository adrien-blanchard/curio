#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import {
  applyMigrationEntries,
  atomicWrite,
  coalesceTags,
  createAttributionMapper,
  createAuthorMapper,
  loadMigrationCheckpoint,
  mergeEntriesByCanonicalUrl,
  readExport,
  sanitizeEntry,
  sanitizeEntryTag,
  sanitizeEntryThumbnail,
  sanitizeProfile,
  sanitizeTag,
  selectEntryThumbnailAsset,
  sha256,
  resolveInitialAdministrator,
  validateArchivedThumbnailAsset,
} from "../src/lib/migration/index.mjs";

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_ROLES = new Set(["reader", "contributor", "administrator"]);

function assertPrivatePath(filePath) {
  const relative = path.relative(REPOSITORY_ROOT, filePath);
  const insideRepository =
    relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
  if (
    insideRepository &&
    relative !== "migration-private" &&
    !relative.startsWith(`migration-private${path.sep}`)
  ) {
    throw new Error("PRIVATE_PATH_REQUIRED");
  }
}

function usage() {
  return [
    "Usage: npm run migration:import -- --input directory [options]",
    "",
    "Options:",
    "  --config private.json        Private target settings and optional offline profiles",
    "  --target-profiles file.json  Profile snapshot for an offline dry run",
    "  --checkpoint file.json       Resume state (default: migration-private/import.checkpoint.json)",
    "  --report file.json           Sanitized local report (default: migration-private/import.report.json)",
    "  --apply                      Write to the target; omitted means dry run",
    "",
    "Target credentials come from private config or CURIO_TARGET_SUPABASE_URL and",
    "CURIO_TARGET_SERVICE_ROLE_KEY. --apply is never inferred from configuration.",
  ].join("\n");
}

function parseArguments(argumentsList) {
  const result = { apply: false };
  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (argument === "--apply") result.apply = true;
    else if (argument === "--help" || argument === "-h") result.help = true;
    else if (
      ["--config", "--input", "--target-profiles", "--checkpoint", "--report"].includes(argument)
    ) {
      const value = argumentsList[index + 1];
      if (!value) throw new Error(`${argument} requires a value.`);
      index += 1;
      const key = {
        "--config": "configPath",
        "--input": "inputDirectory",
        "--target-profiles": "targetProfilesPath",
        "--checkpoint": "checkpointPath",
        "--report": "reportPath",
      }[argument];
      result[key] = value;
    } else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(path.resolve(filePath), "utf8"));
}

function cleanTargetProfiles(records) {
  return records
    .map((record) => ({
      id: typeof record.id === "string" ? record.id : null,
      email: typeof record.email === "string" ? record.email : null,
      role: VALID_ROLES.has(record.role) ? record.role : null,
    }))
    .filter((record) => record.id && record.email && record.role);
}

function sanitizeCollection(records, sanitizer) {
  if (!Array.isArray(records)) throw new Error("MIGRATION_ARCHIVE_INVALID");
  const sanitized = records.map(sanitizer);
  if (sanitized.some((record) => !record)) {
    throw new Error("MIGRATION_ARCHIVE_INVALID");
  }
  return sanitized;
}

async function fetchTargetProfiles(client) {
  const { data, error } = await client.from("profiles").select("id,email,role").order("id");
  if (error) throw new Error("TARGET_PROFILES_QUERY_FAILED");
  return cleanTargetProfiles(data ?? []);
}

async function upsertTags(client, tags) {
  if (!tags.length) return new Map();
  const rows = tags.map((tag, index) => ({
    name: tag.name,
    slug: tag.slug,
    color: tag.color,
    sort_order: index,
    created_at: tag.createdAt ?? undefined,
  }));
  const { data, error } = await client
    .from("tags")
    .upsert(rows, { onConflict: "slug" })
    .select("id,slug");
  if (error) throw new Error("TARGET_TAG_UPSERT_FAILED");
  const tagIds = new Map((data ?? []).map((tag) => [tag.slug, tag.id]));
  if (tagIds.size !== tags.length || tags.some((tag) => typeof tagIds.get(tag.slug) !== "string")) {
    throw new Error("TARGET_TAG_UPSERT_FAILED");
  }
  return tagIds;
}

async function main() {
  const argumentsObject = parseArguments(process.argv.slice(2));
  if (argumentsObject.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (argumentsObject.configPath) {
    assertPrivatePath(path.resolve(argumentsObject.configPath));
  }
  const privateConfig = argumentsObject.configPath
    ? await readJson(argumentsObject.configPath)
    : {};
  const inputDirectory = path.resolve(
    argumentsObject.inputDirectory ?? privateConfig.inputDirectory ?? "",
  );
  if (!argumentsObject.inputDirectory && !privateConfig.inputDirectory)
    throw new Error("INPUT_REQUIRED");
  assertPrivatePath(inputDirectory);

  const { manifest, collections, assets } = await readExport(inputDirectory);
  const sourceProfiles = sanitizeCollection(collections.profiles ?? [], sanitizeProfile);
  const entries = sanitizeCollection(collections.entries ?? [], sanitizeEntry);
  const tags = sanitizeCollection(collections.tags ?? [], sanitizeTag);
  const entryTags = sanitizeCollection(collections["entry-tags"] ?? [], sanitizeEntryTag);
  const sourceEntryIds = new Set(entries.map((entry) => entry.id));
  const sourceTagIds = new Set(tags.map((tag) => tag.id));
  if (
    entryTags.some(
      (relation) => !sourceEntryIds.has(relation.entryId) || !sourceTagIds.has(relation.tagId),
    )
  ) {
    throw new Error("MIGRATION_ARCHIVE_INVALID");
  }
  const rawEntryThumbnails = collections["entry-thumbnails"] ?? [];
  const entryThumbnails = rawEntryThumbnails.map(sanitizeEntryThumbnail);
  if (entryThumbnails.some((relation) => !relation)) {
    throw new Error("THUMBNAIL_ARCHIVE_INVALID");
  }
  const thumbnailAssets = assets.thumbnails ?? {};
  try {
    for (const asset of Object.values(thumbnailAssets)) {
      await validateArchivedThumbnailAsset(asset);
    }
  } catch {
    throw new Error("THUMBNAIL_ARCHIVE_INVALID");
  }
  const thumbnailBySourceEntryId = new Map();
  for (const relation of entryThumbnails) {
    if (!sourceEntryIds.has(relation.entryId) || !thumbnailAssets[relation.assetSha256]) {
      throw new Error("THUMBNAIL_ARCHIVE_INVALID");
    }
    const existing = thumbnailBySourceEntryId.get(relation.entryId);
    if (existing && existing !== relation.assetSha256) {
      throw new Error("THUMBNAIL_ARCHIVE_INVALID");
    }
    thumbnailBySourceEntryId.set(relation.entryId, relation.assetSha256);
  }
  const mergedEntries = mergeEntriesByCanonicalUrl(entries, entryTags);
  const coalescedTags = coalesceTags(tags);

  const targetUrl = privateConfig.target?.url ?? process.env.CURIO_TARGET_SUPABASE_URL;
  const targetKey =
    privateConfig.target?.serviceRoleKey ?? process.env.CURIO_TARGET_SERVICE_ROLE_KEY;
  const client =
    targetUrl && targetKey
      ? createClient(targetUrl, targetKey, {
          auth: { autoRefreshToken: false, persistSession: false },
          global: { headers: { "X-Client-Info": "curio-private-migration-import/1" } },
        })
      : null;

  const targetProfilesPath = argumentsObject.targetProfilesPath ?? privateConfig.targetProfilesFile;
  if (targetProfilesPath) assertPrivatePath(path.resolve(targetProfilesPath));
  const targetProfiles = targetProfilesPath
    ? cleanTargetProfiles(await readJson(targetProfilesPath))
    : client
      ? await fetchTargetProfiles(client)
      : null;
  if (!targetProfiles) throw new Error("TARGET_CONFIGURATION_MISSING");
  if (argumentsObject.apply && !client) throw new Error("TARGET_CONFIGURATION_MISSING");

  const initialAdminEmails = String(
    privateConfig.initialAdminEmails ?? process.env.INITIAL_ADMIN_EMAILS ?? "",
  )
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const initialAdministrator = resolveInitialAdministrator({
    targetProfiles,
    initialAdminEmails,
  });
  const mapAuthor = createAuthorMapper({
    sourceProfiles,
    targetProfiles,
    initialAdminEmails,
    initialAdministrator,
  });
  const mapAttribution = createAttributionMapper({
    sourceProfiles,
    overrides: privateConfig.sourceProfileAttributions ?? [],
  });
  const tagSlugsBySourceId = coalescedTags.sourceIdToSlug;

  const manifestDigest = sha256(JSON.stringify(manifest));
  const checkpointPath = path.resolve(
    argumentsObject.checkpointPath ??
      privateConfig.checkpointPath ??
      path.join(REPOSITORY_ROOT, "migration-private", "import.checkpoint.json"),
  );
  const reportPath = path.resolve(
    argumentsObject.reportPath ??
      privateConfig.reportPath ??
      path.join(REPOSITORY_ROOT, "migration-private", "import.report.json"),
  );
  assertPrivatePath(checkpointPath);
  assertPrivatePath(reportPath);
  const checkpoint = await loadMigrationCheckpoint(checkpointPath, manifestDigest);
  const archivedThumbnailCount = mergedEntries.filter((entry) =>
    selectEntryThumbnailAsset(entry, thumbnailBySourceEntryId, thumbnailAssets),
  ).length;
  const historicalAttributionCount = mergedEntries.filter((entry) =>
    mapAttribution(entry.createdBy),
  ).length;
  const report = {
    version: 1,
    mode: argumentsObject.apply ? "apply" : "dry-run",
    input: {
      profiles: sourceProfiles.length,
      entries: entries.length,
      tags: tags.length,
      entryTags: entryTags.length,
    },
    plan: {
      canonicalEntries: mergedEntries.length,
      duplicateEntriesMerged: entries.length - mergedEntries.length,
      canonicalTags: coalescedTags.tags.length,
      previouslyCompleted: checkpoint.completed.size,
      thumbnailPolicy: "verified_private_archive_with_placeholder_fallback",
      archivedThumbnails: archivedThumbnailCount,
      unavailableThumbnails: mergedEntries.length - archivedThumbnailCount,
      historicalAttributions: historicalAttributionCount,
      ownerFallbackAttributions: mergedEntries.length - historicalAttributionCount,
    },
    result: {
      applied: 0,
      skipped: 0,
      thumbnailsSucceeded: 0,
      thumbnailsFailed: 0,
      placeholdersAssigned: 0,
      cleanupFailures: 0,
      attributionsRestored: 0,
      attributionsFallback: 0,
    },
  };

  if (!argumentsObject.apply) {
    for (const entry of mergedEntries) {
      mapAuthor(entry.createdBy);
      mapAttribution(entry.createdBy);
    }
    await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(
      `Dry run complete: ${mergedEntries.length} canonical entries and ${coalescedTags.tags.length} tags.\n`,
    );
    process.stdout.write(
      "No target data was written. A sanitized report was saved under migration-private by default.\n",
    );
    process.stdout.write(
      `Thumbnail plan: ${archivedThumbnailCount} archived, ${mergedEntries.length - archivedThumbnailCount} placeholders.\n`,
    );
    return;
  }

  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const targetTagIds = await upsertTags(client, coalescedTags.tags);
  report.result = await applyMigrationEntries({
    client,
    entries: mergedEntries,
    mapAuthor,
    mapAttribution,
    attributionActorId: initialAdministrator.id,
    tagSlugsBySourceId,
    targetTagIds,
    thumbnailBySourceEntryId,
    thumbnailAssets,
    checkpoint,
    checkpointPath,
    onProgress: async (result) => {
      report.result = result;
      await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    },
  });

  await atomicWrite(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `Import complete: ${report.result.applied} applied, ${report.result.skipped} resumed.\n`,
  );
  process.stdout.write(
    `Thumbnails: ${report.result.thumbnailsSucceeded} restored, ${report.result.thumbnailsFailed} failed, ${report.result.placeholdersAssigned} placeholders.\n`,
  );
  process.stdout.write(
    `Historical attributions: ${report.result.attributionsRestored} restored, ${report.result.attributionsFallback} owner fallbacks.\n`,
  );
}

main().catch((error) => {
  const safeMessages = new Set([
    "CHECKPOINT_MISMATCH",
    "INPUT_REQUIRED",
    "MIGRATION_ARCHIVE_INVALID",
    "PRIVATE_PATH_REQUIRED",
    "TARGET_CONFIGURATION_MISSING",
    "TARGET_PROFILES_QUERY_FAILED",
    "TARGET_TAG_UPSERT_FAILED",
    "TARGET_ENTRY_UPSERT_FAILED",
    "TARGET_ENTRY_TAG_UPSERT_FAILED",
    "TARGET_ENTRY_LOOKUP_FAILED",
    "TARGET_ENTRY_ATTRIBUTION_UPSERT_FAILED",
    "TARGET_ATTRIBUTION_ACTOR_REQUIRED",
    "MIGRATION_ATTRIBUTION_CONFIGURATION_INVALID",
    "THUMBNAIL_ARCHIVE_INVALID",
    "No listed initial administrator matches an administrator profile in the target.",
  ]);
  const message = safeMessages.has(error.message)
    ? error.message
    : "Migration import failed. Review the private input, target configuration, and sanitized local report.";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
