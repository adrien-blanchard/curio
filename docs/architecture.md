# Architecture

Curio is a Next.js application deployed on Vercel, with Supabase providing authentication,
PostgreSQL, Realtime, and private object storage. Google Gemini analyzes submitted links. A Manifest
V3 Chrome extension is an optional client of the same versioned API.

## Components

| Component            | Responsibility                                                | Trust level         |
| -------------------- | ------------------------------------------------------------- | ------------------- |
| Browser dashboard    | Bounded server queries, navigation, review, and user actions  | Untrusted client    |
| Chrome extension     | Submit the active tab and manage a scoped token               | Untrusted client    |
| Next.js server       | Session validation, API contracts, orchestration, signed URLs | Trusted application |
| Workflow DevKit      | Durable ingestion orchestration and retryable steps           | Trusted application |
| Supabase Auth        | OAuth identity and session issuance                           | Identity provider   |
| Supabase PostgreSQL  | Source of truth, RLS, rate limits, audit events               | Trusted data plane  |
| Supabase Storage     | Private thumbnail objects                                     | Trusted data plane  |
| Gemini API           | URL analysis and structured generation                        | External processor  |
| Microlink (optional) | Generic public-page preview bytes                             | External processor  |

## Request and data flow

1. A user authenticates through Supabase OAuth.
2. The server validates the session with `getUser()`, loads the profile, and rejects a missing or
   unauthorized profile.
3. A contributor submits a normalized HTTP(S) URL through the dashboard or a scoped personal token
   from the extension.
4. The API validates input, applies origin or token checks, enforces a database rate limit, creates
   or finds the entry, and starts a durable workflow. The workflow creates its processing attempt.
5. Workflow steps use URL Context or the direct YouTube-video path and validate only `title`,
   `tldr`, and existing tag slugs.
6. Curio stores a preview derived from a fixed YouTube/GitHub host, optionally requests generic
   preview bytes from Microlink, or records a generated placeholder; it then finalizes the entry
   through the database function with explicit thumbnail provenance.
7. Realtime invalidation or targeted refresh makes the terminal state visible.

## Dashboard queries

The authenticated dashboard does not load the complete entry table into the browser. Search text,
filters, sort choice, and page selection are resolved on the server; Supabase receives the matching
predicates and a bounded range. The response contains the current page plus the metadata needed to
navigate. Changing search or filters returns to the first page.

## Data model

The versioned Supabase migrations are authoritative. The principal tables are:

- `profiles`: one role-bearing profile per Auth user, with a trusted Google display identity;
- `entries`: canonical links and reviewed/generated metadata;
- `entry_attributions`: display snapshots (historical email, optional name and trusted avatar) kept
  separate from the `entries.created_by` authorization owner;
- `tags`: administrator-managed taxonomy;
- `entry_tags`: many-to-many entry/tag assignments;
- `processing_attempts`: workflow lifecycle, retry, and failure state;
- `api_tokens`: hashed, scoped, expiring/revocable personal tokens;
- `audit_events`: security-relevant mutation history.

The `thumbnails` bucket is private. Database rows store object paths rather than long-lived public
URLs. Delivery uses short-lived signed URLs.

Google OAuth callbacks normalize and synchronize profile identity. New entries snapshot that
identity for display. A private migration may restore a historical author without changing
ownership, so role checks and owner-only mutations continue to use `entries.created_by` exclusively.

## API boundary

Public programmatic routes live under `/api/v1`. The stable surface includes metadata, current-user,
tags, entry submission, and token-management endpoints. Responses follow:

```json
{
  "data": {},
  "error": null
}
```

On failure, `data` is `null` and `error` is a structured object with a stable code and safe message.
Internal stack traces and provider responses are never returned.

Cookie-authenticated mutations require same-origin checks and CSRF protection. Token-authenticated
requests require an explicitly permitted scope. The service-role client is reserved for narrow
administration and workflow steps, not ordinary user reads or writes.

## Deployment topology

Use separate Supabase projects and Vercel environments for development, preview, and production.
OAuth callbacks, application origins, extension IDs, secrets, and model quotas must be distinct.
Preview deployments must not receive production service credentials.

## Design constraints

- Database authorization is mandatory even when the UI hides an action.
- Canonical URL uniqueness is enforced in PostgreSQL.
- Curio does not fetch submitted page content. Gemini URL Context retrieves non-YouTube resources;
  automatic image bytes come only from the two fixed preview hosts or the optional fixed Microlink
  API hosts, with strict redirect, timeout, size, type, dimension, and frame bounds.
- Provider data is treated as untrusted on both input and output.
- Logs identify requests and attempts but omit submitted content, credentials, signed URLs, and
  provider payloads.
