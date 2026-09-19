# Curio v1.0 release checklist

This tracks source publication and deployment readiness separately. Publishing the repository does
not promote the existing Preview to production. Check an item only when it has been exercised
against the environment named by the item.

## Verified baseline

- [x] Database permission hardening: 359 assertions pass locally, including regression tests for
      Supabase's default function grants. Session mutations exclude the service role; worker grants
      remain intact. The new migration has not been applied to the hosted development database.
- [x] Pre-publication review (2026-09-19): patched dependencies; dependency audit reports zero known
      vulnerabilities. JSON API requests are capped at 64 KiB, and preparing an image replacement
      preserves other recent uploads. Both changes have regression tests. The final local suite has
      520 passing tests (two opt-in live-provider tests skipped), plus three backend-free browser
      checks. Session/token authentication has dedicated boundary tests.
- [x] Publication privacy review: no configured credentials or private project/company references
      found across the Git history. Published screenshots and sampled video frames use fictional
      data. Only `.env.example` is tracked; local credentials and import/reference folders are
      excluded. Both GitHub dependency audit and full-history secret scanning pass.
- [x] Source-age update: 502 application tests and 352 database assertions pass locally. The
      additive date migration is applied to development; all 50 existing entries remain intact with
      unknown source dates. Dashboard/detail/editor have no page overflow at 320, 375, 768, 1280 and
      1920 px. Full visual/accessibility release review below is still pending.
- [x] Formatting, ESLint, TypeScript, production build, dependency audit, 481 application tests, and
      335 database assertions pass locally.
- [x] The legacy import restored 44 entries, 15 historical tags, author attribution, and private
      thumbnails.
- [x] Google OAuth works locally for the configured account.
- [x] One real non-YouTube Gemini workflow completed successfully in about 58 seconds.
- [x] The current Gemini key, model, URL Context, and structured parser were re-smoked through the
      application code against a public GitHub repository after the timeout changes.
- [x] Gemini 3.1 Flash-Lite was exercised without database writes against an ordinary public page, a
      GitHub repository, and a public YouTube video; all three returned schema-valid summaries and
      existing taxonomy tags in approximately 1.6–13.4 seconds.
- [x] The Local World runtime was re-smoked after isolating Node-only step dependencies: one source
      failed cleanly as unavailable and one completed all eleven steps in about 46 seconds.
- [x] The extension has 33 passing automated tests, a real Chromium identity/upgrade-cleanup smoke,
      and a reproducible ZIP build.
- [ ] Restore the test data to zero fixture administrators. One of the 50 fixtures is currently an
      administrator after role testing.

## 1. AI ingestion and recovery

- [ ] Submit one ordinary public page, one GitHub repository, one arXiv paper, and one public
      YouTube video on the Vercel Preview.
- [ ] For each source, verify `queued -> analyzing -> finalizing -> ready`, English title and
      summary, existing tags only, one entry ID, and an appropriate thumbnail or placeholder.
- [ ] Exercise a private/deleted source, an invalid Gemini key, a 429/quota response, a provider
      5xx, malformed structured output, and a lost workflow acknowledgement.
- [ ] Confirm that retryable Gemini errors make at most six calls in total: the initial call plus up
      to five retries. Confirm that fatal errors do not retry.
- [ ] Confirm that **Retry** preserves the entry ID, never creates a duplicate, and eventually shows
      either `ready` or a safe, useful failure message.
- [x] Display a classified safe `error_message` in the card/modal instead of showing only `Failed`.
- [x] Add a polling fallback when Supabase Realtime is unavailable.
- [x] Add client request timeouts so submit, save, retry, delete, and upload cannot spin forever.

### Implemented processing-time policy; Preview validation remains

Curio fences attempts after 15 minutes without progress, not 15 minutes of total elapsed time.
Database recovery is authoritative; provider cancellation is best effort and cannot guarantee that
an already-running external request stops or avoids a charge. Validate these timings on Preview:

- [x] After 2 minutes without a state/heartbeat change, show **Taking longer than usual**. Do not
      fail the entry yet.
