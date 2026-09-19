# Chrome extension

Curio's optional Chrome extension is a Manifest V3 client for submitting the active tab. It is not a
privileged bypass around the web API.

## Build-time configuration

Configure the extension for one application origin and one extension identity. Production must use
HTTPS. The locally selected API base URL and the server's exact `ALLOWED_EXTENSION_IDS` list must
agree.

Do not commit a production token or generate environment-specific archives by hand. CI creates a
deterministic ZIP and publishes its checksum and SBOM.

```bash
npm run extension:build
npm run test:extension
```

## Authentication

The preferred flow creates a scoped personal API token after an authenticated web interaction. The
plaintext token is delivered once and stored in `chrome.storage.local`. The database stores only its
hash.

Tokens should be limited to submission and profile/tag reads, expire, and be revocable from Curio.
The extension's **Forget token** action removes its browser copy; revocation remains a separate
server-side action in Curio. A `401` response never widens permissions or triggers an implicit token
replacement.

## Permissions

- `activeTab` reads only the URL of the tab the user deliberately submits.
- `storage` keeps the selected origin and token locally.
- There are no background scripts, content scripts, required host permissions, or browsing-history
  permission.
- HTTPS and local-development hosts are optional permissions. Chrome asks the user to approve the
  selected Curio origin; the extension additionally validates and stores only that configured
  origin.

## Publishing

Update the existing unlisted item rather than creating a new listing. This preserves the historical
item ID and the one-click installation URL. Follow the complete copy, asset, reviewer, upgrade, and
activation checklist in [`chrome-web-store.md`](chrome-web-store.md).

1. Build and test against a non-production origin.
2. Review the final manifest and unpacked files.
3. Create the deterministic archive in CI.
4. Verify its checksum and scan results.
5. Upload to the existing browser-store item with the privacy disclosure in this repository.
6. Register the exact extension ID and Store URL in the production server configuration only after
   the updated package is approved.

Store review, signing, ownership, and distribution policy remain the operator's responsibility.
