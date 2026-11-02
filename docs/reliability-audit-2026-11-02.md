# Reliability audit — November 2, 2026

Baseline: `822c14eaa4d09dd2260f27ef6ada80a7e84c4fc6`, verified on Vercel and Railway. Production database and maintenance/worker heartbeats were current. Existing provider holds remain unresolved; a healthy heartbeat is not proof of completed outreach.

## Contract documents

The actual purchase and assignment renderers produce 441,190 and 331,000 bytes even with blank terms. The database accepted fewer than 100,000 bytes. Four production document writes failed with SQLSTATE 23514 in the inspected 24-hour window.

Raise the limit to fewer than 1 MiB for these two embedded-image forms only. Keep the 100,000-byte cap on buyer/title packets. Do not change the approved form images, wording, signing configuration or historical documents. The new test first reproduces rejection by the original table definition, then runs all four kinds through the real save/reopen routes using an isolated database, with cross-account and origin rejection checks.

## Learning versus scheduling

Seven production deadlocks in the inspected window involved the learning-change trigger and acquisition scheduler. Learning locked its queue before refreshing outcome rows; scheduling could hold outcome rows while its trigger waited for that same queue.

Claim learning with its existing account advisory lock before rebuilding, without a queue row lock. A bounded candidate scan skips busy accounts. Add a notification generation so successful or failed completion cannot postpone a newer wakeup. Preserve the hourly success and five-minute failure cadence, original aggregate calculations and service-only access. Ignore discovery `next_run_at` changes alone, which are scheduling bookkeeping rather than new learning evidence.

PGlite covers completion, fresh wakeups, rollback, bounded retries and privileges. The full shared-learning fixture runs the new migration against the original aggregate functions. A separate PostgreSQL 17 CI job must reproduce the old deadlock, pass the corrected interleaving, preserve a concurrent wakeup and skip a busy account without starving the next one. PGlite alone does not prove concurrent locking.

## Operational findings requiring receipt-based follow-through

- At inspection, 148 funded accounts were running, while the main property text and voice tables showed no new entries in the preceding 24 hours. Research and reconciliation tickets continued. These counts do not include customer-update delivery tables.
- The organization owner-export capacity returned `export_busy`. Reviewed the exact completed HTTP 500, original receipt hash, absent export ID, source guards and deployed recovery functions. Armed one original, quota-bound FREE inventory check through existing authenticated maintenance. At 06:28:04 UTC it verified provider idleness; the original receipt, null terminal/completed timestamps and money/owner holds remained unchanged.
- Ordinary production work then resumed and a new five-person export returned another HTTP 500 `internal_error` at 06:28:13 UTC. Its selectors matched the last successful twelve-person export. No replay or further capacity release was attempted. This provider-side failure remains a live blocker; idle capacity alone does not prove successful delivery or known cost. The private original receipt retains the provider request ID for investigation.
- The live workflow monitor showed nine unresolved call receipts and one owner export. Do not clear these by age or mark them complete without provider evidence.
- The 720 business number was enabled; the two 424 lines were disabled. Preserve established conversation routing and provider reputation holds.

## Release and verification

The original document rejection, real save/reopen routes, isolated shared-learning integration and native PostgreSQL 17 concurrency checks passed. The native test reproduced the old deadlock, passed the repaired interleaving and preserved a concurrent notification while skipping a busy account.

Applied compatible production migrations `20261102062806_contract_document_storage` and `20261102062810_learning_refresh_concurrency`. Readback confirmed the bounded form constraint, non-null generation, exact function bodies and service-only grants. Subsequent scheduled learning refreshes succeeded without new queue errors. Full reliability CI remains the application release gate, including the full offline suite, dependency audit, build, concurrency and desktop/mobile browser checks. No paid development calls, texts, data purchases, customer billing changes or replayed provider operations are part of this audit.
