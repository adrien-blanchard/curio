import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

export const FIXTURE_DATASET = "curio-member-list-v1";
export const FIXTURE_DOMAIN = "example.invalid";
export const DEFAULT_FIXTURE_COUNT = 50;
export const MAX_FIXTURE_COUNT = 200;

const FIXTURE_MARKER_KEY = "curio_fixture";
const FIXTURE_EMAIL_PATTERN = /^curio-fixture-member-(\d{3})@example[.]invalid$/u;
const PROFILE_COLUMNS = "id,email,role,display_name,avatar_url,is_active,created_at";
const AUTH_PAGE_SIZE = 200;

export class FixtureOperatorError extends Error {
  constructor(code, details) {
    super(code);
    this.name = "FixtureOperatorError";
    this.code = code;
    this.details = details;
  }
}

function fail(code, details) {
  throw new FixtureOperatorError(code, details);
}

export function usage() {
  return [
    "Usage: node scripts/member-fixtures.mjs <seed|cleanup> [options]",
    "",
    "Options:",
    `  --count <1-${MAX_FIXTURE_COUNT}>       Number of desired members for seed (default: ${DEFAULT_FIXTURE_COUNT})`,
    "  --apply                 Perform writes; omitted means read-only dry run",
    "  --confirm-remote <host> Required in addition to --apply for a non-local target",
    "  --allow-related-data    Permit cleanup when fixtures own entries or API tokens",
    "  --report <path>         Write the sanitized JSON report to a local file",
    "  --help                  Show this help",
    "",
    "Credentials: CURIO_FIXTURE_SUPABASE_URL / CURIO_FIXTURE_SERVICE_ROLE_KEY",
    "fall back to NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.",
  ].join("\n");
}

export function parseArguments(argumentsList) {
  const options = {
    action: null,
    allowRelatedData: false,
    apply: false,
    confirmRemote: null,
    count: DEFAULT_FIXTURE_COUNT,
    help: false,
    reportPath: null,
  };

  for (let index = 0; index < argumentsList.length; index += 1) {
    const argument = argumentsList[index];
    if (["seed", "cleanup"].includes(argument)) {
      if (options.action) fail("FIXTURE_ACTION_REPEATED");
      options.action = argument;
    } else if (argument === "--apply") {
      options.apply = true;
    } else if (argument === "--allow-related-data") {
      options.allowRelatedData = true;
    } else if (argument === "--help" || argument === "-h") {
      options.help = true;
    } else if (["--count", "--confirm-remote", "--report"].includes(argument)) {
      const value = argumentsList[index + 1];
      if (!value || value.startsWith("--")) fail("FIXTURE_OPTION_VALUE_REQUIRED", argument);
      index += 1;
      if (argument === "--count") {
        if (!/^\d+$/u.test(value)) fail("FIXTURE_COUNT_INVALID");
        options.count = Number(value);
      } else if (argument === "--confirm-remote") {
        options.confirmRemote = value.toLowerCase();
      } else {
        options.reportPath = value;
      }
    } else {
      fail("FIXTURE_ARGUMENT_UNKNOWN", argument);
    }
  }

  if (options.help) return options;
  if (!options.action) fail("FIXTURE_ACTION_REQUIRED");
  if (
    !Number.isSafeInteger(options.count) ||
    options.count < 1 ||
    options.count > MAX_FIXTURE_COUNT
  ) {
    fail("FIXTURE_COUNT_INVALID");
  }
  if (options.action === "cleanup" && options.count !== DEFAULT_FIXTURE_COUNT) {
    fail("FIXTURE_COUNT_NOT_USED_FOR_CLEANUP");
  }
  if (options.action === "seed" && options.allowRelatedData) {
    fail("FIXTURE_RELATED_DATA_OPTION_ONLY_FOR_CLEANUP");
  }

  return options;
}

function fixtureRole(position) {
  return position % 2 === 0 ? "contributor" : "reader";
}

function fixtureMarker(position) {
  return {
    dataset: FIXTURE_DATASET,
    index: position,
    managed: true,
    version: 1,
  };
}

export function buildFixtureMembers(count = DEFAULT_FIXTURE_COUNT) {
  if (!Number.isSafeInteger(count) || count < 1 || count > MAX_FIXTURE_COUNT) {
    fail("FIXTURE_COUNT_INVALID");
  }

  return Array.from({ length: count }, (_, offset) => {
    const position = offset + 1;
    const serial = String(position).padStart(3, "0");
    return {
      createdAt: new Date(Date.UTC(2024, 0, position)).toISOString(),
      displayName: `Curio Demo Member ${serial}`,
      email: `curio-fixture-member-${serial}@${FIXTURE_DOMAIN}`,
      marker: fixtureMarker(position),
      position,
      role: fixtureRole(position),
    };
  });
}

