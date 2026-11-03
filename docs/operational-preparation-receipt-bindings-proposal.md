# Operational preparation: staged release candidate

This draft proposal was originally isolated from PR #545 on main `b16925a2b2bd5e65024d6a4ae9d8718dde567f1a` and is now reconciled without overlapping file edits onto `4ad72f76a68e4e12e33cfc16d8f1223640989813` after #545/#546 merged. Nothing here has been applied to production. It does not change the voice issuer, provider requests, account funding, consent, Pause, holds, quota counters, or recovery flags. No migration-ledger entry has been created. Three ordered local migration files were generated with Supabase CLI 3.0.0; none is installed. They are concurrent phone index (20261103211342), concurrent national index (20261103214105), then the function-only patch (20261103214109).

## Evidence

On November 3, 2026, PostgreSQL reported preparation statement timeouts at 19:25:51 and 19:26:13 UTC in `icash_prepare_operational_contacts_before_dm_observations`. The latter stack reached `icash_operational_phone`. Three receipt-finish attempts around 19:26:10–11 timed out waiting for the singleton operating-budget row.

The queue function takes its existing advisory and operating-budget locks before preparation. That structure explains how slow preparation can delay receipt settlement. The historical blocker PID was not captured, so attributing each receipt timeout to that exact scheduler transaction remains an inference.

A read-only aggregate at 20:01:45 UTC found 11,391 initially eligible saved owner sources containing 39,890 phone entries. A separate read found 15,407 national-provider DNC receipts, of which 2,932 were clear, unrevoked, and current. There were no legacy receipts at that time. The original final LIMIT 100 does not bound that preceding global phone expansion.

PR #545 changes urgent/legacy/ordinary voice selection and seller-copy validation. Its reviewed head `6d5c21bde367fa73696e46477a3a881db561710f` does not modify this preparation helper. Its exact-head CI passed, but it remained open at 20:11 UTC. Do not compete with that active release.

## Proposed change

`config/operational-preparation-receipt-bindings.sql` splits candidate construction into two disjoint branches:

1. National-provider observations join their exact account, screening, operation, saved result hash, and existing ingestion binding before phone-source validation.
2. Legacy receipts retain the original phone-expansion selector, with only a legacy-kind filter added.

Both branches feed the byte-identical original full proof, DISTINCT, ordering, and final LIMIT. The unchanged source-phone proof necessarily establishes the phone membership formerly checked by the national branch's initial JSON expansion. Duplicate JSON phone entries do not change the final distinct result. The added ingestion join is already required by the unchanged final proof and cannot multiply rows because screening ID is unique.

The insertion loop, private ACLs, current-contact validator, and lock order remain unchanged. Tests compare complete receipt and budget rows and queue/entrypoint definitions, not only counts. Exact predecessor hashes guard both the preparation function and the source-phone proof. Two partial indexes support the phone lookup and the national screening binding; all original receipt predicates still run.

## Local verification

Run the focused tests without any provider or production connection:

```sh
node --experimental-strip-types tests/operational-preparation-receipt-bindings.test.mjs
node --experimental-strip-types tests/operational-preparation-candidate-fence.test.mjs
```

Both passed on the final proposal. The hostile equivalence cases also ran with both proposed indexes present. Coverage includes account/global equality, cold and fully projected sources, missing channels, Pause, changed ownership, rights expiry, source disablement, revoked receipts, suppression, changed costs/rates, reserved operations, 600 foreign bindings, 105 invalid proofs, 105 correctly bound receipt phones absent from the source, ten malformed-source cases, and mixed legacy/national ordering. It checks that only the selector changes, wallets and operation counts stay unchanged, both indexes are ready/valid, private function ACLs remain private, and reapplication fails closed.

The optional benchmark is separate from the default test budget:

```sh
PREPARATION_PERFORMANCE_TEST=1 node --experimental-strip-types tests/operational-preparation-receipt-bindings.test.mjs
```

The final PGlite diagnostic compared the same indexes on both selectors. Three paired runs alternated the query order. The indexed columns below are their medians; the unindexed baseline is one diagnostic observation:

| Synthetic workload | Original, no new indexes | Original, both indexes | Receipt-first, both indexes |
| --- | ---: | ---: | ---: |
| One source, 15,000 unrelated receipts | 499 ms | 6.0 ms | 5.7 ms |
| 3,000 fully projected sources, 12,000 phone entries | 1,873 ms | 1,658 ms | 808 ms |

Thus indexes alone solve the sparse fixture. The rewritten query's measured additional benefit is avoiding expansion of already projected sources in the warm fixture. This does not measure throughput for thousands of newly eligible contacts. Both indexed plans returned the exact original result, including under the hostile cases.
These are local diagnostic observations, not production latency guarantees. An earlier materialize-all-source/hash/phone experiment was rejected: it still performed the broad scan and regressed under some plans. Index use alone was not treated as proof of improvement.

