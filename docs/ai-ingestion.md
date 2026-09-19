# Gemini ingestion

Curio uses `@google/genai` and a configurable supported Gemini model. The default is the stable
`gemini-3.1-flash-lite`, selected for high-throughput structured extraction while preserving URL
Context and multimodal inputs. The model returns a structured JSON object validated at runtime
before any database finalization.

## Input strategies

### Public web, Git repositories, and papers

For every supported non-YouTube HTTP(S) link, Curio sends the canonical URL through Gemini's URL
Context tool. Git repository, paper, and ordinary public-web URLs all use this path. Curio requires
a successful URL Context result for the same canonical resource; a missing result or a result for a
different redirected resource fails the attempt.

Curio does not download, scrape, or extract page text as a fallback. A resource that URL Context
cannot retrieve remains failed and can be retried later.

### YouTube

Recognized public YouTube URLs are sent to Gemini as a direct video URL input. Curio does not
download the video. Private, age-restricted, region-restricted, removed, or unsupported videos
produce a reviewable failed attempt rather than an invented summary.

## Structured output

The response contains exactly three fields:

```json
{
  "title": "A concise factual title",
  "tldr": "A two- or three-sentence technical summary.",
  "suggested_tag_slugs": ["existing-tag-slug"]
}
```

`title` is 3–100 characters, `tldr` is 30–800 characters, and the slug array contains at most four
unique values. Every slug is checked against the taxonomy loaded before analysis. Gemini cannot
create tags. The structured-output schema permits no other fields, and Curio persists no image or
source-classification value from Gemini. Malformed JSON and unknown slugs fail before finalization.

## Prompt and content policy

- Page content is data, not instruction. Prompts explicitly isolate it from system rules.
- Curio does not send credentials, cookies, private headers, user profiles, or service secrets to
  Gemini.
- Signed and secret-bearing query parameters are rejected or redacted before provider use.
- A generated summary is advisory and remains subject to human review.

## Retries and quotas

The analysis step allows one initial call plus up to five workflow-managed retries: six Gemini calls
at most. The Google SDK's own retry loop is disabled so retries cannot multiply invisibly. Each
provider call has a 120-second HTTP timeout. Errors are classified as retryable or fatal; retryable
failures use capped exponential delays, while authentication and unsupported-source failures stop
immediately. Attempts retain safe error codes and messages, not raw provider payloads.

## Thumbnails are separate from Gemini output

Gemini never supplies a thumbnail or image URL. Curio first derives a preview for a recognized
YouTube video (`i.ytimg.com`) or GitHub repository (`opengraph.githubassets.com`). If
`THUMBNAIL_PROVIDER=microlink`, other public resources are sent to Microlink's fixed server endpoint
with `embed=image.url`; Curio receives the image bytes directly and never follows an image URL from
provider metadata. The Microlink request is best-effort and is not retried by Curio.

Every remote response rejects redirects, is limited to 10 seconds and 5 MiB, and must decode as a
single-frame JPEG, PNG, or WebP within the documented dimension and pixel limits. Curio converts an
accepted image to 720×309 WebP and stores it privately. Missing, disabled, rate-limited, invalid, or
unavailable previews produce a clearly identified local placeholder without failing the entry.

A manually uploaded thumbnail always has priority over an automatically derived preview. Replaying
or retrying ingestion may replace an automatic preview or placeholder, but it does not overwrite a
manual thumbnail.