- [x] After 15 minutes without progress, mark the attempt `failed` with `PROCESSING_TIMEOUT`, show
      **Processing timed out. Try again**, and enable Retry.
- [x] Record a heartbeat at durable step boundaries so a long but progressing job is not cancelled.
- [x] Recover stale `analyzing` and `finalizing` attempts safely; never run two active workflows for
      the same entry.
- [x] Add database and workflow tests for recovery at `queued`, `analyzing`, and `finalizing`.
- [x] Apply the recovery migration to the development Supabase project and verify the one-minute
      Cron job completes successfully without changing existing entries.

## 2. Thumbnails and manual replacement

- [ ] Upload a valid JPEG, PNG, and WebP and verify real-byte validation, conversion to 720 x 309
      WebP, private Storage, and an immediate signed preview.
- [ ] Replace the same card image twice and verify that the previous object and staging object are
      removed without breaking the current thumbnail.
- [ ] Reject a false MIME type, invalid bytes, animation, dimensions above 8192 px, more than 40
      megapixels, and files above 5 MiB with clear messages.
- [x] Preserve a manual thumbnail through Retry and workflow replay; an automatic preview replaces
      only another automatic preview or placeholder.
- [ ] On Preview, test a failed card with a manual image, then Retry once with a failed workflow and
      once with a successful workflow.
- [ ] Run `npm run storage:cleanup-staging` in dry-run and apply modes, then schedule it for Preview
      and production so abandoned uploads older than one hour are removed.
- [ ] Test an expired signed URL and verify that refreshing the page obtains a new one.

## 3. Chrome extension and easy installation

- [ ] Load `extension/` through `chrome://extensions` in Developer mode and test it against
      `http://localhost:3000`.
- [x] Preserve the published extension ID in the manifest, copy it to `ALLOWED_EXTENSION_IDS`, set
      `EXTENSION_ENABLED=true`, and restart local Curio.
- [ ] Create a token with exactly `entries:write`, `tags:read`, and `profile:read`; verify profile,
      tags, submission, duplicate, rate-limit, and server-error behavior.
- [ ] Revoke the token and confirm the next extension request returns `401`.
- [ ] Repeat the complete flow against a Vercel Preview over HTTPS and with a fresh Chrome profile.
- [ ] Test keyboard use, narrow popup dimensions, long error messages, many tags, and offline mode.
- [ ] Build and scan the final deterministic ZIP, checksum, and SBOM from CI.
- [ ] Update the existing **Unlisted** Chrome Web Store listing. Its published version is `1.1.0`,
      so give the rewritten extension a strictly higher technical version and decouple that version
      from the Curio application release version in CI.
- [ ] Replace every legacy Store field with neutral Curio content: name, description, permission
      justifications, privacy declarations, icon, and screenshots. Keep the saved Store dashboard
      pages in `extension_ref` private and outside Git.
- [x] Generate a neutral padded 128×128 icon, a 440×280 promotional tile, and two sanitized 1280×800
      Store screenshots from the current Curio UI.
- [ ] Keep a new listing only as a fallback if access to the existing listing is lost or updating it
      would disrupt users who must remain on the legacy extension. A raw ZIP is useful for
      developers but cannot provide a safe one-click Chrome installation.
- [x] Add `NEXT_PUBLIC_EXTENSION_INSTALL_URL`, pass it to the existing sidebar install action, and
      show **Add to Chrome** only when extension support is enabled and the member can submit
      entries. Keep the URL empty until version 1.2.0 is approved.
- [ ] Click the dashboard link in a clean Chrome profile and verify the full store installation.

## 4. Source-age indicator

Do not calculate solution age from `created_at`: that is when someone added the card to Curio. Do
not use the current `published_at` either: it is the time Curio finished processing the entry. Using
either value would make an old solution added today look new.

- [x] Add a nullable, separate source date and provenance, for example `source_published_at`,
      `source_date_kind`, and `source_date_origin`.
- [x] Keep the existing internal `published_at` for worker compatibility; document its ready-time
      meaning and use only the new `source_published_at` for source-age indicators.
