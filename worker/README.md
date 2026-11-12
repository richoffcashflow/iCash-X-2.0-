# Railway screening and automation worker

This service runs continuously with an automatic restart policy. Build from the
repository root using `/worker/Dockerfile`; start with
`node --experimental-strip-types worker/index.mjs`. No dependency installation
is needed in the worker image.

Server-only configuration: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and
`SCREENING_WORKER_ENABLED=true`. `ICASH_AUTOMATION_CONCURRENCY` accepts `8`
(default) or `16`. Eight slots reserve one general, one recovery, two message,
two voice and two research slots; sixteen doubles that allocation. These are
handler slots, separate from provider call concurrency and customer funding.

Every automation attempt claims a fresh, expiring database capability and sends
it once to the fixed production Vercel handler. Claims rotate and are staggered
by 250 milliseconds. Database locks, account fairness, provider capacity,
recipient controls and atomic spending admission remain authoritative. Pure
screening has its own lane. Unknown paid operations are never replayed.

Primary completion durably queues account reconciliation, then frees the worker.
Dedicated recovery checks original receipts and existing pending notifications.
Follow-up generations and leases survive restarts and reject stale completion.
See [the throughput release](../docs/parallel-work-throughput.md) for activation,
rollback and verification. Keep the dedicated database dispatcher disabled until
the matching Vercel API is live.

`/health` reports total and per-pool capacity/in-flight counts. A stalled handler,
three consecutive screening failures, or repeated failures across every slot
in a pool makes health unavailable. Per-slot backoff is bounded; a failing pool
does not stop other pools. Logs contain fixed operation names and HTTP status,
never customer data, capability tokens, provider bodies or credentials.

After deployment, verify Railway SUCCESS, `/health`, a fresh database worker
heartbeat, and actual completed work. A skipped/removed deployment is not an
active worker. Graceful shutdown stops fresh claims and drains known attempts.
Pure screening may retry its existing lease; paid calls, texts and purchases
retain their separate original-receipt and unknown-outcome rules.


A separate 15-second watchdog checks the same stuck-loop/handler deadlines as
health. Only a local stall triggers restart; provider failures and held jobs keep
their independent backoff. The watchdog immediately stops new claims, gives
other in-flight handlers up to 270 seconds to finish, and exits once with code 1.
Railway's existing ALWAYS restart policy starts a fresh process. Original durable
tickets, unknown operations, receipts and money remain unchanged; no request is
replayed by the watchdog. The normal release gate remains in place.

This covers unresolved asynchronous work and a scheduler loop that stopped
scheduling while the event loop still runs. A completely blocked Node event loop
cannot execute this timer; independent stale-heartbeat monitoring remains
necessary. It does not reconcile provider uncertainty or clear account holds.
`worker-watchdog.test.mjs` injects hangs into the real scheduler and checks lane
deadlines, once-only bounded exit, no fresh claims during drain, ordinary failure
isolation and standby behavior without live provider requests.