export function isManagedFixtureUser(user) {
  const marker = user?.app_metadata?.[FIXTURE_MARKER_KEY];
  const email = typeof user?.email === "string" ? user.email.toLowerCase() : "";
  const emailMatch = FIXTURE_EMAIL_PATTERN.exec(email);
  return Boolean(
    emailMatch &&
    marker &&
    marker.managed === true &&
    marker.dataset === FIXTURE_DATASET &&
    marker.version === 1 &&
    Number.isSafeInteger(marker.index) &&
    marker.index >= 1 &&
    marker.index <= MAX_FIXTURE_COUNT &&
    marker.index === Number(emailMatch[1]),
  );
}

export function isLocalTarget(target) {
  const hostname = target.hostname.toLowerCase();
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "0.0.0.0" ||
    hostname === "[::1]" ||
    /^127(?:[.]\d{1,3}){3}$/u.test(hostname)
  );
}

export function assertSafeApplyTarget(target, options, environment = process.env) {
  if (!options.apply) return;
  if (environment.VERCEL || environment.CI === "true")
    fail("FIXTURE_APPLY_FORBIDDEN_IN_AUTOMATION");
  if (isLocalTarget(target)) return;
  if (options.confirmRemote !== target.hostname.toLowerCase()) {
    fail("FIXTURE_REMOTE_CONFIRMATION_REQUIRED", target.hostname.toLowerCase());
  }
}

function countRoles(records) {
  const roles = { administrator: 0, contributor: 0, reader: 0 };
  for (const record of records) {
    if (record.role in roles) roles[record.role] += 1;
  }
  return roles;
}

function sameInstant(first, second) {
  const firstTimestamp = Date.parse(first);
  const secondTimestamp = Date.parse(second);
  return (
    Number.isFinite(firstTimestamp) &&
    Number.isFinite(secondTimestamp) &&
    firstTimestamp === secondTimestamp
  );
}

function profileMatchesMember(profile, member) {
  return (
    profile?.email === member.email &&
    profile?.role === member.role &&
    profile?.display_name === member.displayName &&
    profile?.avatar_url === null &&
    profile?.is_active === true &&
    sameInstant(profile?.created_at, member.createdAt)
  );
}

export function buildSeedPlan(members, authUsers, profiles) {
  const authByEmail = new Map();
  const profileByEmail = new Map();
  const profileById = new Map();

  for (const user of authUsers) {
    if (typeof user.email === "string") authByEmail.set(user.email.toLowerCase(), user);
  }
  for (const profile of profiles) {
    if (typeof profile.email === "string") profileByEmail.set(profile.email.toLowerCase(), profile);
    if (typeof profile.id === "string") profileById.set(profile.id, profile);
  }

  const actions = [];
  const conflicts = [];
  for (const member of members) {
    const authUser = authByEmail.get(member.email);
    const emailProfile = profileByEmail.get(member.email);

    if (!authUser) {
      if (emailProfile) {
        conflicts.push({ code: "PROFILE_EMAIL_ALREADY_USED", index: member.position });
      } else {
        actions.push({ kind: "create", member });
      }
      continue;
    }

    if (!isManagedFixtureUser(authUser)) {
      conflicts.push({ code: "AUTH_EMAIL_ALREADY_USED", index: member.position });
      continue;
    }

    const idProfile = profileById.get(authUser.id);
    if (emailProfile && emailProfile.id !== authUser.id) {
      conflicts.push({ code: "PROFILE_EMAIL_ALREADY_USED", index: member.position });
      continue;
    }
    if (idProfile && idProfile.email !== member.email && emailProfile) {
      conflicts.push({ code: "PROFILE_ID_EMAIL_MISMATCH", index: member.position });
      continue;
    }

    actions.push({
      authUser,
      kind: profileMatchesMember(idProfile, member) ? "unchanged" : "upsert-profile",
      member,
    });
  }

  const desiredEmails = new Set(members.map((member) => member.email));
  const managedOutsideRequestedSet = authUsers.filter(
    (user) => isManagedFixtureUser(user) && !desiredEmails.has(user.email.toLowerCase()),
  ).length;

  return {
    actions,
    conflicts,
    distribution: countRoles(members),
    managedOutsideRequestedSet,
    summary: {
      conflicts: conflicts.length,
      create: actions.filter((action) => action.kind === "create").length,
      unchanged: actions.filter((action) => action.kind === "unchanged").length,
      upsertProfile: actions.filter((action) => action.kind === "upsert-profile").length,
    },
  };
}

