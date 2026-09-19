# Local setup

This procedure starts the provider-free demo first, then configures the authenticated application,
Supabase, Google OAuth, and Gemini. See [configuration.md](configuration.md) for the complete
variable contract.

## 1. Install prerequisites

- Node.js 24, as declared by `.nvmrc` and `package.json`;
- npm 11.6.2, as declared by `packageManager`;
- Docker;
- Supabase CLI 2.114.0, matching CI;
- a Gemini API key for the configured model;
- a Google OAuth web client for authenticated sign-in.

## 2. Install and view the static demo

From the repository root:

```bash
npm ci
cp .env.example .env.local
npm run dev
```

The checked-in example already sets `NEXT_PUBLIC_DEMO_ENABLED=true`. Open
`http://localhost:3000/demo`. Its 12 entries and 12 illustrations are local and synthetic, so this
route works without Supabase or Gemini values. Stop the development server before continuing.

On PowerShell, use `Copy-Item .env.example .env.local` instead of `cp`.

## 3. Start and reset local Supabase

Start Docker, then run:

```bash
supabase start
supabase db reset
supabase status -o env
```

Map the status output into `.env.local` as follows:

| Supabase CLI output | Curio variable                  |
| ------------------- | ------------------------------- |
| `API_URL`           | `NEXT_PUBLIC_SUPABASE_URL`      |
| `ANON_KEY`          | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| `SERVICE_ROLE_KEY`  | `SUPABASE_SERVICE_ROLE_KEY`     |

The local service-role key is only for the local stack. Do not copy it to a hosted environment or
commit it.

## 4. Complete `.env.local`

Use values appropriate to your local account and never copy the example placeholders below as
production policy:

```dotenv
NEXT_PUBLIC_APP_NAME=Curio
NEXT_PUBLIC_ORGANIZATION_NAME=Local development
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_DEMO_ENABLED=true

NEXT_PUBLIC_SUPABASE_URL=<API_URL from supabase status>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY from supabase status>
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY from supabase status>
API_TOKEN_PEPPER=<random secret of at least 32 characters>

ALLOWED_EMAIL_ADDRESSES=your.name@gmail.com
ALLOWED_EMAIL_DOMAINS=
DEFAULT_USER_ROLE=contributor
INITIAL_ADMIN_EMAILS=your.name@gmail.com

GEMINI_API_KEY=<local Gemini API key>
GEMINI_MODEL=gemini-3.1-flash-lite
THUMBNAIL_PROVIDER=none
MICROLINK_API_KEY=

EXTENSION_ENABLED=false
ALLOWED_EXTENSION_IDS=
NEXT_PUBLIC_EXTENSION_INSTALL_URL=
PRIVACY_CONTACT_EMAIL=privacy@example.test
```

Keep `THUMBNAIL_PROVIDER=none` for a provider-free setup. To exercise generic public-page previews,
set it to `microlink`; the free endpoint needs no key but has a small daily allowance. Never use
private, signed, or credential-bearing URLs, and review [privacy.md](privacy.md) before enabling the
provider for other users.

Replace `your.name@gmail.com` with the same real address in both variables. Allowed email addresses
and domains are comma-separated, normalized to lowercase, and matched exactly. Each list is
optional, but at least one entry is required across the two. Every initial-administrator email must
either appear in `ALLOWED_EMAIL_ADDRESSES` or belong to an `ALLOWED_EMAIL_DOMAINS` entry. For a
personal Gmail account, use the exact address and leave the domain list empty: allowing `gmail.com`
would authorize every Gmail address.

`DEFAULT_USER_ROLE` accepts only `reader` or `contributor`; administrator access is granted only to
an exact email in `INITIAL_ADMIN_EMAILS`. Generate the token pepper with a password manager or
secret manager and keep it stable for the lifetime of issued personal tokens.

Synchronize the validated environment allowlist into the database before the first sign-in:

```bash
npm run configuration:sync
npm run configuration:sync -- --apply
```

The first command is a dry run. The second uses the service-role credential to replace the database
allowlist atomically. Curio also verifies this configuration during an allowed browser session, but
the explicit command makes a fresh reset and operational intent independently testable.

## 5. Configure Google OAuth

The login UI uses Supabase Google OAuth and returns to `/auth/callback`.

1. Create a Google OAuth web client.
2. Add the Supabase Auth callback as an authorized redirect URI. For the default local stack this is
   `http://127.0.0.1:54321/auth/v1/callback`; use the actual `API_URL` printed by the CLI.
3. Enable the Google provider in the local Supabase configuration using that client's ID and secret.
4. Set the Supabase site URL to `http://localhost:3000` and allow
   `http://localhost:3000/auth/callback` as an application redirect.

If the Google OAuth consent screen is in testing mode, add the same personal address as a test user.
Google's test-user list and Curio's exact-email allowlist are separate controls; configure both.

Follow the
[Supabase Google Auth guide](https://supabase.com/docs/guides/auth/social-login/auth-google) for the
provider-specific credential fields. Provider secrets belong in the local Supabase secret mechanism,
not `.env.local` variables exposed to Next.js.

## 6. Start Curio and bootstrap the administrator

```bash
npm run dev
```

Open `http://localhost:3000/login` and sign in with the exact account in `INITIAL_ADMIN_EMAILS`. The
callback verifies the email allowlist and bootstraps that profile as `administrator`. Other allowed
accounts receive `DEFAULT_USER_ROLE`.

Submit a public non-YouTube URL to exercise Gemini URL Context, then a public supported YouTube URL
to exercise the direct-video path. Curio has no scraping fallback: an inaccessible source should
finish as a failed processing attempt.

## 7. Verify the checkout

```bash
npm run format:check
npm run lint
npm run typecheck
npm run test
supabase test db
npm run build
npm run test:e2e
npm run test:extension
```

Use synthetic data for tests and screenshots. Stop local services with `supabase stop --no-backup`
when finished.
