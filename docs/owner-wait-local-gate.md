# Contact-source check before export-wait inspection

On November 17 at 18:37:13 UTC, a production acquisition timeout entered
`record_export_wait`, then `owner_enrichment_wait_candidate`, the outreach-wait
predicate and global voice-capacity inspection. The original wrapper evaluates
that outreach predicate in its WHERE clause before its projected contact-source
existence result. An account with no possible contact source can therefore scan
global voice state while the acquisition transaction holds its budget lock.

The correction adds one necessary static source check around the original
wrapper expression. When no matching screening/ticket exists, it returns false
without the irrelevant global inspection. When one exists, the complete original
expression runs unchanged, retaining outreach priority, current quote and budget,
the full contact-source check and every final admission guard.

The hint copies only necessary static conditions from the exact current source:
account, completed eligible house screening, no seller-request source, allowed
state, recent completion and a potentially reusable ticket. It omits retry
`clock_timestamp()` deadlines and all final source/receipt/history conditions.
Those remain in the original source function. A hint match grants no authority
and cannot renew an expired original. There is no new cache, index, retry,
provider request or customer-state change.

## Evidence and limits

A bounded read-only cohort check found 250 funded accounts allowed by the
existing work monitor's membership, review, cancellation and owner-Pause gates.
All 250 had current configurations. Of those, 206 had no recorded progress in
30 minutes and 139 in 24 hours. The existing pending-exposure calculation left
132 and 99 respectively able to afford the minimum research quote, but only
22 and one able to afford a complete new search. Among the 132, 110 could neither
afford a search nor supply a current contact candidate; 98 of those were inactive
for 24 hours. These are snapshots around 18:36–18:38 UTC, not account promises.

The 22 search-affordable inactive accounts comprised ten with a contact candidate
and no outreach wait, three waiting on eligible outreach, eight with an already
dispatched search original and no contact candidate, and one with a full buffer.
One of the ten contact-candidate accounts also had an already dispatched search
original. Global export capacity was occupied by one unresolved original. This
patch does not settle that original or claim that these accounts are unblocked.
All 22 also had older pending operations, explaining why the mutually exclusive
monitor reported them as pending rather than as `no_completed_work`.

Five of the 22 failed the new static hint; all eleven complete contact candidates
passed it. A single-account read-only plan for a hint-negative account used two
shared-block hits, versus 4,369 for the original wrapper. Hint-positive samples
were comparable in buffer work; live elapsed times varied. The benefit is the
eliminated dependency for a proven-empty source, not a throughput or zero-stall
claim. Broad repeated global-capacity diagnostics were stopped after an
eight-second read-only timeout; that management query is excluded from the
production failure evidence above.

## Verification and rollout

PGlite compares 597 old/new results across generic/custom plans, ordinary/live/
continued sources, ticket states, missing and NULL fields, current controls,
budgets and 27 boolean/NULL combinations. A sentinel proves empty sources skip
global inspection while eligible sources retain it. Catalog, history and policy
snapshots prove that final admission, original receipts and all unrelated fields
stay unchanged. Drift, unexpected policy-trigger changes and a failed migration
history write roll back the entire patch.

Native PostgreSQL compares both prepared plan modes with 12,000 unrelated
screenings, verifies the account-index plan, and uses a slow global boundary to
prove empty sources complete under the same 100 ms limit that rejects the
original. It retains that timeout for a real source. Separate connections test
scheduler/policy contention, rollback and visibility of later committed manual
and source changes. Fixtures use synthetic sources and no providers.

```sh
node --experimental-strip-types tests/owner-wait-local-gate.test.mjs
ICASH_PG_MODULE=/path/to/pg node --experimental-strip-types scripts/test-owner-wait-local-gate-postgres.mjs
```

The native test accepts only the guarded disposable
`127.0.0.1:55443/icash_reliability` target. CI runs it serially in the existing
outreach-preparation job. The migration was generated with Supabase CLI 2.95.3.
Its config and migration bytes must match. Apply it with migration history in
one transaction only after all seven canonical exact-head checks pass.

The patch requires wrapper hash `089ebb9dd46fedfe4e46b8aaf69012f4` and source
hash `7cbb08234d4d09c6aa39190be39b9aeb`, exact owner/security metadata and private
ACLs, plus all five current `owner_wait_hashes` entries. It takes the existing
scheduler lock and policy-row lock with a two-second lock timeout. The only new
function hash is `9e35917f3f2fc3802907a8c1f1d243be`; only its existing manifest
slot changes. Enabled flags, activation receipts, other manifests, counters,
wait ages, final admission and work remain unchanged. Read back the installed
source and manifest, then observe ordinary progress and timeout evidence.
