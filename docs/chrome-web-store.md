# Chrome Web Store update

Curio reuses the existing unlisted Chrome Web Store item. Do not create a second listing unless the
current publisher account permanently loses access to the item.

| Field             | Value                                                                       |
| ----------------- | --------------------------------------------------------------------------- |
| Store item ID     | `bldceafomhokgmndglcllplmnclklcdn`                                          |
| Install URL       | `https://chromewebstore.google.com/detail/bldceafomhokgmndglcllplmnclklcdn` |
| Published version | `1.1.0`                                                                     |
| Curio update      | `1.2.0`                                                                     |
| Visibility        | Unlisted                                                                    |

The public key in `extension/manifest.json` derives the existing item ID. It is public identity
material, not a signing secret. Never add a private signing key to this repository.

## Proposed listing copy

**Name:** Curio

**Summary:** Save useful pages to your Curio knowledge base, with tags and AI-assisted summaries.

**Description:**

> Curio lets authorized members save the current browser tab to their team's Curio knowledge base.
> Choose the source type and optional tags, then Curio processes the public page into a searchable
> card with a concise summary.
>
> The extension does not monitor or collect browsing history in the background. When you open the
> popup and choose Save to Curio, it sends that active page URL, the source type, and your selected
> tags to the Curio instance you configured. It does not inject scripts into pages or use remote
> code. Chrome asks for access to the chosen Curio origin. Connection keys are scoped, expire, and
> can be revoked from My Account in Curio.

Recommended category: **Productivity**. Keep the item **Unlisted** so anyone with the Curio install
link can install it without making an internal instance discoverable through Store search.

## Permission and data declarations

- `activeTab`: reads the current tab URL after the user opens the popup. It does not passively read
  other tabs or browser history.
- `storage`: stores the selected Curio origin and a scoped connection key in `chrome.storage.local`.
- Optional host access: requested only for the Curio origin entered by the user and used only for
  `/api/v1` requests. Local HTTP origins are accepted only for development.
- Remote code: **No**.
- Data handled: authentication information; profile name/email returned by the configured Curio
  instance; the active page URL deliberately submitted by the user; and the chosen source type and
  tags. In Privacy practices, conservatively declare **Authentication information**, **Personally
  identifiable information**, and **Web history / browsing activity**, plus the closest category
  offered for the user's tag/source selections. The extension does not read page body content.
- Data use: only the user-facing save-to-Curio workflow, authentication, and connection status.
- Sale, advertising, credit assessment, and unrelated transfer: **No**.
- Privacy policy: use the deployed Curio `/privacy` URL, never the legacy organization policy.

The extension sends submitted URLs only to the instance explicitly configured by the user. The
instance operator remains responsible for accurately listing its infrastructure providers.

## Required assets

- Store icon: `extension/icons/icon-128.png` (128×128 PNG with a 96×96 mark).
- Sanitized full-bleed screenshots: `docs/store-assets/curio-store-screenshot-popup-1280x800.png`
  and `docs/store-assets/curio-store-screenshot-settings-1280x800.png`.
- Small promotional tile: `docs/store-assets/curio-store-promo-440x280.png`.
- Optional marquee tile: 1400×560 PNG or JPEG.

Regenerate these deterministic local assets with `npm run extension:store-assets` after any
extension UI or logo change.

Chrome's current asset rules are documented in
[Supplying Images](https://developer.chrome.com/docs/webstore/images).

## Reviewer instructions

Provide a temporary non-production Curio instance and a short-lived Contributor connection key. The
reviewer flow is:

1. Open extension settings.
2. Enter the HTTPS Curio origin and the temporary key.
3. Approve access to that exact origin and select **Verify and save**.
4. Open a public HTTP(S) page, open the Curio popup, choose optional tags, and save it.
5. Confirm the new entry appears in Curio.

Revoke the reviewer key after review. Never place a key in the listing, screenshots, package, or
repository.

## Release sequence

1. Back up the current `1.1.0` package and listing metadata.
2. Test `1.2.0` unpacked, including the upgrade cleanup for legacy session credentials.
3. Build twice with `npm run extension:build` and verify identical archives and checksums.
4. Upload the complete ZIP to the existing item. A Store update must contain every packaged file and
   a version higher than the published version.
5. Replace every legacy name, description, screenshot, permission explanation, privacy declaration,
   and support URL before submitting. Audit the developer/publisher profile too (display name,
   contact details, and any trader or legal disclosure visible on the public listing), and confirm
   that reusing the existing item is authorized before it can auto-update existing users.
6. Choose deferred publishing when submitting for review. Review approval must not activate the old
   install link in Curio automatically.
7. After deferred approval, enable the extension API for the fixed item ID while keeping the Store
   link hidden, then redeploy:

   ```dotenv
   EXTENSION_ENABLED=true
   ALLOWED_EXTENSION_IDS=bldceafomhokgmndglcllplmnclklcdn
   NEXT_PUBLIC_EXTENSION_INSTALL_URL=
   ```

8. Publish the approved `1.2.0` update and verify that the unlisted Store page now installs version
   `1.2.0`, not the legacy `1.1.0` package.
9. Only then set `NEXT_PUBLIC_EXTENSION_INSTALL_URL` to the Store detail URL, redeploy Curio, and
   test the dashboard install link in a clean Chrome profile.
10. Revoke the test key and verify the extension receives `401` on its next request.

The official update procedure is documented in
[Update your Chrome Web Store item](https://developer.chrome.com/docs/webstore/update).
