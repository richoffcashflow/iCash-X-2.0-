# Railway screening worker

The live-voice-metering candidate adds a separate ten-second lane with one
eight-second deadline shared by a bounded batch of DB claims and fixed Vercel
endpoint requests. Each pass claims at most 20 fresh tickets and runs at most
four endpoint requests concurrently; claims remain serial. An empty/disabled
queue costs one claim and no endpoint request. A null claim or any failure stops
new claims, and already-started requests settle or abort before the next pass.
It uses fresh one-use capabilities and never retries an uncertain consumed
ticket. It does not dial calls or hold provider keys. Existing screening and
automation waits cannot starve this lane. Startup health remains degraded until
the first successful metering claim; the persisted minute heartbeat can take a
minute to reflect readiness. Install the disabled DB ticket scaffold before
deploying this worker. See `docs/live-voice-metering.md`: live activation remains
blocked on a verified, enforced short-interval cost envelope.

These bounds are not a guaranteed call capacity or renewal latency. At most 20
tickets can be attempted per ten-second pass, and slow DB/provider responses can
complete far fewer before the shared eight-second deadline. If all 20 slots are
used without observing an empty queue, metering health is held (not available)
until a later successful pass observes one; three consecutive held passes return
503. Endpoint failures/timeouts also hold health. Never infer that a fresh claim
heartbeat alone proves every active call was serviced. Before live activation,
measure the maximum concurrent-call workload, oldest-due age and actual end-to-end
latency against renewal headroom, including outages and multiple worker replicas.
The per-process limits do not impose a global provider concurrency limit across
replicas. Admission/capacity policy must leave headroom; the existing funded
carrier deadline remains the outage/overload backstop. This disabled candidate
does not establish those production capacity limits or waive the pricing block.

Build from repository root `/`, Dockerfile `/worker/Dockerfile`, start `node --experimental-strip-types worker/index.mjs`. No dependency installation is needed. Image includes deterministic underwriting modules from `lib`.

Set server-only `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and `SCREENING_WORKER_ENABLED=true`. Without these, health reports standby. Never put secrets in the repo. `/health` returns 503 after three consecutive failures in either screening or automation, and recovers when that lane succeeds. Screening and automation have independent bounded exponential backoff (up to one minute and five minutes respectively); a screening failure does not suppress automation. A successful empty claim resets that lane. Automation failure only schedules a fresh database ticket claim, never a replay of the consumed ticket or an ambiguous provider operation. No property data or keys are logged.

This worker processes only stored property snapshots through the durable Supabase screening queue. It cannot call sellers, send SMS/email or sign documents. In addition to local screening, it can obtain a short-lived database ticket and ask Vercel to execute guarded property discovery or owner enrichment using the existing Vercel API key. Both require enabled, funded and verified server-side configuration. Queue insertion must use a trusted server and a stable event key/due time; there is no public enqueue endpoint. The producer must establish data licensing, account ownership and snapshot provenance. This release does not yet connect automatic property discovery or the customer activity UI to the queue.

Jobs retain due times, lease tokens and results across restarts. Only pure screening is retried after lease expiry, at most three claims; stale workers cannot overwrite results. A database-configured global concurrency cap (default 2) applies across all replicas. Each account has at most 100 unfinished jobs. Paused accounts and accounts with no available credits are skipped before claim. Work already claimed is deterministic computation, with no billable provider side effects. Infra still incurs hosting/database cost.

Before live provider dispatch, use the separate atomic credit/company-cost reservations, provider limits and verified channel permissions. Never reuse screening retry semantics for calls or paid API requests with ambiguous outcomes. SMS remains disabled pending pricing and channel configuration.
