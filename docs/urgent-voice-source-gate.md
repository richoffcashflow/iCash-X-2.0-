# Skip ordinary jobs in the urgent voice scan

The exact SQL is already installed as migration `20261103184920`; retain that
ledger identity and do not replay it. This release records the matching source,
offline regression and native PostgreSQL checks in the repository.

The November 3 18:18–18:39 UTC logs contained four scheduler statement
timeouts, including one in the urgent voice selection. Read-only inspection
found 658 ready jobs and zero with a requested-call, callback or cancellation
source. The urgent selector nevertheless considered ordinary rows before its
source CASE could reject them.

The correction adds the logically necessary source-presence predicate ahead
of the existing checks. It preserves the complete CASE, original contact and
phone checks, capacity, funding, Pause, row locks, urgent due ordering and
ordinary-account fairness. The function's exact prior hash is required. No
new index, queue state, receipt, customer control or financial change is made.

Production READ ONLY counterfactual EXPLAIN ANALYZE used the existing source
indexes together with the ready index, returned zero rows in 0.217 ms with
22 shared buffer hits, and executed zero contact/window/callback subplans.
The original query was EXPLAIN-only to avoid replaying the observed expensive
scan. Its estimated plan cost was 82,032 versus 140 for the counterfactual;
this is a plan comparison, not a measured old/new latency claim. Row locking
was removed only from those diagnostic SELECTs; production locking is exact.
An empty capacity parameter was used because no urgent candidate reached that
check. The measurement does not include building the shared capacity snapshot
or the ordinary fallback scan.

Offline regression loads the captured production issuer and tests the
ordinary backlog, all three urgent source types, unchanged due ordering,
ordinary-account fairness, blocked guards and preserved financial evidence.
The native PostgreSQL workflow loads the same captured issuer and fixture,
checks 24 readers against the 1,000-job ordinary backlog, races 24 issuers for
each urgent source, tests locked-row revisit and ordinary-account fairness,
and preserves Pause, reservations and expired-source rejection. Predicate
boundaries are synthetic; this is not a paid-provider dispatch test. Require
the exact native workflow result, release checks and ordinary production
progress before claiming recovery.
