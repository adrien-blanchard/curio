# Development and quality gates

## Repository scripts

The public repository expects these package scripts:

| Script                                  | Purpose                                      |
| --------------------------------------- | -------------------------------------------- |
| `dev`                                   | Start Next.js development mode.              |
| `build` / `start`                       | Build and serve the production application.  |
| `format` / `format:check`               | Write or verify Prettier formatting.         |
| `lint` / `lint:fix`                     | Run ESLint with zero warnings permitted.     |
| `typecheck`                             | Run TypeScript without emitting files.       |
| `test`, `test:watch`, `test:coverage`   | Run Vitest and React Testing Library.        |
| `test:e2e`                              | Run Playwright.                              |
| `test:extension`                        | Validate extension behavior and manifest.    |
| `test:rls`                              | Run local Supabase database/RLS tests.       |
| `check`                                 | Run the fast deterministic quality suite.    |
| `extension:build`                       | Create the deterministic extension artifact. |
| `configuration:sync`                    | Dry-run/apply the database domain allowlist. |
| `storage:cleanup-staging`               | Dry-run/apply bounded staging cleanup.       |
| `migration:export` / `migration:import` | Run private legacy migration CLIs.           |
| `sbom`                                  | Produce a validated, reproducible SBOM.      |

Exact dependency overrides are reviewed release inputs. The `@emnapi/core` override aligns the
optional WASM dependency ranges pulled by the cross-platform image and CSS toolchains, allowing
`npm ls --package-lock-only` and CycloneDX validation to agree on every operating system. Do not
remove or loosen an override without regenerating the lockfile, running the full test suite and
building the SBOM twice to compare hashes.

## Test layers

- **Unit**: URL normalization, permissions, schemas, token handling, AI adapter decisions, image
  validation, extension primitives, and migration merge logic.
- **Component**: accessible interaction with React Testing Library.
- **Database**: migrations and RLS invariants against local Supabase. The pgTAP suite is extended as
  database contracts evolve.
- **End to end**: provider-free smoke coverage for `/demo`, `/login`, and the unauthenticated
  dashboard redirect. Authenticated role journeys require an isolated integration environment.
- **Extension**: manifest, permissions, storage, API adapter, safe DOM source checks, and
  deterministic package behavior. Manual browser acceptance remains required before release.

## CI policy

Formatting, lint with zero warnings, types, unit tests, build, and extension validation always run.
Supabase tests run when the local CLI configuration is present. Playwright runs after a successful
build. Dependency audit fails at high severity. Gitleaks and CodeQL scan every supported event.
Release artifact jobs build the extension twice and compare hashes before uploading the ZIP,
checksum, and SBOM.

Provider-live tests are opt-in and must use isolated projects and repository environment approval.
CI never receives migration-source credentials.
