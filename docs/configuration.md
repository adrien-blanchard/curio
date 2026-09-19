# Configuration

Curio validates browser-visible and server-only configuration through separate schemas. Server
values are resolved only by server entry points, so the static `/demo` route and public metadata can
build without live provider credentials. Importing a server schema from a client module is an error.

`npm run dev` can serve the isolated demo while provider values are still empty. Production builds
are different: the `prebuild` gate validates the complete runtime contract and stops with
field-level errors before Next.js runs. This prevents an incomplete Vercel deployment from becoming
a broken dashboard. Vercel origins must be non-local HTTPS origins.

The checked-in `.env.example` is the authoritative list. Copy it to `.env.local` for development and
use encrypted Vercel environment variables in hosted environments.

## Application variables

| Variable                            | Visibility | Requirement and purpose                                                                                     |
| ----------------------------------- | ---------- | ----------------------------------------------------------------------------------------------------------- |
| `NEXT_PUBLIC_APP_NAME`              | Browser    | Product label; defaults to Curio.                                                                           |
| `NEXT_PUBLIC_ORGANIZATION_NAME`     | Browser    | Optional operator label.                                                                                    |
| `NEXT_PUBLIC_APP_URL`               | Browser    | Canonical application origin used for links, OAuth, Origin, and CSRF checks.                                |
| `NEXT_PUBLIC_DEMO_ENABLED`          | Browser    | Enables the static demonstration surface when `true`.                                                       |
| `NEXT_PUBLIC_SUPABASE_URL`          | Browser    | Supabase project URL; optional only for the isolated static demo.                                           |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY`     | Browser    | Publishable/anonymous Supabase key; optional only for the isolated static demo.                             |
| `SUPABASE_SERVICE_ROLE_KEY`         | Server     | Required for narrow privileged database and storage operations.                                             |
| `ALLOWED_EMAIL_ADDRESSES`           | Server     | Optional comma-separated exact allowed email addresses; matching is case-insensitive.                       |
| `ALLOWED_EMAIL_DOMAINS`             | Server     | Optional comma-separated exact allowed domains, without `@`; matching is case-insensitive.                  |
| `DEFAULT_USER_ROLE`                 | Server     | `reader` or `contributor`; defaults to `contributor` and can never bootstrap an administrator.              |
| `INITIAL_ADMIN_EMAILS`              | Server     | Comma-separated exact bootstrap administrator emails; each must be covered by an allowed address or domain. |
| `API_TOKEN_PEPPER`                  | Server     | Secret of at least 32 characters used in personal-token hashing.                                            |
| `GEMINI_API_KEY`                    | Server     | Google Gemini API authentication.                                                                           |
| `GEMINI_MODEL`                      | Server     | Supported structured-analysis model; defaults to `gemini-3.1-flash-lite`.                                   |
| `THUMBNAIL_PROVIDER`                | Server     | Generic preview provider: `none` (default) or `microlink`.                                                  |
| `MICROLINK_API_KEY`                 | Secret     | Optional Microlink Pro key; never expose it to the browser or include it in a URL.                          |
| `EXTENSION_ENABLED`                 | Server     | Enables extension-specific API behavior when set to `true`.                                                 |
| `ALLOWED_EXTENSION_IDS`             | Server     | Comma-separated exact production extension IDs.                                                             |
| `NEXT_PUBLIC_EXTENSION_INSTALL_URL` | Public     | Optional direct Chrome Web Store detail URL. Its ID must be allowlisted when extension support is enabled.  |
| `PRIVACY_CONTACT_EMAIL`             | Server     | Required valid address shown in deployment privacy and API metadata.                                        |

Names in this table must stay synchronized with `.env.example` and the runtime schemas. If a
checkout uses a smaller contract, follow that checkout's schema rather than adding unvalidated
variables ad hoc.

The Workflow SDK may require provider-managed variables in local or hosted environments. Use only
names documented by the installed Workflow DevKit version; do not mirror platform credentials into
public variables.

`THUMBNAIL_PROVIDER=none` keeps generic previews fully local: only the fixed YouTube and GitHub
image hosts are queried. Set it to `microlink` only after accepting that submitted public URLs are
sent to Microlink. The free endpoint works without `MICROLINK_API_KEY` but is intended for light
testing; a configured key is sent only in the `x-api-key` request header to Microlink Pro.

## Rules

- Production cannot use a localhost application URL.
- URLs must use HTTPS in production and must not contain credentials.
- Allowed addresses and domains are normalized to lowercase, deduplicated, and matched exactly. A
  suffix comparison is insufficient. At least one entry is required across `ALLOWED_EMAIL_ADDRESSES`
  and `ALLOWED_EMAIL_DOMAINS`.
- The two allowlist variables are mirrored into private database allowlists used by RLS and personal
  tokens. Run `npm run configuration:sync -- --apply` after migrations and every change to either
  variable.
- Use `ALLOWED_EMAIL_ADDRESSES` for a personal Gmail account. Allowing the `gmail.com` domain would
  authorize every Gmail address, not just the operator's account.
- There is no development bypass for the email policy. Configure a local test address or domain
  explicitly.
- `INITIAL_ADMIN_EMAILS` requires at least one address and is bootstrap input, not a permanent
  authorization list. Every initial administrator must match an exact allowed address or belong to
  an allowed domain. The database prevents removal, demotion, or allowlist exclusion of the last
  allowed administrator.
- The service-role key, Gemini key, Microlink key, token pepper, OAuth secrets, workflow provider
  credentials, and migration credentials are never exposed to the browser.
- Preview and production values are different.

## Local Supabase

Start the local stack with the repository scripts, then copy its project URL and publishable key
into `.env.local`. The local service-role value is suitable only for the local container. Resetting
the database applies every migration and seed deterministically.

## Vercel

Set environment variables independently for Development, Preview, and Production. Treat values
copied between environments as a security exception. After rotation, redeploy all affected functions
and revoke active sessions or tokens when their trust material changed.

## Migration-only configuration

Legacy export uses `LEGACY_SUPABASE_URL` and `LEGACY_SUPABASE_SERVICE_ROLE_KEY`. Import uses
`CURIO_TARGET_SUPABASE_URL` and `CURIO_TARGET_SERVICE_ROLE_KEY`. Private JSON configuration is
preferred. These names are deliberately outside the web application schema; see
[migration.md](migration.md).

For a complete development sequence and value mapping from the local Supabase CLI, see
[setup.md](setup.md).