## Remaining risks and release gates

- This reduces unnecessary work; it is **not a strict bound on execution or budget-lock duration**. Source/receipt populations, legacy expansion, receipt fanout, and final proof work can still grow.
- Correctly source-bound receipts with absent phones now enter candidate materialization before the final source-phone proof. They remain rejected before LIMIT, but may perform additional proof work. The hostile fixture verifies rejection, not a universal time bound.
- A separate `preparation-contention.yml` workflow runs the full equivalence/hostile/performance suite against disposable PostgreSQL 17.6, with generic and custom prepared plans and real two-session queue/budget/Pause/revocation races. Its adapter permits only a fixed localhost port and an empty dedicated test database; no production environment is read. Native execution and all five exact-head jobs passed for the initial proposal `72f04514` (combined tree `6e8360cc`); the staged-installation revision requires fresh CI. PGlite alone cannot prove inter-session progress, and no native binaries/container runtime were available locally.
- The initial combined ordinary-index transaction was removed. Two standalone concurrent index stages precede the short function-only migration. Concurrent builds avoid excluding ordinary writers, but consume CPU/I/O, wait for older transactions, and may leave an invalid index on failure. They do not establish a runtime guarantee. See the release procedure below.
- Do not install or deploy while overlapping repairs are landing. Once main stabilizes, rebase, review the exact combined tree, recheck live predecessor hashes and indexes, verify the CLI-generated migration and its prerequisites, and run full CI plus native generic-plan/contention/installation tests.
- After an authorized installation/release, verify actual matching production versions, scheduler completion, original receipt settlements, waiters, and tail latency. Do not use paid development requests or reset quota to demonstrate progress.

If a strict work bound is required after measured optimization, use a separately designed fair continuation with durable source/receipt progress and a bounded per-invocation budget. It must handle new receipts on older sources, both channels, invalid sources, rollback/timeout fairness, and source/receipt fanout without moving or dropping existing admission locks. A source-row LIMIT alone does not establish that bound.

