# Curio

Curio is a self-hosted knowledge base for collecting, summarizing, tagging, and searching technical
links. A Next.js dashboard and a Chrome extension feed a shared Supabase project; Google Gemini
produces a title, a short summary, and suggestions from the existing tag taxonomy.

Curio is designed for a small team that wants human-reviewed curation rather than an autonomous
crawler. It is licensed under Apache-2.0.

[![Curio dashboard with synthetic cards and source-age indicators](docs/media/v002/curio_01.jpg)](docs/media/v002/Curio%20Full.mp4)

[Watch the 38-second product tour](docs/media/v002/Curio%20Full.mp4) ·
[Screenshots and recording notes](docs/media/v002/README.md)

The tour uses fictional data and simulated extension submissions; no private team content is shown.
The final video includes a soundtrack; see the [music credit](docs/media/v002/MUSIC-CREDIT.md).

## Demo

Open `/demo` on a running Curio instance to explore a static catalog of 12 synthetic entries. The
route uses only checked-in data and local SVG artwork: it does not require authentication, Supabase,
Gemini, or network-fetched content. It is enabled by `NEXT_PUBLIC_DEMO_ENABLED=true`, as shown in
`.env.example`. See [the demo notes](docs/demo/README.md).

## What it provides

- Google OAuth backed by Supabase Auth.
- Three database-enforced roles: `reader`, `contributor`, and `administrator`.
- Link submission from the dashboard or a Manifest V3 Chrome extension.
- A durable ingestion workflow with explicit attempts, retry state, and an audit trail.
- Gemini analysis using URL Context for public web pages and a direct video input for supported
  YouTube URLs. Curio does not scrape a page when Gemini cannot retrieve it.
- Structured `title`, `tldr`, and up to four tag slugs selected only from the existing taxonomy.
- Server-side pagination, search, and filters. Author email is shown only when profile visibility
  permits it (the current member or an administrator).
- Trusted YouTube/GitHub previews, optional server-side Microlink previews for other public pages,
  and a clearly identified local placeholder whenever no safe image is available.
- Private thumbnail storage and short-lived signed delivery URLs.
- Source-age indicators based on an explicitly sourced date, with manual correction and an honest
  **Date unknown** fallback. Adding an old link today does not make it recent.
- Personal API tokens that are hashed, scoped, revocable, and shown once.

## Architecture

```text
Browser / Chrome extension
        |
        v
Next.js on Vercel -----> durable ingestion workflow -----> Gemini
        |                         |                         URL Context
        |                         +-----------------------> YouTube URL
        v
Supabase Auth + Postgres + Realtime + private Storage
```

Next.js owns the web and API boundary. Supabase is the system of record and enforces authorization
with Row Level Security. Long-running ingestion is isolated from the request that accepts a
submission. See [`docs/architecture.md`](docs/architecture.md).

## Quick start

### Prerequisites

- Node.js matching [`.nvmrc`](.nvmrc).
- npm 11 (the exact package-manager version is declared in `package.json`).
- Docker and the
  [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).
- A Google Cloud project with the Gemini API enabled.

### Local setup

Clone the repository, then run these commands from its parent directory:

```bash
cd curio
npm ci
cp .env.example .env.local
supabase start
supabase db reset
npm run dev
```

Fill `.env.local` with values printed by the local Supabase CLI and a Gemini API key. Never commit
`.env.local` or service-role credentials. Configuration is documented in
[`docs/configuration.md`](docs/configuration.md); the complete local procedure is in
[`docs/setup.md`](docs/setup.md).

Open `http://localhost:3000/demo` for the provider-free demo. For the authenticated application,
sign in with an email listed in `INITIAL_ADMIN_EMAILS`; its profile is bootstrapped as an
administrator after the allowed-domain check succeeds.

### Verification

```bash
npm run format:check
npm run lint -- --max-warnings=0
npm run typecheck
npm run test
npm run test:rls
npm run build
npm run test:e2e
npm run test:extension
```

The package scripts above are part of the public repository contract.

## Deployment

Production uses Vercel and a dedicated Supabase project. Apply reviewed migrations with the Supabase
CLI as a controlled release step, configure Vercel environment variables, register the public OAuth
callback, and package the configurable extension. Follow [`docs/deployment.md`](docs/deployment.md);
do not reuse a development database or extension identity.

## Roles

| Role            | Intended access                                                               |
| --------------- | ----------------------------------------------------------------------------- |
| `reader`        | Browse and search approved content.                                           |
| `contributor`   | Reader access plus link submission and permitted content edits.               |
| `administrator` | Contributor access plus users, roles, tags, tokens, and operational controls. |

The UI is not an authorization boundary. Every protected route and mutation must validate the
authenticated user, profile, role, and request origin as described in
[`docs/security-model.md`](docs/security-model.md).

## Known limits

- Curio is not a general-purpose web crawler or archival service.
- URL Context availability and supported URL types are controlled by Gemini. If Gemini cannot
  retrieve a non-YouTube resource, Curio records a failed attempt instead of scraping it itself.
- YouTube analysis depends on the video being publicly accessible and supported by the selected
  Gemini model.
- Generated summaries and tags can be wrong. Contributors must review them.
- Gemini can select only existing tag slugs and does not create taxonomy entries.
- Automatic previews use deterministic YouTube/GitHub image hosts and may optionally use Microlink
  for other public pages; unavailable or disabled previews use the labelled local placeholder.
- A public URL may expose sensitive query parameters to external processors; Curio rejects embedded
  credentials and redacts known secret-bearing fields, but users remain responsible for submitted
  URLs.
- Each extension installation must be configured with its Curio instance URL and a scoped token.
- Self-hosters own retention, backups, OAuth consent, model usage costs, abuse controls, and
  applicable privacy notices.

## Documentation

- [Architecture](docs/architecture.md)
- [HTTP API](docs/api.md)
- [Setup](docs/setup.md)
- [Configuration](docs/configuration.md)
- [Database and roles](docs/security-model.md)
- [AI ingestion](docs/ai-ingestion.md)
- [Workflows](docs/workflows.md)
- [Chrome extension](docs/extension.md)
- [Chrome Web Store update](docs/chrome-web-store.md)
- [Privacy](docs/privacy.md)
- [Operations](docs/operations.md)
- [Deployment](docs/deployment.md)
- [Legacy migration](docs/migration.md)

## Contributing and security

Read [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report vulnerabilities
through the private process in [SECURITY.md](SECURITY.md), not a public issue. Community conduct is
governed by [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).

## License

Copyright 2026 Curio contributors.

Licensed under the Apache License, Version 2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
