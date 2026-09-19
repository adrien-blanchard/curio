# Security model and roles

## Roles

Curio stores exactly three application roles in `profiles.role`:

| Capability                      |     `reader`      | `contributor` | `administrator` |
| ------------------------------- | :---------------: | :-----------: | :-------------: |
| Read visible entries and tags   |        Yes        |      Yes      |       Yes       |
| Submit a link                   |        No         |      Yes      |       Yes       |
| Retry or edit permitted entries |        No         |      Yes      |       Yes       |
| Manage global taxonomy          |        No         |      No       |       Yes       |
| Manage users and roles          |        No         |      No       |       Yes       |
| Create/revoke personal tokens   | As policy permits |      Yes      |       Yes       |
| View operational/audit controls |        No         |      No       |       Yes       |

New eligible users default to `contributor`. Deployments that require approval before submission
should change the migration/bootstrap policy deliberately and test it; the UI label alone is not
sufficient.

## Authentication and authorization

For every protected request, the server:

1. validates the Supabase user with `getUser()`;
2. requires a matching profile;
3. verifies the exact, case-insensitive allowed email domain;
4. checks the database role or token scope;
5. applies same-origin/CSRF validation for cookie-authenticated mutations;
6. performs the operation through a user-scoped client and RLS wherever possible.

API tokens are random high-entropy values. Only a one-way hash and metadata are stored. The
plaintext is shown once. Tokens have explicit scopes, optional expiry, last-used metadata, and
revocation. A token cannot exceed the owning profile's current permissions.

## Database controls

Every exposed table enables RLS. Policies deny anonymous access unless a route is explicitly public.
Security-definer functions set a fixed `search_path`, validate the actor, and expose the smallest
operation required. Important database invariants include:

- one profile per Auth user;
- canonical URL uniqueness;
- role enum/check constraints;
- atomic rate limiting;
- workflow finalization through a database function bound to the active attempt;
- prevention of deleting or demoting the last administrator;
- cascade or explicit cleanup for link tables and storage metadata;
- append-oriented audit events.

RLS tests cover anonymous, reader, contributor, administrator, token, and service-role behavior.

## External URLs

Only public `http:` and `https:` URLs without embedded credentials are accepted. Curio canonicalizes
the URL and removes known tracking or secret-bearing query fields before analysis. Non-YouTube page
content is retrieved only by Gemini URL Context; the Curio server has no page-scraping fallback.

Gemini URL Context and direct YouTube inputs disclose the submitted URL to Google. Separately,
automatic thumbnail downloads are limited to URLs derived by Curio for `i.ytimg.com` and
`opengraph.githubassets.com`; arbitrary thumbnail URLs are not accepted by the ingestion workflow.
URL validation and the privacy notice apply before starting the workflow.

Manual images first use a one-time signed upload into the private `thumbnail_uploads` staging
bucket. That bucket cannot be listed or written through normal RLS credentials. Finalization
downloads the object with the guarded server client, validates real bytes with Sharp, writes a new
WebP path to the private `thumbnails` bucket, attaches it through a database authorization function,
and removes the staging object.

## Browser and extension

Cookie sessions use secure, HTTP-only cookies where applicable. State-changing cookie requests
require a trusted Origin and CSRF control. CORS accepts only the configured extension origin, never
every `chrome-extension://` origin.

Extension tokens live in `chrome.storage.local`; this protects them from page scripts but not from a
compromised browser profile. Use short expiry, minimum scope, server-side revocation, and explicit
logout cleanup.

## Logging

Logs may contain opaque request, entry, attempt, and audit identifiers. They do not contain raw
tokens, cookies, keys, full URLs, summaries, model payloads, signed storage URLs, or personal
migration records.
