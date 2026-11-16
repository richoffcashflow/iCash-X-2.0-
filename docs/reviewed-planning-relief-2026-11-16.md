# Reviewed planning commitments, November 16

The owner renewed the request to remove funded-account blocks. A private review found a bounded pool of 189 original dispatched operations across 37 accounts whose remaining planning quotes consumed the headroom for independent useful work. This release can waive **only the planning deduction** for a current, independently reviewed subset. It does not settle an original, report completed customer work, replay a provider request, grant wallet credits, release supplier reserves or change Pause.

The private pool is exact, not an age-based recurring policy. Its public SHA256 is `2684b0bdd601bf9a63b4a1cc45cde4cc582404fefa830e47cafd4711de6dc322`. Both original creation and dispatch must precede `2026-11-15T23:00:00Z`. The ceilings are 189 originals, 37 accounts, 27,207 customer quote cents and 122,405,040 original supplier reserve micros. Current handler/source checks may reduce this selection. Source identifiers, receipts and private manifests are not repository fixtures.

At the frozen affordability observation, the quote-only projection put all 37 above their then-current contact admission minimum; 27 also exceeded their search admission minimum. These are historical projections, not activation promises or completed work. Other accounts resumed ordinary paid work after the unrelated provider quota reset. This release does not extend relief to that changing population.

## Financial limits and retained uncertainty

The November 11 and November 13 manifests and policy branches remain unchanged. The new branch only returns zero planning cents when the policy is enabled, the operation belongs to the immutable **eligible activation subset**, and its complete original row still matches the stored snapshot. Only `estimate_checked_at`, an established polling timestamp, is omitted. Other changes restore the ordinary deduction for a still-pending original.

Actual provider cost and customer charging remain in the existing `icash_settle_operation` / `icash_finish_credit` path. Supplier reserves remain recorded until real settlement. Credit reservations are idempotent **usage authorizations**, not extra wallet holds. Late actual charging remains once-only; the existing shortfall coverage protects against negative customer balances. Actual overreserve can disable the operating budget, and the existing margin guard can pause the account.

This creates contingent platform liability if independent new work consumes wallet funds before an old charge arrives. The customer quote ceiling is not a lifetime provider-spending or supplier-loss ceiling. The supplier reserve is an estimate, not a maximum actual loss. The reviewed operating-budget record had `require_company_reserve=false`, zero recorded funding and existing spend/reserves. This release preserves that mode; it does not establish available company cash or introduce a new funded risk limit. Actual-overrun controls act after an actual cost is known. An HTTP error, expired lease or missing receipt is never treated as zero cost.

## Current source proof

The installed checker resolves operation kind from the original `rate_id`; the operation table has no kind column. Unsupported kinds fail closed. The dispatch must be older than 15 minutes, longer than the local 240-second original handler. Original paid activity and bounded free receipt recovery remain distinct.

| Kind | Required original evidence | Current exclusion |
| --- | --- | --- |
| Owner enrichment | Exact batch/item/account, admitted original batch request finished over ten minutes ago, original HTTP 400 `invalid_request` or explicit unknown with no saved original receipt | Active recovery lease; new completed export/CSV/parsed rows; changed original request, receipt or recovery evidence |
| Seller call | Exact job/account/key; completed held/complete tickets with expired windows; saved ended recording, or the reviewed no-recording held-admission/explicit unknown cases | Current ticket/tool/provider-handler window; unended or unexpected recording; active reconciliation/deletion lease; material source drift |
| SMS | Exact outgoing dispatching/needs-review original, expired completed ticket, no provider/event/delivery receipt | Current handler/ticket activity; any receipt attempt, changed provider identity or original message evidence |
| Property search | Exactly one same-account admitted paid request, finished unknown/error over ten minutes ago, no active/extra original request | New estimate/discovery source, unfinished request, changed receipt or binding |

The source snapshot retains original request/receipt content, export recovery/history, provider/call identity, ended-state evidence and original bindings. Only the enumerated scheduling/retry/lease fields are excluded from stable source identity. Recording state, recorded price and recovered artifacts remain material. Active leases are checked dynamically even though their tokens and expiry fields are not source identity. A busy free recovery may briefly refuse this operator transaction; it is neither disabled nor replaced.

