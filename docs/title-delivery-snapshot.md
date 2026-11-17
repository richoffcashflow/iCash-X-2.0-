# Initial title delivery binds the loaded agreements and payout

The predecessor initial-title claim checked the loaded request, recipient, rate and purchase ID, but not the assignment PDF or payout text. Actual SQL fixtures reproduce both failures: replacing the buyer after loading the old assignment still admitted the old snapshot, and changing the payout after loading its old preference still admitted delivery.

The sender now reads one versioned database snapshot before loading PDFs. It contains the exact request fields, current deal terms, live purchase and assignment provider/terms/recipient/template identities, and raw payout preference. The original purchase caption must still match its property address. No assignment is also explicit evidence: a newly completed assignment makes an older purchase-only snapshot stale.

`completedSigningPdf` accepts an optional expected source for this sender. It rejects another provider ID, terms, signer set, state or other bound identity before its first provider GET. The normal provider signature verification and bounded PDF download remain unchanged. This prevents a row changing during PDF loading from silently selecting another document. Every PDF caller also rejects a successful but empty response before a delivery can be claimed; unrelated callers retain their existing source selection.

The final claim acquires the original shared budget before account, deal and current source rows, then compares the complete loaded snapshot. The deal lock also fences related-row insertion; existing current envelope and payout rows are locked before the final comparison. Real cancellation, signing and payout writers retain their shared budget order. Source mismatch returns before the original reservation. The entire existing reservation and final claim implementation remains a delegate; customer Pause, manual control, title contact, rate, financial authority and original dispatch controls are not replaced. A claim that wins before a later edit retains its one original send; post-admission changes require their ordinary follow-up path.

Only a valid current snapshot can be admitted once. `dispatching`, `sent`, `needs_review` and provider-bound originals do not become replay candidates. A provider timeout preserves the original reconciliation hold. No existing request, payout preference, agreement, provider receipt, operation or history is rewritten.

## Ordered rollout

This candidate is based on the neutral original-title-source and closing guard work, including exact Agreement references in outgoing instructions. It is separate from the executed-document-copy adapter. The latter continues to own its existing title-update claim and queue.

Install `20261116235416_title_delivery_snapshot.sql` once before deploying the sender. The config is byte-identical, generated with the Supabase CLI, and has no inner transaction boundary. The runner owns replacement and migration ledger together, using shared advisory lock `726341927`, a 3-second lock timeout and a 15-second statement timeout. Predecessor source and postgres/invoker/service-role ACL/search-path/volatility metadata are pinned. Result pins include unchanged delegates and the renamed previous wrapper. No activation switch or historical reset is needed.

Old workers submit only request headers and are deliberately held by the new version check during the rolling deployment. They cannot send an unbound attachment. The new sender cannot operate before its read RPC exists. Release the exact tested web/worker code through normal canonical checks after installation and exact readback; do not call an old delegate to bridge a partial deployment.

| Function | Full definition MD5 after installation |
| --- | --- |
| `icash_title_request_delivery_snapshot(uuid,uuid)` | `177676c00defda782d4dd1004c397d10` |
| `icash_claim_title_request_snapshot(uuid,jsonb)` | `7177660cb0bfb790182637f7069842ac` |
| `icash_claim_title_request_before_delivery_snapshot(uuid,jsonb)` | `cd5514a18bbc37f56a24bada45c0f1d9` |
| `icash_claim_title_request_before_snapshot(uuid)` — unchanged | `91a3775344ab741fcc1ba9395cc861d0` |
| `icash_save_closing_setup_before_profile(uuid,uuid,uuid,text,jsonb)` — unchanged | `c80380bdeaf4baa684850ec5425d6ff6` |
| `icash_signing_action_allowed(uuid,uuid)` — unchanged | `0c8dd6053164498e0f2e400d8e55d3b7` |

## Verification and limits

`tests/title-delivery-snapshot-database.test.mjs` executes the captured actual predecessor functions, reproduces the two stale admissions, applies the real migration and checks changed/missing assignments, provider and signer identities, payout and address changes, current controls, old/new callers, one-use admission, source/ACL rejection and preserved original receipts. The actual title service is connected to that SQL in `tests/title-delivery-snapshot-service.test.mjs`, with a buyer replacement or actual payout setter during the mocked PDF download. Neither race reserves or sends. A valid current source sends once; an unknown provider outcome remains held.

`scripts/test-title-delivery-snapshot-postgres.mjs` runs only against the fixed disposable PostgreSQL 17 loopback fixture. It verifies migration-lock contention and ledger rollback, actual payout-setter contention in both orders, replacement-state writes under the shared cancellation budget, a changed envelope committing while the claim waits, and competing one-use claims. Replacement changes here are explicit fixture writes under the real lock boundary, not a reconstruction of the whole cancellation provider stack. The separate closing-source tests exercise that complete cancellation RPC chain. Reservation and provider functions remain explicit offline fixtures; no paid operation, production send or live customer outcome is claimed.

Register `title-delivery-snapshot-database` and `title-delivery-snapshot-service` in the existing local release suite list. The ordinary all-tests runner discovers both. Register the native script after the existing isolated `pg` driver in database-contention; it has no application runtime dependency and needs no new job or timeout increase. Also run `title-service`, `signing-pdf-bounds`, adjacent title sender/closing tests and TypeScript. Shared registrations and production release belong to the release coordinator.
