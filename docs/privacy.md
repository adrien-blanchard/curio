# Privacy and data handling

This document describes the software's data flows. It is not legal advice and does not replace a
deployment-specific privacy notice.

## Data Curio processes

- account identifier, email, avatar metadata, role, and authentication events;
- links deliberately submitted by users;
- generated title and summary, selected existing tags, and a trusted or placeholder thumbnail;
- author, timestamps, processing attempts, token metadata, and audit events;
- operational metadata such as request IDs and safe error codes.

Personal API token plaintext, OAuth secrets, service keys, and refresh tokens are credentials, not
application records. Curio must not log or export them.

## External processors

Supabase processes authentication and stored data. Vercel executes the web application and workflow.
Google Gemini receives submitted URLs and retrieves supported non-YouTube resources through URL
Context or processes a supported YouTube URL directly. Curio does not send separately scraped page
text. When `THUMBNAIL_PROVIDER=microlink`, Microlink also receives the submitted public URL and
returns preview-image bytes through its API; this integration is disabled by default. Browser-store
infrastructure processes extension distribution. Operators must publish their actual provider list,
regions, retention, and legal basis.

## Chrome extension

The extension reads the active tab URL only after user action and sends that submitted URL, source
type, and selected tags to the configured Curio instance. It does not monitor other tabs or request
browsing-history access. It stores the configured origin, a scoped Curio token, and local UI state
in the browser profile. It also receives the connected profile label so the user can verify the
active account.

Curio's use and transfer of information received from Google Chrome APIs complies with the Chrome
Web Store User Data Policy, including its Limited Use requirements. That information is used only to
provide and secure the disclosed Save to Curio feature: sending the page deliberately selected by
the user to the configured Curio instance, creating its catalog entry, and showing it to authorized
members. It is not used or transferred for advertising, unrelated profiling, sale, or generalized
market research. Transfers to the processors documented above are limited to what is necessary to
provide that feature.

## Retention and deletion

Operators should define retention for entries, thumbnails, processing attempts, audit events, logs,
backups, and revoked-token metadata. Deleting an entry must also schedule private storage cleanup.
Account deletion must follow audit and legal retention requirements rather than silently orphaning
content.

## Sensitive URLs

Do not submit intranet links, URLs containing credentials or access tokens, private documents,
personal data, or material that may not be sent to external processors. Curio applies technical
redaction and network controls, but those controls cannot determine every confidentiality
obligation.

## Preview images

Gemini does not choose an image. Curio requests automatic previews from fixed YouTube and GitHub
image hosts. Deployments may opt in to Microlink for other public pages; Curio calls only
Microlink's fixed API host, receives image bytes rather than a third-party image URL, validates
them, and stores only the normalized derivative privately. Provider failure falls back to a labelled
local placeholder. A contributor or administrator may upload a replacement image through the
authenticated application, subject to the documented image limits.

## Migration data

Legacy exports are private transfer artifacts that can contain emails, URLs, summaries, and
authorship. They are excluded from Git, never uploaded to CI, and deleted after verification and the
applicable retention window. Optional author display-name/avatar overrides remain in private import
configuration only. Sanitized reports contain counts rather than identities or content. Export
tooling omits authentication secrets and token tables.
