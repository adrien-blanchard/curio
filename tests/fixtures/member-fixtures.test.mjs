import { describe, expect, it, vi } from "vitest";

import {
  FIXTURE_DATASET,
  FixtureOperatorError,
  applySeedPlan,
  assertSafeApplyTarget,
  buildCleanupPlan,
  buildFixtureMembers,
  buildSeedPlan,
  isManagedFixtureUser,
  parseArguments,
} from "../../scripts/member-fixtures.mjs";

function authUser(member, overrides = {}) {
  return {
    app_metadata: { curio_fixture: member.marker },
    email: member.email,
    id: `00000000-0000-4000-8000-${String(member.position).padStart(12, "0")}`,
    ...overrides,
  };
}

function profile(member, user, overrides = {}) {
  return {
    avatar_url: null,
    created_at: member.createdAt,
    display_name: member.displayName,
    email: member.email,
    id: user.id,
    is_active: true,
    role: member.role,
    ...overrides,
  };
}

describe("member fixture definition", () => {
  it("builds 50 deterministic, reserved-domain profiles with a safe role split", () => {
    const members = buildFixtureMembers();

    expect(members).toHaveLength(50);
    expect(new Set(members.map((member) => member.email)).size).toBe(50);
    expect(new Set(members.map((member) => member.createdAt)).size).toBe(50);
    expect(members.every((member) => member.email.endsWith("@example.invalid"))).toBe(true);
    expect(members.filter((member) => member.role === "reader")).toHaveLength(25);
    expect(members.filter((member) => member.role === "contributor")).toHaveLength(25);
    expect(members.some((member) => member.role === "administrator")).toBe(false);
  });

  it("recognizes only a matching trusted marker, dataset, email and index", () => {
    const member = buildFixtureMembers(1)[0];
    const user = authUser(member);

    expect(isManagedFixtureUser(user)).toBe(true);
    expect(
      isManagedFixtureUser({
        ...user,
        app_metadata: { curio_fixture: { ...member.marker, dataset: "another-dataset" } },
      }),
    ).toBe(false);
    expect(
      isManagedFixtureUser({
        ...user,
        app_metadata: { curio_fixture: { ...member.marker, index: 2 } },
      }),
    ).toBe(false);
    expect(isManagedFixtureUser({ ...user, email: "real.person@example.com" })).toBe(false);
  });
});

describe("member fixture CLI safety", () => {
  it("defaults to a dry run and requires an explicit action", () => {
    expect(parseArguments(["seed"])).toMatchObject({
      action: "seed",
      apply: false,
      count: 50,
    });
    expect(() => parseArguments([])).toThrowError(
      expect.objectContaining({ code: "FIXTURE_ACTION_REQUIRED" }),
    );
  });

  it("parses explicit apply and remote confirmation", () => {
    expect(
      parseArguments([
        "cleanup",
        "--apply",
        "--confirm-remote",
        "project.supabase.co",
        "--allow-related-data",
      ]),
    ).toMatchObject({
      action: "cleanup",
      allowRelatedData: true,
      apply: true,
      confirmRemote: "project.supabase.co",
    });
  });

  it("requires the exact hostname before applying to a remote target", () => {
    const target = new URL("https://project.supabase.co");
    const options = parseArguments(["seed", "--apply"]);

    expect(() => assertSafeApplyTarget(target, options, {})).toThrowError(
      expect.objectContaining({ code: "FIXTURE_REMOTE_CONFIRMATION_REQUIRED" }),
    );
    expect(() =>
      assertSafeApplyTarget(target, { ...options, confirmRemote: "project.supabase.co" }, {}),
    ).not.toThrow();
  });

  it("allows local apply but rejects automated apply", () => {
    const options = parseArguments(["seed", "--apply"]);
    expect(() =>
      assertSafeApplyTarget(new URL("http://127.0.0.1:54321"), options, {}),
    ).not.toThrow();
    expect(() =>
      assertSafeApplyTarget(new URL("http://127.0.0.1:54321"), options, { CI: "true" }),
    ).toThrowError(expect.objectContaining({ code: "FIXTURE_APPLY_FORBIDDEN_IN_AUTOMATION" }));
  });

  it("uses stable operator errors without target or credential details", () => {
    const error = new FixtureOperatorError("FIXTURE_TEST", "sensitive detail");
    expect(error.message).toBe("FIXTURE_TEST");
  });
});