Voice and message keys have exact prefix/UUID validation and use `id=parsed_uuid` to retain primary-key access. Request evidence is account-bound and uses the existing account index. No broad source-table lock or provider request is introduced.

## Installation and immutable lifecycle

`config/reviewed-planning-relief-20261116.sql` and its canonical migration are byte-identical. The migration runner owns the transaction, including its migration ledger insertion. The migration has no internal `BEGIN`/`COMMIT`, captures no customer rows and installs no enabled policy. It pins the existing planning/availability/credit/settlement definitions before extending the helper.

All three new tables have RLS. Application roles receive read access only; capture, activation, rollback and internal helper execution are denied to `service_role`, `anon`, `authenticated` and `PUBLIC`. Only a trusted database operator can execute the procedure. Source evidence belongs in private storage.

1. **Review:** pin the final canonical release and exact private pool. Select only originals for which the actual installed source checker returns independently reviewed current evidence.
2. **Stage:** `stage_pending_work_relief_20261116(pool, selected, final_main_sha)` verifies the literal pool digest, immutable original snapshots, selected source fingerprints, current controls, original usage authorizations and all ceilings. It writes the source/original evidence and a disabled immutable seal once. It never recaptures changing pending-account flags.
3. **Read back:** independently verify the exact selection, staged row count/sums, original/source hashes, policy fields and manifest hash. Do not activate an unexplained difference.
4. **Activate:** after the exact final canonical release is verified, `activate_pending_work_relief_20261116(manifest_sha256, final_main_sha)` rechecks source/operation/authorization/control evidence under locks. It records one immutable decision per staged original. Normally settled, changed or newly ineligible rows are excluded; the other proven originals can activate. The runtime helper requires an `eligible` decision, so an excluded original cannot join later. A zero-eligible activation is a terminal recorded decision with the policy disabled.
5. **Observe:** preserve the returned activation receipt and complete staged/decision readback. Compare actual later useful work and original settlement separately. A changed pending flag alone is not recovery evidence.
6. **Rollback:** `rollback_pending_work_relief_20261116(manifest_sha256, final_main_sha)` disables an already activated cohort permanently and retains every snapshot/decision. It cannot reenable. This function is for an activated cohort; an initially disabled unactivated policy is not a revocation receipt. To abandon an unactivated review, leave it disabled and do not call activation.

Staged rows, activation rows and policy evidence reject UPDATE/DELETE/TRUNCATE and later INSERT. Narrow locks on the three new private tables serialize in-flight direct inserts with their seals. INSERT guards require READ COMMITTED, including direct operator inserts, so a stale repeatable-read snapshot cannot bypass an already committed seal.

## Exact private input format

`pool` is an array of precisely these objects, covering the original entire fixed pool:

```json
[{"operation_key":"PRIVATE ORIGINAL KEY","account_id":"PRIVATE UUID","source_sha256":"SHA256 OF NORMALIZED ORIGINAL"}]
```

The pool hash is SHA256 of UTF8 lines `operation_key<TAB>account_id<TAB>source_sha256`, sorted by operation key using PostgreSQL `COLLATE "C"`, joined by newline with no final newline. The original hash is SHA256 of PostgreSQL JSONB text for `to_jsonb(original)-'estimate_checked_at'`; reserializing JSON in another runtime is not equivalent.

`selected` is a nonempty subset of exact pool keys, each with the SHA256 of the reviewed **current source** returned by the installed checker:

```json
[{"operation_key":"PRIVATE ORIGINAL KEY","idle_source_sha256":"SHA256 OF POSTGRESQL SOURCE JSONB TEXT"}]
```

Use `icash_reliability_private.relief_hash_20261116(jsonb)` to compute exact source/original hashes. Selection hash uses `key<TAB>source_hash` lines with the same ordering/encoding. The staged manifest hashes newline-joined `operation_key || operation_snapshot::text || source_snapshot::text`. The activation manifest hashes newline-joined `to_jsonb(decision)::text`. Never substitute a count-only ceiling for these exact identity checks or copy private values into public fixtures.

## Operator transaction and release gates

