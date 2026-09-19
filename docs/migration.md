# Private legacy migration

The migration utilities move allowlisted Curio content from a private legacy Supabase project into a
fresh deployment. They are deliberately separate from normal deployment and are never run by CI. No
live export is included in this repository.

## Safety contract

- Export reads only mapped profile, entry, tag, and entry/tag fields.
- Auth users, sessions, refresh tokens, API tokens, token hashes, OAuth data, service keys, user
  metadata, provider payloads, and raw processing errors are never queried or serialized.
- Profile export contains source ID, normalized email, and creation time by default. An operator may
  explicitly map a bounded display name and a Google-hosted avatar URL for authorship restoration.
- URL credentials are rejected. Known tracking and credential-bearing query parameters are removed;
  credential-shaped text is redacted.
- Neither command prints credentials, provider errors, record contents, URLs, emails, or absolute
  provider endpoints.
- Export requires `--write`; import requires `--apply`. Import dry-run is the default and performs
  no target mutation.
- Exports, checkpoints, reports, and private configuration must stay outside Git. Prefer an
  encrypted directory outside the checkout. If they are kept inside this checkout, the exporter
  accepts only `migration-private/`, which is ignored by Git.
- Legacy thumbnail source URLs are never stored in NDJSON, the manifest, the checkpoint, or the
  report. Only an entry ID and the SHA-256 of a normalized archive asset are retained.

Run the tools only from a trusted workstation. Limit the source credential to read access when
possible, use a short-lived target service-role credential, and revoke both after reconciliation.

## 1. Describe the private source schema

Create `migration-private/export.config.json` locally:

```json
{
  "source": {
    "url": "https://source-project.example.invalid",
    "schema": {
      "profiles": {
        "table": "user_profiles",
        "columns": {
          "id": "id",
          "email": "email",
          "displayName": false,
          "avatarUrl": false,
          "createdAt": "created_at"
        }
      },
      "entries": {
        "table": "entries",
        "columns": {
          "id": "id",
          "url": "url",
          "title": "title",
          "summary": "tldr",
          "sourceType": "source_type",
          "status": "status",
          "createdBy": "created_by",
          "createdAt": "created_at",
          "updatedAt": "updated_at",
          "thumbnailReference": "thumbnail_url"
        }
      }
    }
  }
}
```

Default mappings also cover `tags` and `entry_tags`. Override physical table or column names as
needed. Set a non-required mapped column to `false` when the legacy schema does not contain it.
Logical field names are fixed; arbitrary extra columns cannot be selected through configuration. If
the legacy profile table has suitable columns, replace `false` with their physical column names.
Only `https://lh3.googleusercontent.com/` avatar URLs survive validation. Leave both fields disabled
when the source does not contain them.

Environment variables `LEGACY_SUPABASE_URL` and `LEGACY_SUPABASE_SERVICE_ROLE_KEY` may replace the
two source values. Do not put either in `.env.local`, Vercel, a shell-history command, or the
repository. The private JSON format also accepts `source.serviceRoleKey`, but an injected
environment value or secret-manager wrapper leaves less credential material on disk.

`thumbnailReference` is optional: set it to `false` if that legacy column does not exist. When it is
mapped, a reference is accepted only if it is one of these forms:

- an object in the legacy Supabase Storage bucket named exactly `thumbnails`, read through the
  authenticated Storage API on the configured source origin;
- an HTTPS image on the exact host `i.ytimg.com`;
- an HTTPS image on the exact host `opengraph.githubassets.com`.

The exporter never follows redirects and never fetches an arbitrary URL. Query strings are removed
from fixed-host references. Downloads are streamed with both declared and actual size limited to 5
MiB.

## 2. Export

First perform an allowlist/count dry run:

```bash
npm run migration:export -- --config migration-private/export.config.json
```

Review accepted and rejected counts. Then write a new checksummed export directory:

```bash
npm run migration:export -- --config migration-private/export.config.json --write
```

The private directory contains a manifest, NDJSON collections, and optional files under
`thumbnails/`. Every collection has a SHA-256 digest and record count. Every thumbnail is decoded by
Sharp as a real JPEG, PNG, or WebP, constrained to one frame, at most 8192 pixels on either axis and
40 million pixels total, then normalized to a 720x309 WebP. The normalized file is named by its
SHA-256 digest; no source URL is retained. The exporter refuses a non-empty destination.

Use `--output` to select a private destination. A destination inside the checkout must remain under
`migration-private/`; a private encrypted location outside the checkout is preferred.

## 3. Prepare the clean target

