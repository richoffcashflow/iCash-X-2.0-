# Operational preparation: local proposal, not a release

This draft proposal is isolated from PR #545 and based on main `b16925a2b2bd5e65024d6a4ae9d8718dde567f1a`. Nothing here has been applied to production. It does not change the voice issuer, provider requests, account funding, consent, Pause, holds, quota counters, or recovery flags. No migration-ledger entry has been created.

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
- A separate `preparation-contention.yml` workflow runs the full equivalence/hostile/performance suite against disposable PostgreSQL 17.6, with generic and custom prepared plans and real two-session queue/budget/Pause/revocation races. Its adapter permits only a fixed localhost port and an empty dedicated test database; no production environment is read. Native execution and full exact-head CI remain pending. PGlite alone cannot prove inter-session progress, and no native binaries/container runtime were available locally.
- The proposed nonconcurrent index builds can block receipt writes. The 5-second lock timeout and 30-second per-statement timeout abort on failure but do not eliminate a temporary write pause; write locks last through both builds and until transaction commit, not merely one statement. Choose and review the installation method before generating a migration; a concurrent build requires a separate nontransactional plan and index-validity reconciliation.
- Do not install or deploy while overlapping repairs are landing. Once main stabilizes, rebase, review the exact combined tree, recheck live predecessor hashes and indexes, generate migration filenames through the supported CLI, and run full CI plus native generic-plan/contention tests.
- After an authorized installation/release, verify actual matching production versions, scheduler completion, original receipt settlements, waiters, and tail latency. Do not use paid development requests or reset quota to demonstrate progress.

If a strict work bound is required after measured optimization, use a separately designed fair continuation with durable source/receipt progress and a bounded per-invocation budget. It must handle new receipts on older sources, both channels, invalid sources, rollback/timeout fairness, and source/receipt fanout without moving or dropping existing admission locks. A source-row LIMIT alone does not establish that bound.

Reference: [Supabase query optimization](https://supabase.com/docs/guides/database/query-optimization) and [index creation behavior](https://supabase.com/docs/guides/database/postgres/indexes).
