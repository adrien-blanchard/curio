# Contributing to Curio

Thank you for improving Curio. Contributions are accepted under the Apache License, Version 2.0.

## Before you begin

- Search existing issues and pull requests.
- Use a security advisory instead of an issue for vulnerabilities.
- Keep pull requests focused and explain user-visible behavior.
- Do not include production data, private URLs, credentials, tokens, generated migration exports, or
  screenshots containing personal information.
- Confirm that you have the right to contribute all code and assets.

## Development setup

Use the Node version from `.nvmrc`, install dependencies with `npm ci`, copy `.env.example` to
`.env.local`, and run the local Supabase stack. See the [quick start](README.md#quick-start) and
[development guide](docs/development.md).

## Branches and commits

- Branch from `main` using a descriptive name such as `fix/token-revocation`.
- Prefer Conventional Commit subjects: `feat(scope):`, `fix(scope):`, `docs:`, `test:`, `refactor:`,
  or `chore:`.
- Explain why a change is needed; avoid generic subjects such as “update” or “final fix”.
- Never rewrite another contributor's public branch without agreement.

## Pull requests

Every pull request should:

1. describe the problem, implementation, and risk;
2. link an issue when one exists;
3. include tests for behavior changes;
4. include a migration and RLS tests for database changes;
5. update public documentation and `.env.example` for configuration changes;
6. include accessible screenshots for visual changes, using synthetic data;
7. pass the complete repository check.

```bash
npm run check
npm run test:e2e
npm run test:extension
npm run test:rls
npm run build
```

CI treats lint warnings as failures. Generated extension archives and SBOMs are CI artifacts and
should not be manually edited.

## Database changes

- Add a new forward-only file under `supabase/migrations/`.
- Do not edit an applied migration.
- Apply least privilege and enable RLS before exposing a table.
- Add positive and negative tests for anonymous users and every role.
- Keep service-role use out of user-facing request paths whenever possible.
- Document destructive or long-running migrations and their rollback plan.

## Security-sensitive changes

Changes to authentication, authorization, tokens, URL fetching, storage, workflows, or migration
tooling require a threat-focused review. Include abuse cases, input bounds, logs, and failure
behavior in the pull request.

## AI-assisted contributions

AI tools may assist development, but the contributor remains responsible for the result. Review
generated code, verify licenses and provenance, remove private prompts or data, and describe
material AI assistance when the hosting platform or applicable policy requires it.

## Licensing

By submitting a contribution, you agree that it is licensed under Apache-2.0 and that you have
authority to grant that license. Keep existing copyright, license, and NOTICE attributions intact.
