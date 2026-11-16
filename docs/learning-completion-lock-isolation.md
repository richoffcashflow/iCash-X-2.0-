# Learning completion lock isolation

Production PostgreSQL error contexts on November 16 identified foreground
`icash_claim_screening` and `icash_finish_screening` calls waiting on the learning
queue upsert inside `icash_learning_changed`. The current learning refresher
updates each account's queue immediately after its aggregate work, retaining
that row lock through later accounts and global operation review. The earlier
outcome-before-queue ordering fix did not prevent this cross-account delay.

The forward migration requires the exact current refresh definition, MD5
`62d7625004e807cd463088b173dbba5d`. It collects each success or failure in a local
array bounded by the original maximum of five accounts. After all aggregation,
operation review and bounded retention cleanup, it writes those same checkpoints
in account order. Each checkpoint retains the original generation check, success
or failure fields, hourly success and five-minute failure cadence. A notification
that commits during later work keeps its due time and incremented generation.

The source trigger and its synchronous durable notification, workspace revision,
screening claims/completions, aggregate functions, learning policies and financial
rules stay unchanged. No pending operation is settled, retried or hidden. An
actual statement timeout still stops the batch and retains earlier completed
aggregate output and the canceled account's error receipt. A blocked final
checkpoint retains the existing external statement/lock timeout behavior; no
timeout or exception is ignored to manufacture a success.

Global operation review now reads prior persisted account checkpoints while the
current refresh is still in flight. Its learning-health snapshot does not include
this run's not-yet-written account checkpoints. The final refresh receipt and due
count are calculated after those writes. This timing does not change outcome
labels, promotion gates or the actual refresh result.

## Verification

The PGlite regression executes the source-pinned migration and checks success,
ordinary failure, cancellation, new generations during later account/review work,
unchanged function rights, invalid bounds and predecessor drift refusal.

The PostgreSQL 17 test uses the original screening claim and current completion
RPC, source trigger and actual learning refresher over synthetic data. It proves
the old function times out both RPCs while a later account or operation-review
boundary waits on another transaction. With the migration, screening completes
before that refresh proceeds, and the new generation remains due. It also checks
original screening attempt receipts and real statement cancellation. Aggregate
computation and external operation-review bodies are isolated boundary fixtures;
the native test is a locking reproduction, not a production throughput estimate.

Apply `20261116031157_learning_completion_lock_isolation.sql` only after review and
canonical checks. The normal migration runner must own its transaction so a
ledger failure rolls back the function change. Verify the new exact function
definition and unchanged rights, then complete the matching release gates. No
feature activation, provider call or customer control change is required.
After deployment, observe ordinary screening completions and timeout recurrence;
this fix alone does not establish zero stalled accounts.
