# Original title-task delivery

The legacy assignment sender could fetch a transient replacement signing PDF and send it after the original envelope row was restored. The final claim only compared the task payload, so it could not tell which PDF had been read. Assignment, payout and follow-up senders also completed an edited business task after their provider await. Frozen service bodies from `b938c8e510f6a5a21cf5fe3a6a0250723faec296` reproduce all four defects against the actual predecessor SQL and actual signing PDF reader, with offline provider responses.

The forward repair binds legacy assignment and payout delivery to a complete original task/request snapshot. Assignment PDFs additionally use the exact original signing source already supported by `completedSigningPdf`. The final claim compares that snapshot, delegates the complete existing claim, locks the exact assignment envelope and rereads after inherited waits. Any source change rolls the entire claim subtransaction back, including its reservation. The original Pause, manual, cancellation, current agreement, contact, rate and financial checks remain in the retained predecessor.

Follow-up reminders take the same immutable snapshot inside a new versioned final claim. They keep the existing verified-reply cancellation behavior. There is no new polling lane, historical replay, replacement document or financial authorization.

## Original receipts and edited work

Each successful claim saves one private immutable admission containing the full original business task, request, assignment source where applicable, and exact operation account/key/rate/dispatched time. Only transport bookkeeping (`email_state`, `email_provider_id`, `email_retry_at`, `updated_at`) is excluded from the task comparison; the request excludes only `updated_at`.

The receipt RPC saves one original provider ID even when the task's association has subsequently changed. It marks the business task done only when the complete original source is still current. An edited, cancelled, dismissed or review task retains its business state. A repeated matching receipt acknowledges the original without mutating later work; a conflicting ID is rejected. Private admissions and receipts reject update, delete and truncate.

Permanent preparation failures have their own private immutable reason journal. The frozen `609955b0` service reproduced a nonnumeric original signing-provider ID returning to a six-hour retry indefinitely. The corrected single preparation RPC returns the send-only source together with a non-admitting complete task/request/document observation. Unsupported update types, malformed assignment references, invalid original provider IDs and invalid payment preferences enter `needs_review` only through an exact locked source comparison, with no admission or existing operation. A changed task, repaired document, cancelled work or current worker's admitted send rejects the stale review without modifying it. The recorded reason and original source remain available without storing provider error text or credentials.

Missing signing configuration reports configuration-required. Temporary provider reads, incomplete current delivery sources and source changes remain retryable; they do not acquire send authority or a fabricated failure receipt. Preparation review never resets an original operation, resends an email or clears a workflow flag. A provider failure after admission still follows the separate uncertain-send hold below.

An uncertain provider response retains its original operation and needs reconciliation. No retry resets its admission or repeats the email. A lost receipt acknowledgement cannot undo a committed receipt/completion. A late known receipt never clears an earlier business review. Task completion here establishes the original email delivery receipt, not title opening, a legal signature, deposit receipt or closing.

## First installation and rollback boundary

`supabase/migrations/20261117035143_title_task_delivery_source.sql` was created with the pinned Supabase CLI 3.2.0 `migration new` command. It is byte-identical to `config/title-task-delivery-source.sql`. Use the normal runner-owned transaction for the migration and its ledger row; the SQL intentionally has no inner `BEGIN`/`COMMIT`.

This migration requires a freshly verified **empty title lifecycle**: no `icash_title_requests`, no `icash_title_tasks`, and no `title-followup:%` operation keys. It takes the existing migration advisory lock, then the budget row and title-table writer locks with `NOWAIT`. A busy writer or any existing lifecycle fails closed before installation. This is a first-rollout restriction, not permission to delete existing work. If production is no longer empty, stop this installation and separately review the existing originals and cutover; do not bypass the guard, invent old snapshots or reset flags.

An old provider request already in flight cannot retroactively acquire a trustworthy original snapshot. The strict empty installation boundary excludes that case. After installation the old three-argument update overload admits only the separately protected executed-copy path; the old two-argument reminder overload returns null. Actual frozen old workers are tested while a current worker gains admission during their await: they neither send nor execute their old direct completion PATCH, and the current original admission remains intact. An application rollback therefore holds legacy updates/reminders. Retain the forward database repair and original journals; do not restore the unsafe claim overloads to make old workers send.

Install only after fresh empty-lifecycle and predecessor checks, then verify the exact web and worker release. Existing executed-copy policy and source/receipt functions are unchanged. No policy activation or data backfill accompanies this repair.

## Source and privilege pins

The migration checks exact function source, owner, security mode, volatility, parallel mode, search path and ACL before replacement, and checks all fifteen result functions afterward. Captured production definitions and metadata are committed in `tests/fixtures/title-task-delivery-predecessors.json`; result metadata is in `tests/fixtures/title-task-delivery-result-pins.json`.

| Predecessor | Source MD5 |
| --- | --- |
| `public.icash_claim_title_update(uuid,uuid,jsonb)` | `b5d5f5d7c15f592389db4505aa0ce343` |
| `public.icash_claim_title_followup(uuid,uuid)` | `f454ecbc344edfc87150f7bb0e9e2ab0` |
| `icash_title_copy_private.envelope_source(public.icash_signing_envelopes)` | `83b97c7e61fdd547cced6df8c79ceb56` |

All remain owned by `postgres`. Public entry points grant execute only to the owner and `service_role`; retained predecessor delegates and private helpers are owner-only. Private tables have RLS and no application-role table grants. The security-definer wrappers use an empty search path and call fully qualified functions. The original claim bodies are renamed intact; no shortened recreation of their financial/contact checks is substituted.

## Verification

- `tests/title-update-original-source.test.mjs`: all four historical reproductions and the permanent-failure retry reproduction; exact original PDF; source/control changes before final claim; immutable preparation review for deterministic defects; edited/repaired/admitted source races; temporary read recovery and missing configuration; assignment/payout/reminder edits during provider await; changed task association/request recipient/document terms; current-vs-old worker interleavings; malformed/old claims; empty PDF; unknown outcome; late/duplicate/conflicting/lost-ack receipts; real `service_role`; private privileges and immutable journals.
- `tests/title-task-delivery-database.test.mjs`: predecessor source/owner/ACL drift, populated or orphaned lifecycle rejection, result pin rollback, shared migration/ledger rollback, unchanged assignment/payout/reminder positives, and service-role executed-copy delegation through the compatibility overload.
- `scripts/test-title-task-delivery-postgres.mjs`: native PostgreSQL 17 concurrent claims, busy-budget/writer installation refusal, populated cutover rejection, source edits before claim, envelope edits after inherited reservation with full rollback, exact envelope locks through commit, edited work during receipt waits, both verified title reply/reminder claim orders, and preparation review versus task edits, PDF repairs and current claims.
- Adjacent title-update, title-follow-up and executed-copy service/PDF/receipt suites and TypeScript checking remain required.

Provider transport and financial helper boundaries in these fixtures are explicit offline sentinels. The captured original claim and actual service/source/receipt SQL execute unchanged; the tests prove their composition and concurrency, not provider availability, production sending or full financial policy eligibility. No external email, signature action, payment or paid development call is made by these tests.
