# Worker diagnostic cleanup responsiveness

A local reproduction found a remaining transport-cleanup dependency in worker
database error handling. The diagnostic reader correctly stopped at its existing
4 KiB bound, but awaited stream cancellation before reporting the already-known
HTTP failure. An unfinished native stream whose cancellation stayed pending
retained the scheduling attempt in its slot. A long enough delay could therefore
activate the whole-worker stall watchdog instead of ordinary per-slot backoff.
This is a confirmed resilience defect, not evidence that it caused any particular
historical account's pending operation.

The reader now starts cancellation once without awaiting it, handles an eventual
rejection, and releases its reader lock. The HTTP failure, bounded diagnostic
read, fixed database-code allowlist, privacy boundary and ordinary backoff remain
unchanged. No claim or one-use capability is replayed. Successful database
receipts are still parsed normally. No customer operation, provider receipt,
financial hold, quota, budget or contact permission is changed.

`tests/worker-diagnostic-cleanup.test.mjs` uses native unfinished streams and the
actual RPC, dispatcher and scheduler. It reproduces the pre-change blocked error
and retained slot; covers pending, rejected and synchronously throwing cleanup;
checks independent scheduling, normal delayed polling, bounded drain and no
cleanup-triggered watchdog stall; and preserves error-code redaction and complete
receipts. Its first two groups fail against the predecessor. Existing worker,
watchdog, heartbeat, recurring-failure and response-lifecycle checks remain
required. All fixtures are offline, with no database or provider requests.

Release requires exact-head canonical Reliability checks, exact merged-main
checks, and matching production worker verification through the existing release
controller. No migration, customer change, paid development test, configuration
change or policy activation is needed. Observe real failures and account output
separately; deployment does not establish that historical pending work completed.