Use `SET LOCAL timezone='UTC'` for every preflight, capture, activation and fingerprint read: PostgreSQL JSONB timestamp text is timezone-sensitive, so another session timezone must not be allowed to reserialize the frozen proof. Do not stage or activate from an old long-lived transaction. Run each mutation as a separate short **READ COMMITTED** transaction with an outer `statement_timeout='8s'`, `lock_timeout='500ms'` and `idle_in_transaction_session_timeout='8s'`, followed immediately by `COMMIT`. A timeout, NOWAIT refusal, transport loss or false/partial readback is not success. After a lost acknowledgement, inspect the exact immutable seal/activation receipt before deciding whether another attempt is appropriate; never enlarge or rebase the selection.

The function's lock order is operating budget, DealMachine request-budget row, new private tables, then exact original/source parents, account/config, wallet and usage authorization. All contended proof locks use NOWAIT. The quota row fences canonical new request inserts; the operating-budget row fences estimates/new financial admission; exact parent/operation FK locks fence new source children. NOWAIT prevents waiting behind a receipt writer holding the reverse order. Original records are locked for current proof only, not updated. Final normal admission and current funding/Pause/contact controls remain authoritative for new work.

Before any stage/activation, the operator must save fresh proof of:

- Exact approved PR head/tree and merge ancestry on final `main`, successful required CI, and identical final canonical web/worker releases. A feature-branch head or merely green older ancestor is insufficient.
- The canonical migration hash, installed function definitions/owners/config/ACLs, all three tables' RLS/read-only application ACLs, the three SELECT policies and six exact immutable/seal triggers.
- Unchanged old policy/manifests, current operating mode, frozen pool digest, current original/source eligibility and selected quote/reserve ceilings.
- The current wallet/authorization/operation/control observations, kept separate from a later observation after ordinary concurrent work.

SQL source controls are a check at this transaction, not authority to override a later customer change. The offline/native tests prove that these functions themselves change only the three new private tables. Two independent before/after read-only observations cannot prove every live financial value stayed equal while ordinary customer work continued. For stronger same-transaction conservation evidence, take comparable fingerprints only after acquiring the same exact proof locks; use the bounded transaction and reject lock contention. Do not lock unrelated financial/source tables just to manufacture equality.

A successful stage receipt includes `manifestSha256`, account/operation counts and original quote/reserve sums, with `enabled=false`. Activation includes `recorded`, `eligibleOperations`, `excludedOperations`, `planningQuotesCents`, `reviewedMaximumPlanningQuotesCents` and `activationManifestSha256`. Save every exclusion reason (`original_missing`, `original_changed`, `controls_closed`, `authorization_changed`, `source_changed`) and the immutable current hashes. The activation subset cannot be expanded.

## Verification

`node tests/reviewed-planning-relief-20261116.test.mjs` executes the real saved reserve-operation chain, final prospecting guard, credit finalizer, settlement and margin functions. It covers exact pool/snapshot/cutoff/account/amount bounds, inactive install, migration-ledger rollback, old-manifest conservation, current controls, immutable activation subsets, legitimate peer settlement, rollback, actual supplier reserve-to-spend transfer, one-time customer/platform shortfall accounting and duplicate settlement.

`node tests/reviewed-planning-relief-source-20261116.test.mjs` executes the shipped per-kind source bodies against fictional evidence and the real operation-row shape. It covers original bindings, active windows, material provider/cost evidence changes, retry-only normalization and UUID-indexable source lookup. It does not contact providers.

`python3 scripts/test-reviewed-planning-relief-20261116-postgres.py` uses only a disposable localhost PostgreSQL fixture for lock races, competing stage/activation/admission, private seal insert races, stale snapshot refusal and late settlement. Its financial bodies are the captured actual functions; generic lifecycle tests explicitly substitute synthetic external source/control gates. Separate real source-lock cases exercise the shipped parent locks and corresponding FK insert fences. None of these tests proves real provider delivery or end-to-end customer recovery.

The native suite pins the literal psql client destination to `127.0.0.1:55443/icash_reliability`, the fixture user/password/application identity, and its supported native or container server port. It removes inherited libpq overrides, including `PGHOSTADDR` and service settings. Docker may report a bridge `inet_server_addr` for this loopback-mapped service; that server-side address is not the client destination. Offline transport regressions accept that mapping while rejecting remote client commands, changed ports, databases, users and environment overrides.