- [x] Accept a date from Gemini only when the source states it explicitly; otherwise store `null`.
      Never invent a date.
- [x] Prefer authoritative meanings: arXiv first publication, YouTube upload, product release, or a
      clearly labelled GitHub release/repository date. Never silently mix publication and
      last-updated dates.
- [x] Let the owner or an administrator correct or clear the date in **Manage entry**.
- [x] Derive the age at render time using calendar months:
  - **Recent** — less than 3 months;
  - **3-6 mo** — at least 3 and less than 6 months;
  - **6+ mo** — at least 6 months;
  - **Date unknown** — no trustworthy source date.
- [x] Use text plus colour, not colour alone. Show the exact source date and its meaning in a
      tooltip and in the modal. Age is context, not a quality score.
- [ ] Test exact 3/6-month boundaries, UTC and month ends, future/invalid dates, unknown dates,
      manual corrections, retries, permissions, contrast, and responsive layout.
- [ ] Backfill the existing cards only from verified source metadata or manual review. Leave the
      rest as **Date unknown**.

## 5. Visual, responsive, and robustness review

- [ ] Review dashboard, filters, cards, modal, Tags, Members, My Account, login, and `/demo` at 320,
      375, 768, 1280, and 1920 px, plus 200% browser zoom.
- [ ] Verify no horizontal page scroll, cropped tags, overlapping badges, clipped menus, or modal
      footer overflow.
- [ ] Complete all core flows with keyboard only; verify focus return, Escape behavior, visible
      focus, labels, live messages, and reduced motion.
- [ ] Exercise empty, loading, slow-network, offline, validation-error, permission-error, failed,
      and very-long-content states.
- [ ] Verify cards with missing/broken thumbnails use the local placeholder and translucent **No
      preview** treatment.

## 6. Accounts and production data

- [ ] Complete real OAuth checks for an allowed address, a rejected address, logout, and session
      expiry.
- [ ] Verify Reader, Contributor, and Administrator permissions end to end, including protection of
      the last real administrator.
- [ ] Return the promoted fixture administrator to Contributor before the last-admin test.
- [ ] Remove all 50 fixture accounts from any environment that will become production.
- [ ] Verify production contains no legacy export, checkpoint, report, test token, or test content.

## 7. Private Preview and public release

- [x] Prepare six clean JPG screenshots and a 38.4-second English captioned tour using synthetic
      data, including the extension popup. See `docs/media/v002/README.md`.
- [x] Reauthenticate the local Vercel CLI and create a Preview. The old production site remains
      unchanged. Preview `/demo` returns 200, the private profile API returns 401 without a Curio
      session, and the capture-only studio returns 404. The owner confirmed Google sign-in and one
      link submission work. The full multi-source, role, and extension matrix remains pending.
- [x] Select the owner's final five JPG screenshots and two MP4 exports, including the credited
      Cipher soundtrack in the full tour. Raw masters and prior iterations stay outside Git.
- [x] Configure the repository-local Git identity with the personal GitHub no-reply address.
- [x] Run a full secret scan, create the single root commit `Initial public release`, and push to a
      new private GitHub repository.
- [ ] Create isolated Preview and production Supabase projects and rebuild each only from
      migrations.
- [ ] Connect the private repository to Vercel; configure environment variables, OAuth callbacks,
      Workflow, configuration sync, Storage, Realtime, and backups.
- [ ] Require green CI, RLS, Playwright, extension, audit, secret scan, and CodeQL checks on the
      exact release commit.
- [ ] Enable branch protection, push protection, Dependabot, and private vulnerability reporting.
- [ ] Verify brand and asset rights, then create `v1.0.0` and its GitHub Release artifacts.
- [ ] Perform a final human review before changing the repository from private to public.

## Definition of done

Curio v1.0 is ready only when the Preview has passed the real OAuth, role, ingestion, retry,
thumbnail, extension, responsive, and recovery scenarios above; production has no fixtures or
private migration material; and the release commit passes every automated security and quality gate.
