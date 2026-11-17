# Collector preflight deadline planning

This is a planner-only change to `icash_work_private.live_owner_preflight_deadline(uuid,uuid)`. A nullable screening filter can make a cached generic plan scan an account's preflight history separately for each screening. Splitting the source into mutually exclusive null/non-null argument branches allows the non-null branch to use a matching account-and-primary-screening expression index.

All original filters, joins, deadlines, receipt/source checks, financial and provider-capacity predicates remain byte-for-byte unchanged after the source replacement. Neither the acquisition selector nor its ordering changes. Null screening still means the original account-wide scope. The non-unique partial index includes only waiting/ready rows and indexes the original text expression without adding a UUID cast.

## Guarded migration

`config/collector-preflight-deadline-plan.sql` and the CLI-generated `supabase/migrations/20261116202201_collector_preflight_deadline_plan.sql` are identical. The runner must own one transaction containing SQL and its migration-history insert; the file does not commit itself.

The migration:
- Requires the exact predecessor definition hash, postgres ownership, stable/security-definer/empty-search-path attributes and restricted server-role execution.
- Locks the existing operating budget and enabled continuation policy within bounded timeouts, checks the complete four-entry continued-original manifest against current definitions, and refuses drift.
- Acquires a table SHARE lock with NOWAIT so an existing writer rejects the migration rather than queuing behind it while holding the operating-budget row.
- Creates the index without `IF NOT EXISTS`, rejects an occupied name and verifies its relation, access method, key/expression, partial predicate and non-unique valid/ready shape.
- Replaces exactly one source clause, verifies the resulting body and unchanged catalog security attributes, and changes only this helper's existing manifest hash slot. Activation, release, turn counters, unrelated hashes and all other policy fields remain unchanged.

Index construction is ordinary transactional DDL with a bounded timeout. NOWAIT avoids existing writer contention, but later writers remain blocked until the runner commits. Its production lock/build cost and prompt schema-history commit still need reviewed release assessment; do not switch to CONCURRENTLY inside this atomic migration. This change does not collect observations, raise runtime timeouts, activate policy, mutate source states, settle holds, make provider requests or authorize production application.

## Tests and limits

`tests/collector-preflight-deadline-plan.test.mjs` exercises the exact helper body with fictional rows and simplified helper boundaries: 31 source/NULL/expiry edge cases, 100 positive mixed waiting/ready cases, null argument scope, unchanged saved evidence, server-role invocation, exact source/ACL/manifest drift rejection, wrong index shape/name, replay rejection and complete rollback after a history-write failure or unexpected policy mutation.

`tests/helpers/collector-deadline-fixture.mjs` exposes a portable fixture API for further native rehearsal. Its booleans/cohort helpers are deliberately not full source-admission validation. Missing or malformed source dates preserve PostgreSQL LEAST null behavior under those permissive helpers; a passing fixture is not proof that real source admission accepts them.

`tests/collector-selector-equivalence.test.mjs` additionally runs the captured real ranked selector/source chain on twelve fictional populated accounts plus 351 empty identities. Six token/fair-turn variants retain identical 363-row candidate/deadline JSON bytes and hashes in the same transaction, including eleven non-null candidates per vector and unchanged original evidence/money. This is a candidate-vector test, not the entire operational collector or its real fixed membership.

`scripts/test-collector-preflight-deadline-postgres.mjs` is registered in the existing PostgreSQL 17.6 outreach-preparation CI job. It checks those vectors and the complete synthetic collector, the internal forced-generic account-plus-primary-screening index path, rollback, NOWAIT rejection under an existing writer, and observed serialization of competing migrations with stale replay rejection. It accepts only the repository's fixed disposable loopback fixture, never an arbitrary database URL. Its native concurrent run remains pending until that exact-head CI job succeeds.

`tests/collector-complete-query.test.mjs` executes the unchanged full collector SELECT and `createObservation` on 363 fictional members within one repeatable-read transaction. It retains all evidence fields/order/timestamps, receipt identities, classifications and the complete observation hash. Four populated accounts include a real non-null candidate, paused/member-excluded cases and an eligible account without a current candidate; missing members remain present. Reporting-only columns and external eligibility/hour boundaries are fixtures, not the full installed production schema or authenticated-envelope transport. The original 20-second query limit remains unchanged.

A separate native PostgreSQL 17.11 single-backend experiment showed the intended generic-plan index path and equal outputs. It used the same forced-generic mode for predecessor, index-only and rewritten cases. This does not prove full-schema behavior, concurrent lock safety, actual collector completion or production improvement. Frozen dependencies installed successfully without lifecycle scripts; complete canonical CI and normal reviewed release controls remain required. No whole aggregate or production collection is implied by the focused tests.

The first native CI attempt exposed an unqualified fixture function after the migration correctly cleared search_path. Both calls now use `public.fid`; the failed attempt is retained, not counted as a native pass. A separate synthetic 12,611-row, approximately 25.8 MB heap experiment built the matching index in 32.221 ms on PostgreSQL 17.11. That is a local sizing observation, not a production latency or lock-duration guarantee.
