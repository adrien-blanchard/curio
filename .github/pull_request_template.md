## Summary

Describe the user-visible or operational outcome and the reason for the change.

## Verification

List the commands, roles, browsers, migrations, or failure paths exercised.

## Checklist

- [ ] The change is focused and contains no private deployment data or secrets.
- [ ] Format, lint, type checks, and relevant tests pass with zero lint warnings.
- [ ] Authorization changes are enforced in PostgreSQL RLS as well as the UI/API.
- [ ] New configuration is validated, documented, and absent from client bundles when secret.
- [ ] External URL, AI, logging, privacy, and retention effects were reviewed.
- [ ] Database changes include forward migrations, RLS tests, and rollback notes.
- [ ] API or extension contract changes preserve compatibility or are documented as breaking.
- [ ] User-facing and operator documentation is updated.
