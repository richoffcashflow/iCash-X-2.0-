# Reviewed pending-work planning relief

The owner asked on November 11, 2026 to “remove the holds and get it to work.” The read-only audit found 117 funded accounts blocked by 807 unfinished older operations with $1,502.45 in maximum customer quotes and $800.253880 in supplier cost reserves. Their wallets were not actually debited for those quotes. The planner subtracted the quotes indefinitely, preventing independent new work.

This release removes the planning deduction for that bounded historical cohort. It does not declare an unknown call or purchase completed, cancel a supplier obligation, refund a charge, grant funds, or replay an original request. Existing provider receipt reconciliation and once-only actual usage billing remain unchanged. Late receipts can still reduce the customer's actual remaining balance; existing platform overrun coverage still prevents customer debt.

The migration freezes full operation snapshots for currently observed `pending_work` accounts and operations created before November 11, 00:00 UTC. It enforces the reviewed account, operation, quote and supplier-reserve ceilings. It installs disabled. No customer identifiers or private provider receipts are committed to the repository.

Only exact snapshot matches receive planning relief after activation. The routine `estimate_checked_at` timestamp is excluded because checking for a receipt is not new spending. Every other original binding must still match. A changed amount, identity, state or permission immediately restores the planning deduction. Settled operations continue through ordinary actual usage accounting. Unreviewed and newly admitted pending work counts in full, under the existing serialized final-admission guard and actual wallet balance. The daily goal remains 50%, its minimum remains 30%, and reported raw pending quotes remain visible alongside separate planning amounts.

The private manifest and activation record have RLS and service-role read access only. Ordinary application roles cannot mutate the manifest or activate relief. The operator-only activation function takes the exact manifest and verified full release SHA under the existing global operating-budget lock. An exact retry is idempotent; another release cannot overwrite its receipt. There is no automatic cohort expansion or periodic expiration of uncertain work.

## Release and verification

Run the offline regression and native concurrency suite, review the exact diff, and require all canonical Reliability checks. Install the migration inactive and verify the frozen manifest, ceilings, unchanged original function hashes and unchanged financial records. After the exact main checks and applicable deployment verification, activate the reviewed manifest once. The database-only behavior does not require a web or worker configuration change. Verify ordinary production work and remaining hold reasons through read-only observations; no paid development demonstration is authorized.

The local suite covers inactive installation, unchanged records/reserves, snapshot mismatches, fresh commitments, real final admission, Pause, zero balance and duplicate late receipts. The native PostgreSQL suite verifies sixteen competing activation calls, sixteen competing final admissions, and eight simultaneous original receipt settlements. External permission predicates in the fixture are explicit inputs; these tests do not claim a live provider connection.

For rollback, an operator may set only the policy's `enabled` field to false. Keep its manifest, original operation snapshots and activation receipt. Restoring the deduction must not cancel already admitted new work, alter the ledger or replay a provider request.
