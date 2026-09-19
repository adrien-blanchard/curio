# Operations

## Health and observability

Review Vercel request failures, Workflow run/step state, Supabase health and usage, entry and
processing-attempt states, Gemini quota/status, authentication failures, and private-storage growth.
The repository does not ship a metrics collector or predefined alert rules; operators must configure
monitoring appropriate to their providers and service objectives.

Use opaque correlation IDs. Redact credentials, cookies, authorization headers, raw submitted URLs,
page content, model prompts/responses, signed URLs, emails, and migration records from logs.

## Backups and recovery

- Enable provider backups appropriate to the deployment tier.
- Periodically export a schema-only snapshot and verify migrations from zero.
- Test point-in-time recovery and private storage restoration.
- Record recovery point and recovery time objectives.
- Keep backup encryption and access separate from application credentials.

A database restore and a storage restore are both required for complete recovery. Workflow attempts
interrupted by recovery must be inspected and reconciled through the supported retry path rather
than direct row editing.

## Processing recovery

Curio records a heartbeat at durable workflow boundaries. Entries with no progress for fifteen
minutes are atomically changed to `failed` with `PROCESSING_TIMEOUT`; their active attempt is closed
in the same transaction. The database fence is authoritative and prevents a late workflow from
finalizing stale work. Each sweep claims at most twenty oldest stale entries with `SKIP LOCKED`, so
a large outage is drained over successive runs without one unbounded transaction.

The migration installs a one-minute Supabase Cron job when `pg_cron` is available. Verify the job
after every environment rebuild and monitor its failures. Dashboard requests also run a throttled,
best-effort sweep and request provider cancellation for returned workflow run IDs. That lazy path is
a fallback for local development and provider outages, not a replacement for a scheduled production
sweep.

Provider cancellation is only cost control: a Gemini call already in flight may continue until its
120-second request timeout. Supabase Cron cannot contact the Workflow provider, so a run fenced by
Cron exits at its next bounded database request rather than through immediate provider cancellation.
Do not reopen or edit processing rows directly. Investigate repeated timeouts, then use the normal
Retry action after the entry is terminal.

## Private staging cleanup

Signed thumbnail uploads that are never finalized remain private but still consume storage. Schedule
the bounded cleanup command in a trusted operator environment (daily is a reasonable starting
point):

```bash
npm run storage:cleanup-staging -- --older-than-minutes=60 --limit=1000
npm run storage:cleanup-staging -- --older-than-minutes=60 --limit=1000 --apply
```

The first command is a dry run. The apply mode uses the service-role credential, accepts only
Curio's UUID-based staging paths, deletes in bounded batches, and never logs object names. Monitor
the counts and investigate uploads skipped because their Storage timestamp is unavailable. Keep this
scheduled job outside untrusted pull-request workflows.

## Legacy placeholder provenance repair

The thumbnail-provenance migration distinguishes a real automatic preview from Curio's generated
placeholder. Entries processed before that migration can still label the old placeholder as
`automatic`. The bounded operator command below reclassifies those historical rows without deleting
or replacing any private object.

Create an ignored `.env.placeholder-repair.local` file in a trusted operator environment with only
these dedicated variable names:

```dotenv
CURIO_PLACEHOLDER_REPAIR_SUPABASE_URL=<Supabase project URL>
CURIO_PLACEHOLDER_REPAIR_SERVICE_ROLE_KEY=<service-role key>
```

Run the read-only inspection first:

```bash
npm run storage:reclassify-placeholders
```

The report contains counts only. The command selects only entries whose origin is `automatic` and
whose private thumbnail path is present, downloads those objects from the private `thumbnails`
bucket, and compares their SHA-256 digest with the exact Curio placeholder WebP. A digest match is
also checked byte for byte. It never treats a filename or file size as proof and never deletes an
object.

After reviewing the dry-run counts, apply with the exact hostname from the configured project URL:

```bash
npm run storage:reclassify-placeholders -- --apply --confirm-host <exact-hostname>
```

Apply mode is refused in CI and Vercel. Each update is guarded by the entry ID, the old `automatic`
origin, and the unchanged private object path. Any malformed row, duplicate object path, missing
object, hash anomaly, provider error, or concurrent row change stops the operation. A rerun is safe:
already-reclassified rows are no longer eligible. Use `--limit` for an intentionally smaller bounded
inspection; exceeding the limit aborts instead of partially planning a larger set.

## Key rotation

Rotate service-role, Gemini, OAuth, token-pepper, workflow, and deployment credentials on a schedule
and after suspected exposure. Rotation includes redeployment, invalidating affected sessions/tokens,
checking access logs, and confirming the old credential no longer works.

Changing `API_TOKEN_PEPPER` invalidates stored personal tokens unless a versioned overlap mechanism
is implemented. Plan that rotation explicitly.

## Incident response

1. Contain access and pause risky workflow entry points.
2. Revoke exposed credentials before attempting Git cleanup.
3. Preserve sanitized provider and audit evidence.
4. Determine affected accounts, entries, storage objects, and external calls.
5. Restore with known-good migrations and artifacts.
6. Notify affected parties according to the operator's obligations.
7. Document root cause and preventive changes.

## Routine maintenance

- Apply dependency and platform security updates.
- Review administrator membership and active personal tokens.
- Dry-run and apply `configuration:sync` after any allowed-domain change, then verify an allowed and
  a removed-domain account.
- Run the staging cleanup and reconcile orphaned final thumbnails and abandoned attempts.
- Verify the processing-recovery cron is active and inspect recent `PROCESSING_TIMEOUT` audit data.
- Verify RLS, rate-limit, last-administrator, and audit tests.
- Rebuild and scan extension artifacts.
- Review provider quotas and retention.
- Run a restore exercise before major releases.

## Release artifacts

CI produces a deterministic extension ZIP, SHA-256 checksum, and CycloneDX SBOM. A release is
promoted only from a commit whose format, lint, types, unit, database, build, end-to-end, extension,
dependency, secret, and CodeQL checks passed.
