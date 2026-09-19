# Source age

Cards show a small source-age badge: **< 3 months**, **3–6 months**, **6+ months**, or **Date
unknown**. Age is context, not a judgment of quality. Dates use UTC and calendar-month anniversaries
(a January 31 publication reaches three months on April 30).

`entries.source_published_at` is a nullable date separate from the date the card was added to Curio.
`source_date_kind` records publication, release, video upload, or repository creation.
`source_date_origin` distinguishes extraction (`ai`) from a manual correction (`manual`). The older
`published_at` column remains an internal ready timestamp for compatibility; it must never be used
to infer the age of a resource.

Gemini is asked to return a date only when explicitly present in the source. Missing, invalid or
future dates become unknown. This is extracted metadata, not independent verification. Existing
cards are not backfilled with guessed dates or reprocessed automatically.

Owners and administrators can correct or clear the date in **Manage entry**. The same ownership,
CSRF and state checks as content editing apply. Manual corrections, including a cleared date,
survive retries. Updating title or tags without changing the date leaves its provenance untouched.

Deploy migration `20260919000100_source_dates.sql` before deploying the application. Previous worker
and update RPC signatures remain available during rollout. The new finalizer writes the date in the
same transaction as the ready state and preserves replay and timeout fencing.
