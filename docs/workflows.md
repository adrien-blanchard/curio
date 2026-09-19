# Durable workflows

Curio uses the official Workflow DevKit (`workflow` package). Workflow entry points use the
`use workflow` directive and call durable step functions for external or state-changing work.

## Ingestion lifecycle

1. **Accept** — validate the actor and canonical URL, enforce the database rate limit, create or
   find the entry, atomically claim a short dispatch lease, and start the durable workflow.
2. **Begin attempt** — create a processing-attempt row tied to the workflow run.
3. **Load context** — load the canonical URL, the existing taxonomy, and tags already selected by
   the contributor.
4. **Analyze** — use Gemini URL Context for a non-YouTube URL or the direct video path for a
   recognized YouTube URL. Validate exactly `title`, `tldr`, and existing tag slugs.
5. **Prepare thumbnail** — derive a preview from the fixed YouTube/GitHub hosts, optionally request
   generic preview bytes from Microlink, or generate the local placeholder; normalize it to WebP and
   upload it to private Storage.
6. **Finalize** — map suggested slugs to existing tag IDs and call the database finalization
   function with the title, summary, automatic thumbnail candidate, and combined tag IDs. A manual
   thumbnail remains authoritative. The database returns the current, replaced, and discarded paths
   explicitly so the workflow removes only objects that are no longer referenced.

Finalization is also safe when the database commits but its response is lost: before compensating,
the workflow re-reads the entry and processing attempt. A succeeded attempt is treated as committed,
so the workflow never deletes the thumbnail referenced by the ready entry.

PostgreSQL enforces canonical URL uniqueness. Each workflow execution records an attempt and a
workflow run ID; the documentation does not define a separate client idempotency-key contract. The
dispatch lease serializes concurrent duplicate requests. If the request process terminates after the
row commits but before Workflow accepts the run, the lease expires after one minute and a later
submission of the same canonical URL can safely claim dispatch without creating a second entry. The
retry endpoint uses the same lease discipline and preserves the original entry ID.

## Failure behavior

Entries move through `queued`, `analyzing`, `finalizing`, `ready`, and `failed`. Durable step
boundaries update a dedicated processing heartbeat. Processing attempts retain the durable run
history and safe failure metadata. A terminal failure keeps the entry and a safe error code for
review. Processing history is retained rather than deleted on failure.

The dashboard shows **Taking longer than usual** after two minutes without heartbeat progress. A
service-role-only database sweep atomically fences work that has made no progress for fifteen
minutes, closes its active attempt, and records `PROCESSING_TIMEOUT` with the safe message
**Processing timed out. Try again.** The fenced workflow cannot later finalize the entry, even if an
external call eventually returns. Only one queued or running processing attempt may exist for an
entry.

## Retries and request lifetime

Most durable steps allow up to five retries after the initial attempt. Retryable Gemini failures use
a capped exponential delay, for six Gemini calls at most; fatal source and authentication failures
stop immediately. The Google SDK performs no additional hidden retries, and each Gemini HTTP call
has a 120-second timeout. Trusted YouTube/GitHub image downloads make at most two bounded attempts.
Microlink is called at most once per workflow run, and the combined preview-and-storage step is not
automatically replayed so provider quota cannot multiply invisibly. Image downloads have a
ten-second timeout and a 5 MiB limit. The request that accepts a submission does not wait for Gemini
or image processing. Other workflow database and Storage requests use an abortable 30-second
transport deadline.

If a later step fails after a thumbnail upload, the workflow reconciles database state before it
removes an object and records a safe failure on the processing attempt. Provider cancellation after
the database timeout fence is best effort: an already-running external call may continue, but it can
no longer corrupt the terminal database state.

The scheduled Supabase Cron sweep cannot call the Workflow provider. If it wins the expiry race, the
run stops safely at its next bounded database boundary; a provider request already in flight may
continue until its own deadline. A dashboard-triggered sweep asks the provider to cancel only for
run IDs it expires itself, and bounds that cancellation request so page rendering cannot hang.

Realtime remains the primary dashboard update path. While active entries are visible, the client
also refreshes every fifteen seconds when the tab is visible. This fallback makes progress and
timeout messages observable when Realtime is interrupted.

## Local development

Run the workflow development service exactly as documented by the installed Workflow DevKit version.
Provider-managed environment variables are not copied into client code or invented in
`.env.example`. Unit tests mock durable steps; integration tests use the local provider only when
configured.

## Inspecting a run

The Workflow provider exposes its run and step state. Curio also stores the entry state and a
processing-attempt record linked to the workflow run ID. Operators can use those two sources to
inspect retries and safe failure codes. Curio does not claim an application metrics pipeline; log
handling must follow [operations.md](operations.md).
