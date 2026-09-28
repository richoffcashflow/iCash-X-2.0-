# Railway screening worker

Build from repository root `/`, Dockerfile `/worker/Dockerfile`, start `node --experimental-strip-types worker/index.mjs`. No dependency installation is needed. Image includes deterministic underwriting modules from `lib`.

Set server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SCREENING_WORKER_ENABLED=true`. Without these, health reports standby. Never put secrets in the repo. `/health` returns 503 after repeated database failures. No property data or keys are logged.

This worker processes only stored property snapshots through the durable Supabase screening queue. It cannot call sellers, send SMS/email or sign documents. In addition to local screening, it can obtain a short-lived database ticket and ask Vercel to execute guarded property discovery or owner enrichment using the existing Vercel API key. Both require enabled, funded and verified server-side configuration. Queue insertion must use a trusted server and a stable event key/due time; there is no public enqueue endpoint. The producer must establish data licensing, account ownership and snapshot provenance. This release does not yet connect automatic property discovery or the customer activity UI to the queue.

Jobs retain due times, lease tokens and results across restarts. Only pure screening is retried after lease expiry, at most three claims; stale workers cannot overwrite results. A database-configured global concurrency cap (default 2) applies across all replicas. Each account has at most 100 unfinished jobs. Paused accounts and accounts with no available credits are skipped before claim. Work already claimed is deterministic computation, with no billable provider side effects. Infra still incurs hosting/database cost.

Before live provider dispatch, use the separate atomic credit/company-cost reservations, provider limits and verified channel permissions. Never reuse screening retry semantics for calls or paid API requests with ambiguous outcomes. SMS remains disabled pending pricing and channel configuration.
