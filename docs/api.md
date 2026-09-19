# HTTP API

Curio exposes a versioned JSON API under `/api/v1`. JSON responses use one envelope:

```json
{ "data": {}, "error": null }
```

```json
{ "data": null, "error": { "code": "STABLE_CODE", "message": "Safe message" } }
```

Unknown JSON fields, malformed UUIDs, unsupported enum values, and invalid payloads are rejected at
runtime. Browser mutations require a same-origin `Origin` header. Extension calls use
`Authorization: Bearer curio_pat_...`; Curio stores only a server-peppered verifier. Never put a
token in a URL or log it.

JSON request bodies are limited to 64 KiB, measured from the received bytes even when
`Content-Length` is absent or incorrect. Larger bodies return `413 BODY_TOO_LARGE`; image bytes use
the separate signed Storage upload described below.

## Stable extension surface

| Method and path                  | Authentication                     | Required scope  | Request body                   |
| -------------------------------- | ---------------------------------- | --------------- | ------------------------------ |
| `GET /api/v1/meta`               | Public                             | —               | —                              |
| `GET /api/v1/me`                 | Session or token                   | `profile:read`  | —                              |
| `GET /api/v1/tags`               | Session or token                   | `tags:read`     | —                              |
| `POST /api/v1/entries`           | Contributor/admin session or token | `entries:write` | `{ url, sourceType, tagIds }`  |
| `POST /api/v1/entries/:id/retry` | Owner/admin session or token       | `entries:write` | No body                        |
| `POST /api/v1/tokens`            | Session only                       | —               | `{ name, scopes, expiresAt? }` |
| `DELETE /api/v1/tokens/:id`      | Owner/admin session only           | —               | No body                        |

`POST /api/v1/entries` returns HTTP `202` with `{ id, status, created, dispatchRequired }`.
Canonically equivalent URLs are idempotent. A new row has `created: true`; an existing row has
`created: false`. `dispatchRequired` is true only when Curio must start the durable pipeline. This
also recovers the narrow case where the database committed a queued row but the request process
terminated before dispatch: submitting the canonical URL again starts processing without creating
another row. If a caught dispatch error occurs, the row moves to `failed`, and the error includes
its `entryId` so the owner can retry it.

`POST /api/v1/entries/:id/retry` also returns HTTP `202` with `{ id, status, dispatchRequired }`. A
failed entry is reset in place and claims a dispatch lease. A repeated request for an already leased
queued entry returns `dispatchRequired: false`, so callers do not create duplicate workflow runs. An
expired undispatched lease can be reclaimed with the same ID.

The complete personal token is returned once by `POST /api/v1/tokens`. Treat that response as a
password. Revocation is effective for the next API request.

## Dashboard-only surface

These routes support the first-party web interface and are not extension contracts:

| Method and path                               | Access                             | Payload                  |
| --------------------------------------------- | ---------------------------------- | ------------------------ |
| `GET /api/v1/tokens`                          | Session owner                      | Personal token metadata  |
| `GET /api/v1/tokens?view=organization&page=1` | Administrator                      | Paginated token metadata |
| `PATCH /api/v1/entries/:id`                   | Owner contributor or administrator | Editable fields and tags |
| `DELETE /api/v1/entries/:id`                  | Owner contributor or administrator | No body                  |
| `POST /api/v1/entries/:id/thumbnail`          | Owner contributor or administrator | JSON two-step upload     |
| `PATCH /api/v1/admin/users/:id`               | Administrator                      | `{ role }`               |

Token list responses contain metadata and the stored prefix only; token verifiers and complete
tokens are never returned. The organization view is bounded to 50 records per page. Revoking a
member's token from the administrator interface requires an explicit confirmation.

Thumbnail uploads require an actual JPEG, PNG, or WebP image, up to 5 MiB. First send
`{ "action": "prepare", "contentType": "image/jpeg", "fileSize": 12345 }`. The response contains a
one-time signed upload token and private staging path. Upload the unchanged file directly to that
signed target, then send `{ "action": "finalize", "uploadPath": "<returned path>" }` to the same
route. This keeps image bytes outside Vercel's smaller function-request limit. Finalization
downloads that exact private object server-side; Sharp verifies bytes, frame count, dimensions, and
pixel count before conversion to WebP. Curio then deletes the staging object. Browser clients cannot
write the final `thumbnails` bucket or attach a path directly.

If the database response is lost after committing a thumbnail replacement, the server reads the
authoritative entry row before compensating. It never deletes a newly stored object while commit
state is unknown; a possible orphan is safer than breaking the private path referenced by an entry.

## CORS and origins

Cookie-authenticated mutations are same-origin only. When extension support is enabled, only exact
`chrome-extension://<id>` origins listed in `ALLOWED_EXTENSION_IDS` receive CORS headers. The
extension itself requests an optional host permission for the configured Curio instance and sends
Bearer requests with credentials omitted.

## Compatibility

The `/api/v1` contract follows Curio semantic versions. Additive response fields may appear in a
minor release. Removing or changing documented fields, scopes, or semantics requires a new API
version or a major Curio release.