export function buildCleanupPlan(authUsers, profiles, activeAdministratorIds, relatedData) {
  const managedUsers = authUsers.filter(isManagedFixtureUser);
  const managedIds = new Set(managedUsers.map((user) => user.id));
  const managedProfiles = profiles.filter((profile) => managedIds.has(profile.id));
  const nonFixtureActiveAdministrators = activeAdministratorIds.filter(
    (id) => !managedIds.has(id),
  ).length;
  const fixtureActiveAdministrators = activeAdministratorIds.filter((id) =>
    managedIds.has(id),
  ).length;
  const blockers = [];

  if (fixtureActiveAdministrators > 0 && nonFixtureActiveAdministrators === 0) {
    blockers.push("LAST_NON_FIXTURE_ADMIN_REQUIRED");
  }
  if ((relatedData.entries > 0 || relatedData.apiTokens > 0) && !relatedData.allowed) {
    blockers.push("RELATED_DATA_CONFIRMATION_REQUIRED");
  }

  return {
    blockers,
    managedUsers,
    summary: {
      apiTokens: relatedData.apiTokens,
      entries: relatedData.entries,
      fixtureActiveAdministrators,
      profiles: managedProfiles.length,
      users: managedUsers.length,
    },
  };
}

function requiredCredential(environment, primaryName, fallbackName) {
  const value = environment[primaryName]?.trim() || environment[fallbackName]?.trim();
  if (!value) fail("FIXTURE_CREDENTIALS_REQUIRED");
  return value;
}

function targetConfiguration(environment) {
  const rawUrl = requiredCredential(
    environment,
    "CURIO_FIXTURE_SUPABASE_URL",
    "NEXT_PUBLIC_SUPABASE_URL",
  );
  const serviceRoleKey = requiredCredential(
    environment,
    "CURIO_FIXTURE_SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  );
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    fail("FIXTURE_TARGET_URL_INVALID");
  }
  if (!["http:", "https:"].includes(target.protocol)) fail("FIXTURE_TARGET_URL_INVALID");
  return { serviceRoleKey, target };
}

function fixtureClient(target, serviceRoleKey) {
  return createClient(target.origin, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });
}

async function listAllAuthUsers(client) {
  const users = [];
  for (let page = 1; page <= 100; page += 1) {
    const { data, error } = await client.auth.admin.listUsers({ page, perPage: AUTH_PAGE_SIZE });
    if (error) fail("FIXTURE_AUTH_LIST_FAILED");
    const pageUsers = data?.users ?? [];
    users.push(...pageUsers);
    if (pageUsers.length < AUTH_PAGE_SIZE) return users;
  }
  fail("FIXTURE_AUTH_LIST_LIMIT_EXCEEDED");
}

async function fetchProfilesBy(client, column, values) {
  if (values.length === 0) return [];
  const uniqueValues = [...new Set(values)];
  const profiles = [];
  for (let offset = 0; offset < uniqueValues.length; offset += 100) {
    const chunk = uniqueValues.slice(offset, offset + 100);
    const { data, error } = await client.from("profiles").select(PROFILE_COLUMNS).in(column, chunk);
    if (error) fail("FIXTURE_PROFILE_LIST_FAILED");
    profiles.push(...(data ?? []));
  }
  return profiles;
}

async function fetchSeedProfiles(client, members, authUsers) {
  const emails = members.map((member) => member.email);
  const expectedEmails = new Set(emails);
  const managedIds = authUsers
    .filter(
      (user) =>
        typeof user.email === "string" &&
        expectedEmails.has(user.email.toLowerCase()) &&
        isManagedFixtureUser(user),
    )
    .map((user) => user.id);
  const [byEmail, byId] = await Promise.all([
    fetchProfilesBy(client, "email", emails),
    fetchProfilesBy(client, "id", managedIds),
  ]);
  return [...new Map([...byEmail, ...byId].map((profile) => [profile.id, profile])).values()];
}

async function fetchActiveAdministratorIds(client) {
  const { data, error } = await client
    .from("profiles")
    .select("id")
    .eq("role", "administrator")
    .eq("is_active", true);
  if (error) fail("FIXTURE_ADMINISTRATOR_LIST_FAILED");
  return (data ?? []).map((profile) => profile.id);
}

async function countRelatedRows(client, table, column, ids) {
  if (ids.length === 0) return 0;
  let total = 0;
  for (let offset = 0; offset < ids.length; offset += 100) {
    const { count, error } = await client
      .from(table)
      .select("id", { count: "exact", head: true })
      .in(column, ids.slice(offset, offset + 100));
    if (error) fail("FIXTURE_RELATED_DATA_CHECK_FAILED");
    total += count ?? 0;
  }
  return total;
}

async function upsertFixtureProfile(client, userId, member) {
  const { error } = await client.from("profiles").upsert(
    {
      avatar_url: null,
      created_at: member.createdAt,
      display_name: member.displayName,
      email: member.email,
      id: userId,
      is_active: true,
      role: member.role,
    },
    { onConflict: "id" },
  );
  if (error) fail("FIXTURE_PROFILE_UPSERT_FAILED");
}

