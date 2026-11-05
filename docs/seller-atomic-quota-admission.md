# Prospective seller request admission

Initially prepared against main `71d0bf349dcef1f6db8cdd6d3c6a019976c000a7`,
then rebased onto `3a66400111d74baac28f2cefc3adbdd0e218ff2f` with the support
release preserved. Migration `20261105131617` was generated with Supabase CLI
3.0.0; its SQL exactly matches the configuration file.

The minute worker invokes ordinary seller intake and shared research refresh even
when neither has eligible work. Previously each took anonymous DealMachine quota
before attempting a claim. The candidate selects the exact eligible lead/source
under existing locks, then admits quota immediately before reserving money and
recording the new claim, in the same database transaction. Empty/ineligible work
takes no quota. Denial creates no new funded claim. An error after quota admission
rolls back both. Existing unknown-outcome maintenance and holds remain intact.

After source gates it acquires the quota relation and singleton row with NOWAIT.
Contended/missing quota returns admission_busy, mapped to rate_limited without
owner-demo fallback. The unchanged limiter then reacquires its already-held row;
there is no new quota-row wait after reading source/account gates. A later retry
runs those gates anew. Unexpected DDL on other limiter dependencies is outside
this normal row-contention proof and still requires controlled deployment.

Four new service-only RPCs preserve the original claim bodies and gates:
- `icash_claim_seller_lookup_admitted_for(uuid)` and its untargeted wrapper.
- `icash_claim_seller_research_refresh_admitted()`.
- `icash_meta_claim_lookup_admitted(uuid)`, preserving Meta's operating/source/
  account gates and transaction-local binding before calling the admitted claim.

The migration pins all three source bodies to independently read-only verified
production MD5 fingerprints from November 5, 2026 12:17:59 UTC. Existing entrypoints
and owner-demo exception are untouched. Only explicit quota denial may attempt
that exception. Idle or missing-version responses cannot trigger it. The fallback
address path retains its separate quota admission and original zero-cost receipt.

No quota counters, windows, 60/minute or 9,800/rolling-day limits, 980-request starter
reserve, financial balances, receipts or historical holds are rewritten. Admitted
ordinary requests remain anonymous, as before; no ledger attribution or credit
reconstruction is claimed. No provider requests or production writes were made.

## Offline verification

`node --experimental-strip-types tests/seller-atomic-quota-admission.test.mjs`
uses the exact seller/refresh/Meta claim bodies, the real reserve limiter body,
synthetic fixtures and a local PostgreSQL engine (PGlite). It covers idle/gate
rejection, successful single claims, denial without financial mutation, rollback
of post-admission failure, maintenance of old unknown holds, real ordinary reserve
and minute/day denials, provider cooldown, Meta routing and pause, private ACLs,
source-drift rejection, missing RPC and unexpected-result fail-closed behavior.
The complete reserve migration prerequisite guard has its own existing suite.

Existing seller refresh tests retain their full source/contact/funding/Pause and
receipt gates. Existing service tests cover seller/targeted/Meta routing, owner-demo
single-use/expiry/recovery, address fallback and unknown receipts. Owner-demo's 73
SQL scenarios and the full reserve suite remain unchanged and pass separately.

### Observed local results before rebase (November 5, 2026)

- Atomic admission: 22 database scenarios passed, plus fail-closed/busy routing.
- Eight affected seller/Meta/demo suites, including full refresh coverage, passed.
- Unchanged owner-demo allowance: 73 scenarios passed; unchanged reserve suite passed.
- TypeScript: `node node_modules/typescript/bin/tsc --noEmit --incremental false` passed.
- `git diff --check` passed.
- Broad suite: 167 alphabetical prefix suites passed, then the runner exposed an
  old-RPC mock in `dealmachine-address.test.mjs`. After updating that mock, the
  remaining 613 suites, starting again with that suite, passed. All 780 suites
  therefore have passing coverage across the initial and resumed runs; this was
  not one uninterrupted clean run. Affected suites were rerun after final edits.
- Native harness: Python syntax check only, never executed.
- Safe production build: default Turbopack failed because this isolated worktree's
  node_modules symlink leaves Turbopack's configured filesystem roots. The same
  package build chain with supported `next build --webpack` passed: compilation,
  TypeScript, all 128 static pages, optimization and build traces. No tracked
  config was changed for this fallback. It is not a default-Turbopack pass.
- Both build attempts used an empty allowlisted environment, a fresh temporary
  HOME, telemetry disabled, and `unshare --user --map-root-user --net`; the network
  namespace had no routes. Provider/configuration hooks reported not_requested,
  unconfigured or not_production; no secrets or real preflight were supplied.
- No live SQL, provider request, push, PR or deployment was performed.

## Release blockers and review needs

This is a release candidate. Production installation remains gated on exact-head
native/full checks, a fresh predecessor and migration-history readback, and
serialized release ownership. Publication alone does not prove deployment.
Native PostgreSQL binaries are not available here. PGlite does **not** prove
competing-session locks, native scheduling or deadlock freedom.

`scripts/test-seller-atomic-quota-postgres.py` runs in the dedicated
`seller-quota-contention` CI job against its own PostgreSQL 17.6 service at the
fixed disposable localhost database. It installs 13 hash-pinned actual predicate
bodies: website/demo/direct and network Meta contact lineage, authenticated Make
submission receipts, current identity, membership, credit/outreach/state/provider
gates and the complete refresh target. No always-true leaf eligibility stubs remain.
Only rows and table shapes are synthetic; unrelated signup/dispatch/settlement
triggers and the reserve migration's historical installation guard are omitted and
remain covered by their existing suites.

The same fixture passed offline validation with 149 rejection cases and six
successful/duplicate paths, actual quota denials, post-quota rollback, original
owner-demo one-use and private ACL checks. Native execution is still pending CI;
PGlite does not establish lock behavior. Native scenarios include simultaneous
seller/targeted/refresh/Meta claims, the last ordinary slot, immediate row/table
NOWAIT refusal without debit, fresh retries after Pause/source/expiry changes,
elapsed expiry, original control serialization, owner-demo competition and
post-admission failure rollback. Require exact-head native and full checks before
release, without increasing wait limits or running paid provider tests.

The new names require database-before-application rollout after authorization.
Missing RPCs fail closed, never fall back to separate claims. Old application
instances still burn idle admissions until replaced; do not claim fixed before
both web/worker versions and database definitions match. A web rollback can resume
the old waste but must not change counters. No activation was attempted.

Cloned bodies must be reviewed/rebased whenever a predecessor changes. Future
changes to seller/refresh/Meta eligibility must update the corresponding admitted
versions, not just old RPCs. Confirm exact predecessor hashes and current main/open
work again before release. Independent review is required; earlier review caught
and corrected a Meta adapter mismatch before publication.
