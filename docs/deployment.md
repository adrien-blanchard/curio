# Deployment on Vercel and Supabase

## 1. Create isolated projects

Create a production Supabase project and a Vercel project. Do not attach them to a development
database. Select regions according to latency, data residency, and provider availability
requirements.

## 2. Apply the database

Link the Supabase CLI with a least-privilege deployment credential, inspect the pending migration
list, and apply migrations in order. Confirm RLS is enabled, the `thumbnails` bucket is private,
Realtime publishes only intended tables, and no bootstrap account exists outside
`INITIAL_ADMIN_EMAILS`.

After setting the production environment, validate and synchronize its email allowlist:

```bash
npm run configuration:sync
npm run configuration:sync -- --apply
```

Run this after every `ALLOWED_EMAIL_ADDRESSES` or `ALLOWED_EMAIL_DOMAINS` change and before
admitting traffic. The database function is service-role-only, atomic, and refuses a change that
would strand the instance without an allowed active administrator.

Run database tests against an isolated target before production migration. Never run the legacy
importer as part of ordinary deployment.

## 3. Configure authentication

Enable Google OAuth in Supabase, configure the exact production callback and site URL, and restrict
redirects. Configure exact allowed email addresses, domains, or both in Curio; at least one combined
entry is required. Prefer an exact address for a personal Gmail deployment because allowing
`gmail.com` would authorize every Gmail account. Create the initial administrator through the
documented bootstrap path, ensure it is covered by an allowed address or domain, then verify
last-administrator protection.

## 4. Configure Vercel

Set every required server and public variable from [configuration.md](configuration.md). Public
values are embedded at build time; changing them requires a rebuild. Never expose service-role,
Gemini, token pepper, OAuth, or workflow secrets to Preview deployments unless the preview uses
isolated provider projects.

The npm `prebuild` gate rejects missing, partial, unsafe-origin, or inconsistent deployment
configuration before `next build` begins. Do not bypass that gate in Vercel.

Build with the Node version in `.nvmrc`. Run schema migrations before promoting code that requires
them, using an expand/migrate/contract sequence for breaking changes.

## 5. Configure workflows

Follow the installed Workflow DevKit's Vercel deployment instructions. Verify a test workflow
survives request completion, retries a transient step, and records a `ready` or `failed` terminal
state with its processing attempt. Do not substitute an unawaited promise or request-local
background callback.

Confirm that Supabase Cron installed the one-minute stale-processing sweep. The sweep runs inside
PostgreSQL and is independent of Vercel Cron plan limits. Verify `queued`, `analyzing`, and
`finalizing` recovery in an isolated environment: after fifteen minutes without a heartbeat, the
entry must become `failed` with `PROCESSING_TIMEOUT`, expose Retry, and reject any late workflow
finalization. Provider-run cancellation remains best effort after the database fence.

## 6. Build the extension

Set the final application origin and extension identity, run extension tests, and use the
deterministic CI artifact. After the store assigns an extension ID, configure it on the server and
redeploy the API allowlist.

## 7. Verify

- unauthenticated access and addresses outside the combined allowlist are rejected;
- each role receives only its intended capabilities;
- cookie mutations reject an invalid Origin/CSRF token;
- personal token scopes and revocation work;
- a public page and a supported YouTube URL reach terminal states;
- thumbnails require signed delivery;
- audit events and redacted operational logs are present;
- backups and an operational rollback owner are confirmed.
- the database exact-address and domain allowlists exactly match the deployed environment.

## Rollback

Application rollback uses the previous verified Vercel artifact. Database rollback should normally
be a new forward migration; destructive reverse SQL is not automatic. Pause new ingestion before
reverting a workflow/schema contract and reconcile in-flight attempts afterward.