export async function applySeedPlan(client, plan) {
  if (plan.conflicts.length > 0) fail("FIXTURE_COLLISION_DETECTED");
  const applied = { created: 0, unchanged: 0, upsertedProfiles: 0 };

  for (const action of plan.actions) {
    if (action.kind === "unchanged") {
      applied.unchanged += 1;
      continue;
    }
    if (action.kind === "upsert-profile") {
      await upsertFixtureProfile(client, action.authUser.id, action.member);
      applied.upsertedProfiles += 1;
      continue;
    }

    const { data, error } = await client.auth.admin.createUser({
      app_metadata: { [FIXTURE_MARKER_KEY]: action.member.marker },
      email: action.member.email,
      user_metadata: { full_name: action.member.displayName },
    });
    if (error || !data?.user) fail("FIXTURE_AUTH_CREATE_FAILED");

    try {
      await upsertFixtureProfile(client, data.user.id, action.member);
    } catch (profileError) {
      const { error: rollbackError } = await client.auth.admin.deleteUser(data.user.id, false);
      if (rollbackError) fail("FIXTURE_PROFILE_UPSERT_ROLLBACK_FAILED");
      throw profileError;
    }
    applied.created += 1;
  }

  return applied;
}

async function inspectCleanup(client, authUsers, allowRelatedData) {
  const managedUsers = authUsers.filter(isManagedFixtureUser);
  const managedIds = managedUsers.map((user) => user.id);
  const [profiles, activeAdministratorIds, entries, apiTokens] = await Promise.all([
    fetchProfilesBy(client, "id", managedIds),
    fetchActiveAdministratorIds(client),
    countRelatedRows(client, "entries", "created_by", managedIds),
    countRelatedRows(client, "api_tokens", "user_id", managedIds),
  ]);
  return buildCleanupPlan(authUsers, profiles, activeAdministratorIds, {
    allowed: allowRelatedData,
    apiTokens,
    entries,
  });
}

async function applyCleanupPlan(client, plan) {
  if (plan.blockers.length > 0) fail("FIXTURE_CLEANUP_BLOCKED");
  let deleted = 0;
  for (const user of plan.managedUsers) {
    const { error } = await client.auth.admin.deleteUser(user.id, false);
    if (error) fail("FIXTURE_AUTH_DELETE_FAILED");
    deleted += 1;
  }
  return { deleted };
}

function sanitizedSeedReport(options, target, plan, applied) {
  return {
    action: "seed",
    applied,
    dataset: FIXTURE_DATASET,
    desiredMembers: plan.actions.length + plan.conflicts.length,
    distribution: plan.distribution,
    managedOutsideRequestedSet: plan.managedOutsideRequestedSet,
    mode: options.apply ? "apply" : "dry-run",
    plan: plan.summary,
    target: { host: target.hostname, kind: isLocalTarget(target) ? "local" : "remote" },
  };
}

function sanitizedCleanupReport(options, target, plan, applied) {
  return {
    action: "cleanup",
    applied,
    blockers: plan.blockers,
    dataset: FIXTURE_DATASET,
    mode: options.apply ? "apply" : "dry-run",
    plan: plan.summary,
    target: { host: target.hostname, kind: isLocalTarget(target) ? "local" : "remote" },
  };
}

async function writeReport(reportPath, report) {
  if (!reportPath) return;
  const resolved = path.resolve(reportPath);
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

export async function run(options, environment = process.env) {
  const { serviceRoleKey, target } = targetConfiguration(environment);
  assertSafeApplyTarget(target, options, environment);
  const client = fixtureClient(target, serviceRoleKey);
  const authUsers = await listAllAuthUsers(client);
  let report;

  if (options.action === "seed") {
    const members = buildFixtureMembers(options.count);
    const profiles = await fetchSeedProfiles(client, members, authUsers);
    const plan = buildSeedPlan(members, authUsers, profiles);
    const applied = options.apply ? await applySeedPlan(client, plan) : null;
    report = sanitizedSeedReport(options, target, plan, applied);
  } else {
    const plan = await inspectCleanup(client, authUsers, options.allowRelatedData);
    const applied = options.apply ? await applyCleanupPlan(client, plan) : null;
    report = sanitizedCleanupReport(options, target, plan, applied);
  }

  await writeReport(options.reportPath, report);
  return report;
}

async function main() {
  try {
    const options = parseArguments(process.argv.slice(2));
    if (options.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const report = await run(options);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    if (!options.apply) {
      process.stdout.write("Dry run only. Re-run with --apply to perform the planned operation.\n");
    }
  } catch (error) {
    const code = error instanceof FixtureOperatorError ? error.code : "UNEXPECTED_FIXTURE_ERROR";
    process.stderr.write(`Member fixture operation failed: ${code}\n`);
    process.exitCode = 1;
  }
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) await main();
