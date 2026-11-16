# Policy review lock isolation

Production logs on November 16 recorded a normal text scheduler timing out in
`observe_policy_decision` while updating `policy_cohorts`. The logs establish
that contention boundary; they do not identify the blocking transaction's full
work or establish which individual account stalled because of it. The deployed
reviewer demonstrably locks those same rows through subsequent maintenance.

The forward migration separates synchronous canonical decision/application
pointers from optional hourly review cursors. The original table is renamed
`policy_cohort_sources`; review timestamps/errors move losslessly into
`policy_cohort_reviews`. The original private `policy_cohorts` name becomes a
security-invoker read view with the identical column order and values. Existing
service-role read access and private RLS boundaries remain. A source insert
initializes one cursor in the same transaction; an existing source update never
touches its cursor.

The reviewer keeps its advisory lock, twenty-cohort limit, hourly cadence,
six-hour source window, ordering, error receipts and four verified advancement
attempts. It locks only review cursor rows. Decision/application source writes
retain their original exact checks and synchronous durable pointers. The policy
advancement function is byte-identical. A decision committed during a review may
become the latest pointer immediately, while that review's saved evidence still
identifies its actual earlier snapshot. No cursor write overwrites that pointer.

This change removes review-to-source row contention. Canonical writes to the
same cohort still serialize, and unrelated scheduler/budget/provider limits
remain. It neither clears old operations nor proves zero stalled accounts.

## Verification and release

The migration pins five exact deployed definitions, refuses changed relations,
and acquires its schema lock with NOWAIT. The migration runner must own the
whole transaction, including its history receipt. Do not retry an ambiguous
installation or reinstall an acknowledged migration.

PGlite checks lossless migration and compatibility projection, outer transaction
rollback, original function access, unchanged promotion/hold logic, hourly
cadence, error diagnostics and repeat refusal. The PostgreSQL 17 fixture runs the
actual old and new observer, application trigger, hold function and reviewer.
It reproduces all three old foreground timeouts while a reviewer transaction
stays open; the repaired paths complete before that transaction commits. It
also checks concurrent-review suppression, source serialization, new-cohort
initialization, locked-cursor fairness and immediate atomic migration refusal.
All test accounts, decisions, releases and allocations are fictional.

Finish canonical exact-head checks, install the source-pinned migration once,
verify its exact functions, relation ACL/RLS, all original projection values and
unchanged policy definitions, then use the existing serialized release process.
There is no feature-policy activation or provider/configuration change. Observe
ordinary scheduler work and lock-timeout recurrence after the release; do not
invoke paid work or count a healthy heartbeat as account recovery.
