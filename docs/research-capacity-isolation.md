# Research scheduler responsiveness

Two offline reproductions found avoidable dependencies in acquisition scheduling.
They do not establish why any particular customer has pending work or prove that
a provider completed an original operation.

The existing research outreach check evaluated global voice capacity before
discovering that an account had no possible due introduction. The actual captured
function scanned capacity 100 times for 100 empty synthetic accounts. A necessary
local-job hint now avoids all 100 scans. It checks only existing account, job-state,
due-time and unstarted-identity predicates. If any possible introduction remains,
the entire original voice branch still runs, including the provider-capacity
shortcut before detailed recipient checks. The entire SMS branch is unchanged.
The hint cannot authorize outreach, clear a hold, change a price or bypass final
admission. CASE preserves the original boolean and NULL behavior.
An account/due-time partial index covers the hint's exact static conditions.
Without it, a bounded read-only plan filtered nearly 12,000 unrelated rows from
the NULL-operation index. Native tests reproduce that broad scan and verify the
new account/due index path on 12,000 synthetic jobs.

The acquisition selector also acquired the shared scheduler advisory lock before
waiting for the operating-budget row. A native test held that row in an independent
transaction: recovery could issue normally until a research poll began waiting,
then three otherwise-ready recovery polls returned null. Acquisition now requests
the same budget row with SKIP LOCKED. If it is busy, the existing immediate return
ends that poll before account selection, ticket issuance or fair-turn advancement.
When the row is available, acquisition retains the original authoritative lock
until transaction completion. Final money and provider admission are unchanged.

These changes improve scheduling opportunities. They do not increase provider
quotas, change customer controls, settle unknown costs, renew expired source
authority, retry a provider or reduce pending counts by reclassification.

## Verification and release

The local regression runs the captured production outreach function and checks
source drift, transactional rollback, exact detailed predicate preservation,
invoker rights, ACLs, empty/cross-account/future/unknown jobs, recipient exclusions,
SMS holds and 27 boolean/NULL combinations. Native PostgreSQL adds a slow global
capacity boundary: the original empty-account call exceeds the same 100ms
statement timeout under which the optimized call completes without invoking
capacity. An account with a possible introduction still hits that boundary.
This is a controlled fault test, not a production latency measurement.

The acquisition tests run the actual selector, dispatcher and recovery issuer
with concurrent budget holders. They must verify independent recovery, acquired
lock retention, normal research issuance after contention clears, unchanged
controls and original evidence, and unchanged fair-turn/activation metadata.
Both regressions are in the required local release suite; both native scripts
run in the existing isolated PostgreSQL CI job.

After the exact implementation head passes canonical checks and review, apply
`20261115230153_research_capacity_isolation.sql`, then
`20261115230440_acquisition_budget_yield.sql` through the normal migration ledger.
The migrations reject unknown predecessor definitions and do not edit historical
migrations. The second migration updates only the acquisition function hash in
the existing continuation, preflight-step and headroom manifests. Preserve all
enabled flags, release receipts, activation times, counters and other hash keys.
Verify installed function hashes and unchanged security metadata before enrolling
the release. There are no provider, environment or customer-configuration changes.

Observe ordinary successful scheduling and actual completion receipts afterward.
A passing synthetic test or successful scheduler response is not proof that the
existing pending originals completed.
