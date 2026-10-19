# Gate-only settlement policy and diagnostics

## Scope

The existing reconciler may settle otherwise-valid pending gate-only usage using verified carrier evidence, recorded costs and existing caps. This correction does not directly settle a row, rewrite already-settled usage, start a new call, or assume that a zero-duration completed call is free.

- Persist allowlisted hold reasons for missing or invalid carrier prices, invalid terminal evidence, missing reviewed costs, rejected settlement and invalid entry policy. Logs contain a fixed stage, recording ID and safe reason, not raw provider/RPC payloads or contact details.
- Keep legacy and typed pending-cost indicators compatible. A successful `gate_settled` action overrides a stale historical hold reason without rewriting audit history.
- Validate speech usage by immutable entry policy. Direct-recorded entry requires `speechGatherUsed=false`. Spoken entry follows the existing adapter condition: declined state or completed carrier status. Null and unknown policies fail closed.
- Preserve actual USD carrier price normalization, recorded overhead/multiplier, rate/cap identity, charge ceilings, lock ordering, immutable receipts and exact replay protections.

A historical generic hold does not prove a specific missing-price or speech-policy cause. The diagnostic change makes future checks distinguish those outcomes.

## Migration and rollout

`supabase/migrations/20261019193824_recording_gate_settlement_policy.sql` was generated with the official Supabase CLI 2.121.0 and matches `config/recording-gate-settlement-policy.sql` byte-for-byte. It replaces one exactly matched clause in the installed function, checks its security/return/language/search-path contract, and refuses unknown or duplicate source shapes. Unrelated concurrent body changes, grants and security settings survive.

Deploy the application diagnostics before applying the migration. Verify the function's prerequisite and expected definition change, then observe the existing reconciler and saved receipt. Do not force settlement, rewrite provider evidence, replay calls or run paid probes. Unexpected function shape or unverifiable carrier pricing must remain blocked.

## Offline verification

- 29 synthetic adapter/diagnostic cases and nine local real-SQL/ledger scenarios cover policy-specific speech, missing prices, canonical identity, cap enforcement, immutable receipts and exact replay.
- Guarded-patch checks cover prerequisite rejection, concurrent-change preservation and browser-role denial.
- Manual-call history tests cover old/new pending reasons and settled override.
- Adjacent recording maintenance, carrier-cost, final-clock and paid-test restrictions remain covered.
- Both new suites are in the local release gate and automatically discovered by the aggregate test runner.

The initial candidate passed all 502 aggregate suites, the complete release gate and TypeScript checks. Fresh-main integration preserves subsequent fairness, queue and seller-response changes; its final checks are recorded in the pull request and CI. PGlite is a serialized local database and does not establish real multi-session PostgreSQL concurrency or live carrier behavior.

## Existing standalone-run limitation

The optional standalone default `scripts/test-required-call-recording-pglite.mjs` runner fails identically on the unchanged initial baseline and candidate after 49 scenarios: a later HTTP fixture calls `icash_create_direct_recorded_call` without its prerequisite schema. That unrelated baseline fixture failure is not represented as a pass. The new targeted database suite installs the prerequisite and passes.