Apply all Supabase migrations first and create the target administrators via the normal bootstrap.
The importer never creates Auth users or profiles.

Create `migration-private/import.config.json`:

```json
{
  "target": {
    "url": "https://target-project.example.invalid"
  },
  "initialAdminEmails": "admin@example.invalid",
  "sourceProfileAttributions": [
    {
      "sourceProfileId": "legacy-profile-id",
      "displayName": "Example Author",
      "avatarUrl": "https://lh3.googleusercontent.com/a/example"
    }
  ]
}
```

Alternatively use `CURIO_TARGET_SUPABASE_URL`, `CURIO_TARGET_SERVICE_ROLE_KEY`, and
`INITIAL_ADMIN_EMAILS`. These migration-only variables are intentionally not accepted by the web
runtime. The private JSON format also accepts `target.serviceRoleKey` when a file-based secret is
unavoidable.

`sourceProfileAttributions` is optional. It supplements an existing checksummed archive without
editing it, which is useful when the old profile table exported only email addresses. Each override
must reference a source profile ID already present in the archive. Names are normalized and bounded;
avatars must use Google's exact trusted HTTPS host. This private configuration contains personal
data and must be deleted with the rest of the migration material.

For an entirely offline dry run, export a private JSON array containing only the target profiles'
`id`, `email`, and `role`, then pass `--target-profiles migration-private/target-profiles.json`.
Delete that snapshot after reconciliation.

## 4. Dry run and import

```bash
npm run migration:import -- \
  --input migration-private/export-YYYY-MM-DD \
  --config migration-private/import.config.json
```

Dry-run validates collection and asset checksums, safe archive paths, the 5 MiB ceiling, normalized
WebP dimensions and frame count, records, canonical merging, and author mapping. It writes a
sanitized count-only report with archived/unavailable thumbnail and historical-attribution counts.
It never writes an email, display name, avatar URL, entry URL, or source profile ID to the report.
It does not write to Supabase. After reviewing the report and backing up the target:

```bash
npm run migration:import -- \
  --input migration-private/export-YYYY-MM-DD \
  --config migration-private/import.config.json \
  --apply
```

The importer is deterministic and idempotent:

- entries are grouped by canonical URL;
- the earliest source entry supplies content and timestamps;
- tag relationships from every duplicate are unioned;
- tags are coalesced and upserted by slug;
- secure ownership (`entries.created_by`) maps only when the source profile email exactly matches a
  target profile email; otherwise it maps to the first listed initial administrator that already has
  the `administrator` role;
- displayed authorship is stored separately in `entry_attributions`: a known source profile keeps
  its normalized historical email and optional trusted display name/avatar even when ownership had
  to fall back to the administrator;
- attribution restoration uses the guarded `upsert_entry_attribution` RPC with the initial
  administrator as actor; it is a write-free no-op when replayed unchanged;
- entries upsert on `canonical_url`, and tag links on `(entry_id, tag_id)`;
- a manifest-bound checkpoint stores only opaque URL fingerprints after each completed entry, so the
  same run can resume safely; previously checkpointed entries are still looked up by canonical URL
  and receive missing historical attribution without re-uploading their content or thumbnail;
- legacy `processing`, `failed`, and other non-ready rows become target `failed` rows with
  `LEGACY_IMPORT_RETRY_REQUIRED` and a bounded explanatory message; `opensource` and `proprietary`
  remain the exact target enum values;
- archived WebPs are uploaded to the target private `thumbnails` bucket at the deterministic path
  `<target-entry-id>/migration-<sha256>.webp`, then linked through `thumbnail_path`;
- rerunning an upload upserts the same object, making it idempotent. After a successful link, an old
  object belonging to that same entry is removed;
- when an asset is absent, invalid, or cannot be uploaded/linked, `thumbnail_path` is cleared so the
  application displays its placeholder. Invalid or failed thumbnail work is counted in the local
  report; a failed restore is not checkpointed and is retried on the next apply.

Import never contacts a legacy image URL. It reads only the verified private archive created by the
export step. The sanitized report contains counts and policy identifiers, not URLs, emails, object
paths, record content, or credentials.

## 5. Reconcile and destroy private material

Compare source/export/target counts, duplicate merges, distinct displayed authors and their entry
counts, tag relations, ready/failed states, thumbnail success/failure/placeholder and cleanup
counts, and a representative content sample. Exercise RLS using each role and verify the UI never
exposes private object paths.

After sign-off, revoke migration credentials and securely remove the private config, profile
snapshot, export, checkpoint, and report according to the operator's retention policy. These files
are intentionally excluded from backups and source control unless the operator has a separate
encrypted process.
