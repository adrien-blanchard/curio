# Security Policy

## Supported versions

Security fixes are provided for the latest release and the current `main` branch. Older deployments
should upgrade before requesting a backport.

## Reporting a vulnerability

Do not open a public issue. Use the repository host's **Report a vulnerability** / private security
advisory feature. Include:

- affected version or commit;
- deployment assumptions;
- reproduction steps or a minimal proof of concept;
- impact and required privileges;
- any suggested mitigation.

Do not access data that is not yours, persist access, degrade a service, or publish details before a
coordinated disclosure. Reports are acknowledged as soon as maintainers are available; no
response-time or bounty guarantee is made.

## Security boundaries

Curio combines Vercel, Supabase, Google Gemini, and a Chrome extension. Operators are responsible
for:

- protecting deployment credentials and rotating them after suspected use;
- configuring OAuth redirect URLs and allowed account domains;
- applying migrations and Row Level Security policies;
- restricting service-role credentials to trusted server workloads;
- reviewing externally submitted URLs before they reach model tools;
- setting retention, logging, backups, and incident response;
- rebuilding the extension for the correct origin and extension identity.

The browser UI is not an authorization boundary. API routes, server actions, workflow steps,
database policies, and storage policies must each enforce their own assumptions.

## Secrets

Never commit `.env` files, service-role keys, OAuth secrets, Gemini keys, refresh tokens, personal
API tokens, migration exports, or signed URLs. Use local environment files and the deployment
platform's encrypted secret store. If a secret reaches Git, revoke or rotate it immediately;
deleting the file or rewriting history is not sufficient.

## Supply chain

Release CI runs dependency audit, CodeQL, secret scanning, deterministic extension packaging, and
SBOM generation. Verify release checksums and review the included CycloneDX SBOM before deployment.
