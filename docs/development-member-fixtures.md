# Development member fixtures

The member-list fixture tool creates synthetic Supabase Auth users and matching `public.profiles`
rows for UI testing. It is intentionally separate from `supabase/seed.sql`: database resets and
pgTAP runs must not acquire 50 Auth accounts as a side effect.

## Fixture shape

- The default dataset has 50 members: 25 `reader` and 25 `contributor`.
- No synthetic account is an `administrator`. Fake administrators would weaken the database's
  last-administrator protection even though they cannot sign in.
- Every address uses the reserved `example.invalid` domain and is deliberately absent from the Curio
  allowlist.
- Admin `createUser` does not send an invitation or confirmation email. The tool leaves the address
  unconfirmed and supplies no password, so the accounts cannot use password authentication.
- Each Auth user has a trusted `app_metadata.curio_fixture` marker. Cleanup requires both that
  marker and the exact reserved email pattern; an email prefix by itself is never sufficient.
- Profile join dates are distinct and deterministic so sorting and pagination can be exercised.

The Auth row must be created first because `profiles.id` references `auth.users.id`. Curio's Auth
trigger only synchronizes an existing profile; it does not create one for an administrative Auth
insertion.

## Seed

Dry run is the default and performs read-only inspection of the configured Supabase target:

```powershell
npm run fixtures:members
```

Apply to a local Supabase instance:

```powershell
npm run fixtures:members -- --apply
```

A non-local development project has an additional exact-host confirmation guard. Copy the host from
the dry-run report:

```powershell
npm run fixtures:members -- --apply --confirm-remote project-ref.supabase.co
```

`CURIO_FIXTURE_SUPABASE_URL` and `CURIO_FIXTURE_SERVICE_ROLE_KEY` take precedence when present.
Otherwise the tool uses `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`. Neither
credentials nor user identifiers are written to reports.

The operation is idempotent. A rerun creates missing fixtures, repairs their profiles, and leaves
matching rows unchanged. It stops before writing if an expected address is already owned by an
unmarked account. Accounts from the same dataset outside a smaller requested `--count` are reported
but never implicitly deleted.

## Cleanup

Inspect the exact cleanup set first:

```powershell
npm run fixtures:members:cleanup
```

Then apply it, with the same remote-target guard when applicable:

```powershell
npm run fixtures:members:cleanup -- --apply --confirm-remote project-ref.supabase.co
```

Cleanup hard-deletes only Auth users carrying the trusted dataset marker whose email and marker
index also match. The profile is removed by its Auth foreign-key cascade. Rerunning cleanup is safe.

Cleanup refuses to remove a fixture that has become the only active administrator. It also stops
when fixture users own entries or API tokens. Review the dry-run counts before explicitly adding
`--allow-related-data`; Auth deletion nulls `entries.created_by` and cascades API-token deletion.

Use `--report artifacts/member-fixtures.json` with either command to save the same sanitized JSON
summary printed to stdout. The report contains counts, roles, blockers, mode, and target host, but
no password, service key, Auth UUID, or member address.