describe("member fixture plans", () => {
  it("is idempotent when a managed auth user and profile already match", () => {
    const members = buildFixtureMembers(2);
    const existingUser = authUser(members[0]);
    const existingProfile = profile(members[0], existingUser, {
      created_at: members[0].createdAt.replace(".000Z", "+00:00"),
    });
    const plan = buildSeedPlan(members, [existingUser], [existingProfile]);

    expect(plan.conflicts).toEqual([]);
    expect(plan.summary).toEqual({ conflicts: 0, create: 1, unchanged: 1, upsertProfile: 0 });
  });

  it("repairs a managed fixture profile but never adopts an unmarked auth account", () => {
    const members = buildFixtureMembers(2);
    const managed = authUser(members[0]);
    const unmarked = authUser(members[1], { app_metadata: {} });
    const plan = buildSeedPlan(members, [managed, unmarked], []);

    expect(plan.actions.map((action) => action.kind)).toEqual(["upsert-profile"]);
    expect(plan.conflicts).toEqual([{ code: "AUTH_EMAIL_ALREADY_USED", index: 2 }]);
  });

  it("creates Auth fixtures without a password, confirmation or email workflow", async () => {
    const member = buildFixtureMembers(1)[0];
    const createUser = vi.fn().mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      error: null,
    });
    const upsert = vi.fn().mockResolvedValue({ error: null });
    const client = {
      auth: { admin: { createUser, deleteUser: vi.fn() } },
      from: vi.fn(() => ({ upsert })),
    };

    await applySeedPlan(client, {
      actions: [{ kind: "create", member }],
      conflicts: [],
    });

    expect(createUser).toHaveBeenCalledWith({
      app_metadata: { curio_fixture: member.marker },
      email: member.email,
      user_metadata: { full_name: member.displayName },
    });
    expect(upsert).toHaveBeenCalledOnce();
  });

  it("cleanup selects only doubly identified fixtures and protects the last real admin", () => {
    const member = buildFixtureMembers(1)[0];
    const fixture = authUser(member);
    const fixtureProfile = profile(member, fixture, { role: "administrator" });
    const unmarked = authUser(member, {
      app_metadata: {},
      email: "curio-fixture-member-002@example.invalid",
      id: "00000000-0000-4000-8000-000000000999",
    });

    const blocked = buildCleanupPlan([fixture, unmarked], [fixtureProfile], [fixture.id], {
      allowed: true,
      apiTokens: 0,
      entries: 0,
    });
    expect(blocked.managedUsers).toEqual([fixture]);
    expect(blocked.blockers).toContain("LAST_NON_FIXTURE_ADMIN_REQUIRED");

    const safe = buildCleanupPlan(
      [fixture, unmarked],
      [fixtureProfile],
      [fixture.id, "00000000-0000-4000-8000-000000000888"],
      { allowed: true, apiTokens: 0, entries: 0 },
    );
    expect(safe.blockers).toEqual([]);
  });

  it("requires a separate acknowledgement before cleanup of related records", () => {
    const plan = buildCleanupPlan([], [], [], { allowed: false, apiTokens: 1, entries: 2 });
    expect(plan.blockers).toContain("RELATED_DATA_CONFIRMATION_REQUIRED");
    expect(plan.summary).toMatchObject({ apiTokens: 1, entries: 2 });
    expect(FIXTURE_DATASET).toBe("curio-member-list-v1");
  });
});
