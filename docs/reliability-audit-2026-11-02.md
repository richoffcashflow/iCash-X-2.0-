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
- The organization owner-export capacity returned `export_busy`. This needs original request/receipt review; never replay an uncertain paid export to clear it.
- The live workflow monitor showed nine unresolved call receipts and one owner export. Do not clear these by age or mark them complete without provider evidence.
- The 720 business number was enabled; the two 424 lines were disabled. Preserve established conversation routing and provider reputation holds.

## Release and verification

Apply the additive database fixes only after their offline and native concurrency checks pass. Both are compatible with the existing application. Confirm function definitions, constraint and privileges after migration. Full reliability CI remains the production release gate, including build and desktop/mobile browser checks. No paid test calls, texts, data purchases, customer billing changes or replayed provider operations are part of this audit.
