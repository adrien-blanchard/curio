# Curio

A shared library for the technical links your team wants to keep. Save a resource from the dashboard
or Chrome extension, get a short summary, and find it later by tag, author, or source.

https://github.com/user-attachments/assets/8702a16d-eff7-4908-a473-f7af22ddf9e6

_38-second tour with demo data and simulated submissions.
[Music credit](docs/media/v002/MUSIC-CREDIT.md) · [Screenshots](docs/media/v002/README.md)_

## Features

- Save links from the web app or Chrome extension.
- Generate summaries and tag suggestions with Gemini, then review or edit them.
- Browse visual cards with search, filters, and source-age indicators.
- Manage team access with Reader, Contributor, and Administrator roles.
- Replace previews, correct source dates, and retry failed submissions.

Built with Next.js, Supabase, Gemini, and Vercel Workflows. Self-hosted, with your own accounts and
API keys.

## Quick start

To explore the demo locally, install Node.js 24 and npm 11, then run:

```bash
git clone https://github.com/adrien-blanchard/curio.git
cd curio
npm ci
cp .env.example .env.local
npm run dev
```

Open [localhost:3000/demo](http://localhost:3000/demo). The demo needs no Supabase or Gemini
credentials. On PowerShell, you can use `Copy-Item .env.example .env.local`.

For sign-in and real submissions, follow the [setup guide](docs/setup.md) to configure Supabase,
Google OAuth, and Gemini. Keep credentials in `.env.local`, never in Git.

## Documentation

- [Setup and configuration](docs/setup.md)
- [Chrome extension](docs/extension.md)
- [Deployment](docs/deployment.md)
- [Architecture and API](docs/architecture.md)
- [Permissions and security](docs/security-model.md)
- [Operations and troubleshooting](docs/operations.md)

## A few things to know

Summaries and suggested tags need human review. Some sources cannot be read by Gemini, and some
pages have no usable preview. An unknown source date stays unknown; age is context, not a quality
score. Provider quotas and usage costs depend on your accounts. See
[ingestion](docs/ai-ingestion.md) and [privacy](docs/privacy.md) for details.

## Contributing

Bug reports and focused improvements are welcome. See [contributing](CONTRIBUTING.md) for
development checks, or [security](SECURITY.md) to report a vulnerability privately.

## License

[Apache-2.0](LICENSE). Third-party media retain their own licenses; see [NOTICE](NOTICE) and the
[music credit](docs/media/v002/MUSIC-CREDIT.md).
