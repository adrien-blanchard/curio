# Contributing to Curio

Bug reports, documentation fixes, and focused improvements are welcome.

## Getting started

Follow the [setup guide](docs/setup.md) and [development notes](docs/development.md). For a larger
change, open an issue first so we can discuss the approach.

## Pull requests

- Explain what changes and why; link a related issue if there is one.
- Add tests for behavior changes and update any affected documentation.
- Use demo data in screenshots. Leave out credentials, private URLs, and personal information.
- Keep changes focused and use a descriptive commit message.
- Check that you have permission to contribute the code and assets.

Run these checks before submitting:

```bash
npm run check
npm run test:e2e
npm run test:rls
```

Database tests need the local Supabase stack. Extension tests are included in `npm run check`; see
the [extension guide](docs/extension.md) for browser testing.

## Database and security changes

Add a new migration instead of editing one that has already been applied. Include tests for
permissions and explain any data migration or recovery steps.

For changes to sign-in, tokens, storage, URL handling, or processing, include failure cases as well
as the successful path. Report vulnerabilities through [SECURITY.md](SECURITY.md), not a public
issue.

## License

Contributions use [Apache-2.0](LICENSE). Keep existing copyright and third-party credits intact.
