# Funded account recovery — November 13

The owner requested fixing stalled and delayed accounts. The initial production audit found 119 affected active funded accounts: 80 lacked enough available planning capacity because original unresolved work still counted against new work, and 39 had no recent completed work. Healthy workers alone did not establish recovery. Ordinary research was progressing under the existing shared request allowance and pacing policy; no allowance increase is part of this repair.

## Reviewed backlog

The separately named November 13 relief tables capture only currently observed `pending_work` accounts and still-counted operations created before November 13 at 12:58 UTC. Installation rejects a cohort above 80 accounts, 293 operations, 48,842 customer quote cents or 233,494,200 supplier reserve micros. The previous November 11 manifest and activation remain unchanged. Installation is disabled until the exact production release is verified.

Activation requires the frozen manifest and verified full release SHA under the existing operating-budget lock. It removes the extra planning deduction only while the complete original operation snapshot still matches, excluding its polling timestamp. The actual wallet, credit authorizations, supplier reserve, operation state and settlement history remain unchanged. A changed original operation resumes counting; new work counts normally. Actual late costs still settle once. This is a one-time bounded backlog repair, not recurring expiration, zero-cost settlement, a credit grant or replay permission.

Installed inactive on November 13 at 1:39 PM UTC: 80 accounts, 293 operations, 48,468 quote cents and 231,451,800 supplier reserve micros; manifest `b3c9289591d59228796663c02a6cb8eb`. Recorded migration versions are `20261113133933` and `20261113133939`. Readback confirmed the original manifest/activation were unchanged and ordinary service access cannot activate or modify the new manifest.

## Rejected call admission

The recording service previously returned `recording_admission_held` after a completed null database admission without identifying that the current handler had stopped before dialing. Its original reserved quote consequently remained unresolved. The service now marks this explicit rejection. The existing atomic abort RPC accepts only that exact reason/boundary pair, the original live consumed ticket and current dispatch identity. It retains all no-recording, no-provider-evidence, source, expiry, competing-handler and once-only settlement guards.

A thrown or lost admission response never receives the marker. An existing or conflicting recording, late provider evidence, completed/expired handler or historical missing receipt cannot use it. No old call is retroactively settled from absence of a recording.

## Verification and rollout

Offline PGlite tests execute the actual admission, planning and settlement functions. Native PostgreSQL 17.6 tests cover 24 competing aborts, both orders of a real create/abort race, late evidence, 16 competing relief activations/final admissions and eight duplicate late settlements. Dispatcher/service tests cover an explicit rejection, a lost response and missing/invalid markers. No paid provider tests are run.

1. Install both guarded migrations; read back their function definitions, private ACLs and the disabled frozen manifest.
2. Complete canonical Reliability checks on the exact PR head and exact merged main commit. Verify the Vercel production target/alias and affected Railway services.
3. Activate only `activate_pending_work_relief_20261113` with its exact manifest and that verified release SHA.
4. Observe ordinary production receipts, account progress, remaining holds and new abort receipts. Report actual progress separately from available capacity. These changes do not establish that every account has completed work or that missing supplier receipts are resolved.
