# Changelog

All notable changes to Curio will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Source-age badges with explicit publication/release/upload provenance, unknown-date fallback, and
  owner/administrator corrections protected through retries.
- Six clean product screenshots and a captioned English tour using synthetic local fixtures.
- Historical display attribution, author filtering, and trusted Google profile avatars without
  weakening entry ownership checks.
- Resumable private-import attribution restoration with count-only reports and optional private
  identity overrides.
- Durable processing heartbeats, a two-minute slow-processing warning, a fifteen-minute atomic
  timeout fence, and dashboard polling when Realtime is unavailable.
- Bounded browser requests for entry mutations and thumbnail uploads, with recoverable timeout
  messages instead of indefinite spinners.
- Explicit automatic/manual/placeholder thumbnail provenance, optional generic Microlink previews,
  and a safe dry-run repair tool for historical placeholder objects.

### Changed

- The default analysis model is now Gemini 3.1 Flash-Lite, retaining URL Context, direct YouTube
  input, and structured output while providing a higher-throughput default for catalog ingestion.
- Gemini calls now have a 120-second provider timeout and a single workflow-owned retry policy of
  one initial call plus at most five retries.
- Manually uploaded thumbnails take priority over automatic previews during workflow retries and
  replays.
- Stored Curio placeholders now render as the varied local artwork with a visible **No preview**
  label instead of appearing to be a real repeated thumbnail.

### Security

- Bound API JSON bodies to 64 KiB, including requests without a trustworthy Content-Length.
- Preserve recent private thumbnail uploads when another editor starts an image replacement.
- Refresh patched dependencies before the initial GitHub publication: Next.js 16.3.5, Sharp 0.35.4,
  Workflow 4.8.9, Vitest 4.1.11 and js-yaml 4.3.2, with a regenerated lockfile.
- Catalog author emails now share a strict database/UI validation boundary, including DNS-label and
  top-level-domain checks.
- Stale workflow attempts are fenced in PostgreSQL before provider cancellation, preventing a late
  external response from overwriting a terminal entry.

## [1.0.0] - 2026-08-14

### Added

- Static `/demo` catalog with twelve synthetic entries and local artwork.
- Private, server-paginated knowledge dashboard with Google OAuth and organization allowlists.
- Versioned API v1, scoped personal tokens and a configurable Manifest V3 Chrome extension.
- Durable Gemini ingestion workflow with URL Context, structured output and idempotent retries.
- Versioned Supabase schema, RLS, private Storage, audit events and 144 pgTAP assertions.
- Private, resumable legacy migration tooling with dry-run imports and verified thumbnails.
- Public documentation, governance files, security policy, CI, CodeQL, secret scanning, SBOM and
  deterministic release artifacts.

### Changed

- Authorization is standardized as `reader`, `contributor`, and `administrator` and enforced at the
  page, API, RPC and RLS boundaries.
- Tags are an administrator-managed taxonomy; contributors and Gemini select existing tags only.
- Thumbnails use verified WebP objects in private buckets and short-lived signed URLs.

### Security

- Public publication starts from a clean repository history and excludes private migration exports,
  credentials, tokens and authentication records.
- URL validation blocks local/private networks, credentials, non-standard ports and secret-bearing
  query parameters before external processing.
- Cookie mutations validate Origin/CSRF; extension calls use exact CORS origins and revocable,
  hashed tokens.
