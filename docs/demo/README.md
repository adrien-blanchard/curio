# Static demo

The application route `/demo` renders 12 synthetic knowledge-base entries from
`src/lib/demo/data.ts`. Each entry uses one of the 12 checked-in SVG illustrations under
`public/demo/`. Search is local to this deliberately small, static demonstration dataset.

The demo does not connect to Supabase, call Gemini, require sign-in, or display migrated content.
Set `NEXT_PUBLIC_DEMO_ENABLED=true` to expose it. The production dashboard remains authenticated and
uses server-side pagination, search, and filters.

All future demo data and media must remain synthetic and project-owned. No production screenshot,
account, URL, summary, avatar, timestamp, or migration record belongs here.
