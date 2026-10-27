# Background throughput release

Long provider waits previously occupied four shared automation slots. A primary
action also retained its slot while checking unrelated pending usage and notices.
After-hours voice jobs could consume a dispatch ticket before discovering their
recipient window was closed.

The worker now reserves capacity for research, messages, voice, receipt recovery
and the existing general workflow. Eight slots are the initial default; sixteen
use the same allocation in two groups. Fresh claims rotate across slots and are
staggered by 250 milliseconds. The database retains its shared claim lock,
original provider limits, recipient checks, Pause and atomic funded admission.

Primary ticket completion queues account follow-up in the same transaction.
The API returns after that durable write. A separate, single-use capability
processes existing estimates, original voice receipts and pending notifications.
Account generations preserve progress arriving during recovery. Five-minute
leases fence stale acknowledgments; missing receipts retain their money holds.
Failed recovery cools down for one minute, with ordinary pending usage checked
every five minutes. A bounded orphan sweep finds accounts whose provider work
outlived a failed primary-finish transaction. No primary provider action is
replayed by this recovery queue.

Both ready voice selection and proven-unstarted budget resumption filter the
existing recipient clock before their limits. Final call-hour checks remain.
Automatic call tickets may refill once per second while the existing eighteen
outgoing/twenty total slot policy permits. Carrier queuing and the verified
provider daily/concurrency limits remain authoritative.

## Rollout

1. Apply the migration; its dedicated dispatcher starts disabled. Existing
   workers continue through the original dispatcher.
2. Release and verify the matching Vercel API and Railway worker from tested main.
3. Enable `icash_work_private.dispatch_policy.enabled` only after the new API is
   live. Observe eight slots, queue settlement, worker health and actual outcomes.
4. Set Railway `ICASH_AUTOMATION_CONCURRENCY=16` after eight-slot validation;
   verify the resulting deployment and per-pool health. No provider billing,
   overages or customer budgets change.

For rollback, disable the dedicated dispatcher before restoring an older API.
The general pool still uses the original dispatcher; queued follow-ups and
provider/financial evidence remain durable. Reverting to eight slots only
requires the corresponding worker variable change.

## Verification

Offline worker tests cover eight/sixteen simultaneous waits, reserved recovery,
round-robin fairness, repeated-loop calls, graceful draining and no ticket replay.
Postgres fixtures execute the actual patched selectors, generation/lease races,
crash replacement, early recipient hours, admission controls and private grants.
Route tests verify primary completion returns without waiting for receipts or
notifications. Follow-up service tests cover original held receipts, bounded
provider reads, independent final writes and stale-worker rejection.

Production verification measures completed tickets and settled usage separately
from scheduling capacity. A configured sixteen-slot worker is not evidence of
sixteen simultaneous calls or a tenfold improvement in useful spending.
