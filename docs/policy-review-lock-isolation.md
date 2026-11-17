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
An in-transaction comparison verifies every original pointer and diagnostic
against the new projection before the migration may commit.

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

## November 17 production installation

The hosted runner recorded `20261117190712_policy_review_lock_isolation`. All
seven canonical Reliability jobs passed on combined source
`8d4d3a22e6263f6e40a7b966a19d05551d28583f` in run `44150403777`. The combined
config and migration have SHA256 `c0b1375dd18964f354b7dc884a795284090ea16cb309141a9b371b8037a3adba`.
Five prior function definitions, their access rules, the original table,
columns, indexes, constraints and four cohorts matched the preinstall check.
The transaction compared every original row and diagnostic to the projection
under lock before commit.

Readback at 19:07 UTC verified one ledger statement with MD5
`817f9d2729474374f3cf5fe9a3a1b652`, four source and four review rows, the new
initialization trigger and a four-row security-invoker view. Both private
tables have RLS and the service role retains read-only access. All six expected
function hashes matched, including unchanged policy promotion. The later read
showed advanced decision and application pointers for one cohort. Its review
diagnostics and the other three rows matched the earlier observation.
