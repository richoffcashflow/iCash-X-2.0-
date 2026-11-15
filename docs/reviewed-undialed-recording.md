# Reviewed original undialed recording recovery

This release adds an inactive, operator-triggered recovery for one positively proved original handler failure. It adds no scheduler path and does not retry a call, grant contact authority, erase a quarantine, or settle historical holds from their age/status.

## Proof and scope

The reviewed original has an exact recording-bound runtime log with `stage=dial_claim`, `holdSaved=false`, and `provider_or_database_outcome_unknown`. The log's deployment identifies the exact Git source. In that source, stage changes to `dial` before the sole provider call, and a successful database dial claim is mandatory first. Every historical version of this service preserves that requirement. The original recording has a complete append-only event history containing only creation and reconciliation housekeeping; its immutable dial claim was never acquired.

The original recording, job, operation, ticket, quarantine and raw log/source artifacts remain private. No production identifiers or review rows ship in this repository. The other unclaimed recording without an exact original log, the admission-held originals without a synchronous attestation, and any recording with a dial claim are excluded.

## Database authority

`config/reviewed-undialed-recording.sql` creates three private tables:

- `undialed_reviews`: append-only operator proof binding exact original identities, dispatch time, source log/deployment/commit hashes, original snapshots, a complete immutable event prefix, unchanged quarantine, and exact current database function definitions.
- `undialed_activations`: a disabled-by-default, per-review activation bound to the verified release SHA and finite expiry.
- `undialed_receipts`: append-only execution evidence binding the review, exact original, final event version and pre-finalization history hash.

The service role can execute the finalizer but cannot insert or alter a review, activation or receipt. Anonymous and authenticated roles cannot execute it. Installation creates no reviews or activations and performs no financial change.

Reconciliation-only row versions, leases, attempts, retry diagnostics and scheduling may advance after review. The reviewed event prefix must still hash identically, the entire current history must remain complete and contiguous, and every additional event must be an allowlisted reconciliation action in the original consent-pending state. Every provider/claim/binding field remains part of the exact snapshot or an explicit null check. Operation receipt-check timestamps are excluded from snapshot hashing; financial fields are not.

## Final transaction and concurrency

Before the single finalizer SELECT, the operator must set the **outer statement timeout** to eight seconds and a finite transaction/lock deadline. Function-local `statement_timeout` does not reliably bound an already-started outer statement, so this implementation does not claim otherwise. The function uses a 500ms lock timeout, fail-fast evidence-table and original-row locks, and a fresh activation/elapsed-clock check immediately before its first mutation.

Submit one isolated transaction containing only:

1. `BEGIN ISOLATION LEVEL READ COMMITTED; SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='500ms'; SET LOCAL idle_in_transaction_session_timeout='8s';`
2. A `DO` block that calls the exact `icash_finish_reviewed_undialed_recording(review, account, operation, verified_release_sha)` and raises an exception if the result is distinct from true.
3. Immediate `COMMIT` in the same submitted transaction. The raised refusal or any lock/timeout error aborts it and retains all original holds. The idle deadline releases locks if the submitting connection stops before commit; statement timeout alone would not do that.

The finalizer rejects any other isolation level: an older repeatable-read snapshot could miss recently committed evidence. It takes fail-fast SHARE locks on evidence tables, then budget, operation, recording, job, tickets, wallet and original reservation locks. The wallet-before-reservation order matches the real credit layer. An existing writer or original lock holder causes a bounded refusal. This exceptional locking exists only inside this operator-triggered recovery.

The serialization guarantee is precise: evidence committed before the finalizer obtains its evidence locks is visible and refused. An evidence writer that starts after those locks must wait until the transaction ends. Such a later receipt is retained, is not called prior evidence, and makes subsequent finalizer calls refuse to reassert success. The original execution proof remains immutable; later contrary evidence requires ordinary reconciliation rather than being discarded or automatically debited.

Under final locks, the function rejects active leases/tickets; any provider claim, SID, recording, conversation, receipt, cost observation, manifest, supplier cost, usage debit/coverage or conflicting original; altered reviewed snapshots; incomplete history; changed database semantics; invalid reservation binding; negative wallet balance; and nonzero legacy wallet reservations.

## Financial effect

The wrapper reuses the unchanged `icash_settle_operation(operation,0,0,evidence)` and actual `icash_finish_credit` functions. It permanently closes the never-dialed recording in the same transaction, releases the exact unused reservation once, preserves wallet balance and supplier spent amount, and writes no usage charge, coverage grant, provider-cost manifest, fabricated invoice, or complete-cost classification. Its zero result follows the existing pre-provider abort accounting policy; `cost_basis` is not rewritten.

The original capacity quarantine and expired ticket remain unchanged. Existing account-margin behavior is preserved, including retaining or applying an account pause when the existing margin function requires it. During the valid activation window, a completed exact execution is idempotent only while its original evidence, final event and zero ledger result still agree.

## Release and verification

Install inactive after independent review and the exact six canonical CI checks. Verify the installed SQL/hash/ACLs and exact production release before staging the single reviewed original's private proof and short activation. Existing owner authorization covers that operator work; this adds no customer or routine human-approval flow.

The native PostgreSQL 17.6 suite is registered in the canonical database-contention job. It uses the real immutable recording guard/audit/dial transition, captured credit finalizer and unchanged settlement ledger. It tests wrong/missing/inactive proof, binding and financial refusals, history drift versus harmless housekeeping, schema/ACL drift, 24 competing finalizers, late claim and cost evidence on both sides of finalization, exact idempotency, original Pause/quarantine preservation, and atomic rollback after ledger completion. All evidence and transports are synthetic; it makes no provider requests.

A single reviewed operation's recovery does not establish zero pending accounts or resolve the separate historical backlog.