Reference: [Supabase query optimization](https://supabase.com/docs/guides/database/query-optimization) and [index creation behavior](https://supabase.com/docs/guides/database/postgres/indexes).

## Native measurements

The PostgreSQL 17.6 job for `72f04514` passed at 20:28 UTC on November 3. With both indexes on both selectors, three interleaved custom-plan runs gave medians of **597.0 ms original versus 318.2 ms receipt-first** for 3,000 already projected sources / 12,000 phone entries. Sparse medians were **2.05 ms versus 2.31 ms**. This shows additional warm-scan improvement, not a universal improvement or receipt-finisher throughput result. Generic/custom prepared SELECTs were equivalent. The exact-head existing native contention, full suite, build/browser/concurrency, and audit jobs also passed.

- [Native run](https://github.com/richoffcashflow/iCash-X-2.0-/actions/runs/41712760817)
- [Reliability run](https://github.com/richoffcashflow/iCash-X-2.0-/actions/runs/41712760832)
- [Complete plans and timings](https://github.com/richoffcashflow/iCash-X-2.0-/actions/runs/41712760817/artifacts/13268571437)

These results predate the staged-installation revision; do not use them to authorize a changed head.

## Staged installation and release procedure

**Hold production action until the exact final head and combined tree pass CI, other active repairs are reconciled, and the production execution route is verified.** No script here automatically connects to production or changes migration history.

1. Read back exact main/PR heads and current live function/helper hashes, owners, private ACLs, security mode, search path, queue/current-validator definitions, migration history, both proposed index names, equivalent indexes, and active `pg_stat_progress_create_index` rows. The observed production engine is PostgreSQL 17.6. At 20:45 UTC both proposed names were absent, no receipt index build was active, predecessor hashes matched, and latest migration was `20261103192046`. That is a timestamped observation, not permission to skip fresh readback. Stop on drift, concurrent owner activity, or uncertain execution. Coordinate one deployment owner through final verification: catalog/hash checks are not protection against another concurrent schema writer.
2. Verify the pinned Supabase CLI 3.0.0 production runner and direct/session connection. Establish bounded connection startup settings (for example `lock_timeout=5s`, `statement_timeout=60s`) and observable session identity using a tested mechanism; do not assume shell environment or pooled session settings are honored. The CLI may override the requested application_name, so bind monitoring to its verified actual label and backend PID rather than assuming a URI label survives. The production route and these settings must be verified before approval to run. Do not acquire scheduler/budget locks or disable admission controls.
3. Compare the full repository migration history with production and prove that the **only pending versions** are `20261103211342`, `20261103214105`, and `20261103214109`, in that order. Both index files start with the CLI's explicit `-- pg-delta: transaction=false` directive. Use the native-tested CLI three-stage migration path, which runs each concurrent build standalone and records its own exact version before proceeding. Do not manually run the config copies first, use GitHub Branching, wrap CREATE in BEGIN/DO/RPC, or switch to an unverified MCP runner.
4. A failure or uncertain result stops release. Inspect index progress, exact definitions/readiness, function definition and all three ledger versions before retrying. The final function migration deliberately refuses missing, wrong, invalid, unready or nonlive indexes. No automatic ordinary-index fallback, silent same-name acceptance, or ledger repair is permitted. Independently staged/preexisting objects require a separately reviewed reconciliation plan.
5. The third migration, `20261103214109_operational_preparation_receipt_bindings.sql`, is byte-identical to its config, contains no index build, takes no operating-budget lock, and does not execute preparation. Its 2-second lock and 10-second statement limits restrict this installation attempt, not future scheduler work. The single atomic DO checks exact predecessor function/helper hashes, both index definitions and catalog readiness, then verifies the complete replacement plus unchanged function OID, owner, ACL, security mode, and configuration. Any failure rolls back the function change. It has no explicit outer BEGIN/COMMIT, allowing the CLI to commit the patch and migration-ledger entry in its own transaction. SET LOCAL precedes DO inside the runner-owned transaction, so the statement deadline is installed before the function patch starts. Direct use must provide the same caller-owned transaction.
6. Verify installed SQL/version, exact patched function and preserved metadata, matching application release SHAs, ordinary scheduler completions, original receipt settlements, lock waiters, and measured tail latency. No paid development requests, outreach replays, quota reset, hold clearing, or flag toggles are part of this procedure. An exhausted request window remains a separate constraint.

### Runner and migration-history constraints

The three migration files include both concurrent index stages followed by the function-only patch. They are byte-identical to their config counterparts. The two index files carry the explicit first-line `-- pg-delta: transaction=false` directive supported by the pinned runner. Use only the pinned Supabase CLI 3.0.0 runner after native verification of this exact three-stage chain and ledger contents. Supabase GitHub Branching wraps migrations transactionally and ignores the nontransactional directive, so that runner is not supported for this release. The MCP migration tool's execution guarantees for concurrent builds have not been established. Never substitute an ordinary-index build or apply the files through an unverified transactional runner.

The native test reconstructs the captured predecessor schema, replays these three migrations through the actual pinned CLI against fixed localhost, verifies the ledger and postconditions, and reruns to prove no replay. It does not claim a complete historical migration reset has been executed. Fresh restore and production must use a supported standalone runner for these index migrations. If either was separately staged outside the migration runner, stop and reconcile its exact definition and migration history rather than replaying CREATE or marking a version applied blindly.

No production autocommit route has been verified in this task. A SQL-editor UI is not proof that the connected MCP migration tool uses the same protocol. Do not perform a live trial just to discover its transaction behavior. The production runner requires existing authorized access; no credentials are introduced or printed by these tests.

### Failure and rollback

- If either index build fails, stop before the function migration and inspect `pg_stat_progress_create_index`, relation identity, exact definition, and `indisvalid`/`indisready`/`indislive`. PostgreSQL may retain an invalid index that still adds write overhead.
- Cleanup is a separately reviewed standalone `DROP INDEX CONCURRENTLY` of only the exact newly created failed index after confirming no build is still active. Never drop a preexisting or unexpected same-name object. Retry only after the cause is understood and cleanup verified; there is no automatic retry or `IF NOT EXISTS` path.
- If the function transaction fails, its change rolls back while healthy staged indexes remain. Keep them for inspection; failure does not justify dropping healthy indexes.
- For a measured regression after the swap, restore the captured original full definition only after the live function exactly matches the expected patched definition and metadata. Require a reviewed guarded rollback; never replace a newer repair by copying a stale function. Index removal is a separate cleanup decision and is unnecessary for function rollback.

### Installation tests

The staged revision adds disposable-native tests using the actual standalone index statements and guarded patch, plus a pinned CLI three-stage replay. A fixture event trigger checks exact lock/statement timeout durations on actual index-build sessions and records their application_name, including a runner-overridden label. A deliberate third-ledger-insert failure must roll back the function patch while preserving the two previously committed index stages, followed by a successful retry and no-op rerun. They cover missing and wrong-definition index refusal, cancellation leaving an exact-but-invalid index, rejected blind retry, a real receipt INSERT completing while the concurrent build waits on an older writer, sequential successful builds, unchanged original function/receipts/budget/wallets during staging/failure, and transactional patch rollback. These are installation and serialization checks, not production latency guarantees. PGlite covers missing/wrong-index guards and exact migration mirroring; native execution is required for concurrent-build evidence.

Official references: [PostgreSQL 17 CREATE INDEX](https://www.postgresql.org/docs/17/sql-createindex.html), [DROP INDEX](https://www.postgresql.org/docs/17/sql-dropindex.html), [Supabase CLI workflow](https://supabase.com/docs/guides/local-development/cli-workflows#cleaning-up-generated-migrations), and [Supabase GitHub Branching migrations](https://supabase.com/docs/guides/deployment/branching/github-integration#migrations).
