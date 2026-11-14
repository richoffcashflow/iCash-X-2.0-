# Original export recovery quota accounting

The ordinary recovery claim previously incremented `recovery_attempts` before
the service requested provider quota. Six local quota refusals could exhaust
recovery without sending an original-export GET.

This migration installs disabled. After activation, the ordinary claim locks
the shared request budget before the export, admits a fresh request, and only
then increments its existing counter and issues its existing 90-second lease.
A quota refusal retains its request receipt and schedules the next check ten
minutes later without consuming a recovery attempt or issuing a lease.

The historical continuation applies only to an incomplete original export
whose six recorded attempts are exactly six never-admitted `quota_wait`
requests. The batch must be younger than 29 days, inside the existing 30-day
request-retention window. Original batch, export, account, request, receipt,
and request-history identities are hashed and retained. No historical counter
is reduced. Other exhausted or uncertain histories remain ineligible.

Historical continuations have at most six admitted original-ID GETs. Every
successor requires a known finished request and exactly one recovery receipt
bound to that request and its lease. Successors are limited to matching
queued/pending/processing/completed responses, HTTP 429, or HTTP 5xx.
Missing, unknown, conflicting, malformed,
or unrelated evidence stops further provider reads. Quota refusals have no
attempt ordinal. Existing CSV recovery, artifact validation, allocation, save,
and financial settlement remain authoritative. No export POST is replayed.

The service accepts the atomic lane only with its explicit marker and valid
admitted request UUID. It does not take another quota allowance. A lost response
records that exact request as unknown; no fallback transport retry follows.

## Installation and activation

1. Apply `20261114212744_owner_export_quota_continuation.sql` before deploying
   service code that calls its fallback RPC. The file has no nested transaction
   boundary: the supported migration operation owns the atomic SQL-and-ledger
   transaction. Installation verifies the exact
   existing claim, request-admission, finish, receipt, artifact, and pruning
   functions. A mismatch aborts the transaction; inspect the new predecessor
   and rerun the native fixture instead of weakening the guard.
2. Publish and verify the same full commit on every production web and worker
   process, drain superseded handlers, and let outstanding legacy recovery
   leases finish or expire. Complete exact-head CI, including the native
   concurrency fixture. Activation refuses a still-live legacy provider lease.
3. Recheck the private disabled policy and prerequisite hashes, then invoke
   `icash_research_private.activate_owner_export_quota_recovery` as the database
   administrator with that verified 40-character commit. The function validates
   all captured dependencies and records the first activation. Application roles
   cannot activate or alter the policy or evidence tables.
4. Observe normal scheduled maintenance. Verify admissions, bound receipts,
   saved artifacts, and existing settlement before calling an export recovered.
   There is no manual provider retry, ledger reset, financial release, or new
   purchase in this rollout.

To disable, lock `public.icash_dealmachine_request_budget` row 1 and update the
private policy's `enabled` field to false in the same administrator transaction.
Admission rechecks the policy after that shared lock. An already admitted
request may finish; disabling does not revoke its receipt-writing lease.
Previously admitted atomic batches cannot fall back to legacy provider retries
while disabled. Saved CSVs can still complete through existing local recovery.
An activated and then disabled policy cannot be reactivated by the activation
function; a new reviewed change is required.

## Offline verification

`tests/owner-export-quota-recovery.test.mjs` exercises both atomic RPC origins,
strict admission contracts, original-ID GET/download behavior, and lost-response
holds. `scripts/test-owner-export-quota-postgres.py` uses disposable native
PostgreSQL to reproduce the old starvation bug, prove quota deferrals preserve
counters, race 24 claimants, verify the six admitted-request bound, test uncertain
receipts and activation/rollback, and check retained proofs and private grants.
These tests make no external provider calls.

Installed at 21:27:44 UTC on November 14, 2026 as `20261114212744_owner_export_quota_continuation`. Readback at 21:27:55 UTC confirmed disabled policy, null release/activation fields, zero continuation/request journal rows, all 15 dependency hashes matched, and service-only public RPC execution. The activation hash is `275056ddeee3dff92a5e5bbd3bffb6a2`; installed SQL SHA-256 remains `36e35da13bd303b672ebe5aaa25802d0a5017ef2501347d0e2d0cbf06b6e40b4`. Do not reapply. Exact-release verification, superseded-handler drain and guarded activation remain pending.
