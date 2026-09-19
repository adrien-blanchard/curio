import { createClient } from "@supabase/supabase-js";

import {
  collectStaleUploadPaths,
  removeStaleUploadPaths,
} from "../src/lib/operations/staging-uploads.mjs";

const argumentsList = process.argv.slice(2);
const apply = argumentsList.includes("--apply");

function option(name, fallback) {
  const prefix = `--${name}=`;
  const raw = argumentsList.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);
  if (raw === undefined) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isSafeInteger(parsed)) throw new Error(`--${name} must be an integer.`);
  return parsed;
}

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

const olderThanMinutes = option("older-than-minutes", 60);
const limit = option("limit", 1_000);
if (olderThanMinutes < 15 || olderThanMinutes > 43_200) {
  throw new Error("--older-than-minutes must be between 15 and 43200.");
}
if (limit < 1 || limit > 10_000) throw new Error("--limit must be between 1 and 10000.");

const supabaseUrl = new URL(required("NEXT_PUBLIC_SUPABASE_URL"));
if (!["http:", "https:"].includes(supabaseUrl.protocol)) {
  throw new Error("NEXT_PUBLIC_SUPABASE_URL must use HTTP or HTTPS.");
}
const client = createClient(supabaseUrl.origin, required("SUPABASE_SERVICE_ROLE_KEY"), {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const bucket = client.storage.from("thumbnail_uploads");
const result = await collectStaleUploadPaths(bucket, {
  olderThanMs: olderThanMinutes * 60_000,
  limit,
});

if (!apply) {
  process.stdout.write(
    `Dry run: ${result.paths.length} stale upload(s) found after scanning ${result.scanned}; ${result.skippedWithoutTimestamp} skipped without timestamps.\n`,
  );
} else {
  const removed = await removeStaleUploadPaths(bucket, result.paths);
  process.stdout.write(`Removed ${removed} stale private thumbnail upload(s).\n`);
}
