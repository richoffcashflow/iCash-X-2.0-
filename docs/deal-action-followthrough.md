# Deal action follow-through

The November 9 request is to make iCash X handle the next useful step across the existing wholesale workflow. This release closes a specific call-to-text gap, adds executable text replies to Ask AI, and makes recorded deal progress visible.

## Seller call-to-text continuity

Fresh short identity questions and greetings after a completed seller call can receive the actual business identity and property address, followed by an ownership question. English and the reviewed Spanish identity phrases use deterministic copy. The original exact account, property, number pair, call receipt, route revision and two-hour context window still apply. Long or unsupported identity copy stays in review rather than being shortened or invented.

Activation is prospective. No historical messages are replayed. The reply is not evidence of ownership, interest, sale terms, or permission for a new call. Existing refusal, contact, wallet, source freshness, Pause, manual control and final sending checks remain authoritative. Clearing `post_call_identity_enabled_at` fences pending replies through final dialogue revalidation.

## Ask AI replies that can be completed

The saved suggestion opens an inline review with its property and latest message. The customer can edit and explicitly send the text. Existing manual texting handles pricing, recipient permissions, suppression, sender continuity, one-use dispatch and delivery recovery. As with other manual replies, sending places the property under customer control; the UI explains that consequence.

The model still has no tools. A server-side saved action, account and source message bind the operation. One question/action can create only one durable message, even across new request keys, lost responses and multiple browsers. Retries retain the original message. The queue and final manual claim both reject a newer conversation source. A busy inbound thread yields without holding up its budget-lock observer. Uncertain sends remain held; opening, previewing or checking an action never sends.

This release adds text execution, including photo requests and seller/buyer replies. It does not manufacture confirmed callback times, signatures, visits, deposits or closing outcomes.

## Visible next move

Each expanded property shows its next move, who is responsible, the last confirmed screening/reply/call timestamp, and any recorded check or callback time. Seller progress is joined to the exact latest message. A newer reply cannot inherit an older reply's progress. Customer controls and human requests take precedence. Missing evidence is shown as awaiting an update.

## Learning activation completed November 9

Production was missing the committed identity-v5 outcome reader, canonical policy lifecycle and evidence cutover. Installed the existing reviewed migrations in that order after their offline and native PostgreSQL checks passed. Registered successful main-push Reliability run `42655934528`, attempt 1, for `7927e8d2a36962c920876f19e5c7fbf1c5dd8754`; both production web and worker were verified on that exact release.

The evidence policy and SMS policy were enabled at `2026-11-09T18:46:43Z`. Readback confirmed a real policy application and fresh refresh runs with zero failed accounts and no conversion error. The outcome ranker remains unqualified with no active model; activation does not create positive outcomes or bypass model qualification. Original evidence, source receipts and financial history remain unchanged. Derived samples and rollups are refreshing from corrected readers.

## Release sequence for the new actions

1. Run offline regressions, native Ask AI contention tests, production build, and desktop/mobile browser fixtures. Required exact-head CI must pass.
2. Install `seller_post_call_identity` and `assistant_text_actions` disabled, then the guarded `owner_retry_source_filter` optimization. Their canonical SQL is mirrored in `config/` and their timestamped migration files.
3. Release the same commit to web and worker and verify exact-main Reliability and both production deployments.
4. Under the existing budget lock, set `post_call_identity_enabled_at` to the current transaction timestamp and enable `icash_assistant_action_settings`. Never backdate activation.
5. Read back settings and fresh ordinary production receipts. Do not place development calls, send test texts, replay old conversations or purchase provider data.

## Retry queue performance

The pre-existing main revision `b17ce3c` failed a native owner-retry selector stress test; its deployments did not replace the verified `7927e8d` production release. The same failure reproduced locally. PostgreSQL evaluated correlated same-property history against 1,000 stale source snapshots before rejecting their invalid hashes, repeatedly decompressing the large snapshots.

The guarded source filter materializes candidates after the original source and retry checks, before the same-property history and cohort proof. All predicates, priority ordering, complete-candidate coverage, final admission locks and original financial/receipt holds remain. This is not a shortened candidate list or a retry reset. A hash match is required before the expensive retry-source proof.

The unchanged native PostgreSQL 17.6 stress case now passes with 100,000 historical tickets and 1,000 invalid sources; the measured complete-source selector took 223 ms locally. The actual one-use issuer also passes concurrent claims and late Pause, reserved-wallet, changed-source, deadline, approval-cap and unknown-receipt cases. Offline regressions separately retain manual control, recent same-property contacts, existing operations and reserved/dispatched sibling operations. Production timing remains to be observed after release.

The production build and desktop/mobile Ask AI browser fixtures pass, including stale conversation rejection and original receipt recovery after a lost response. The new stylesheet is imported by the actual root layout, and the browser checks verify its loaded styles. Record the final verified release after exact-main checks and both deployments complete.

The production migration receipts are `20261109185841_seller_post_call_identity`, `20261109185851_assistant_text_actions` and `20261109185853_owner_retry_source_filter`. Their recorded SQL matches the repository files byte-for-byte. The filenames follow these actual receipts; the initial CLI creation times are not additional unapplied migrations. Both new action switches remain disabled pending the matching verified release. The separate workflow-stall isolation update is preserved; its two helper changes and this source filter affect different functions, and the combined focused regressions pass.

The earlier learning activation is likewise recorded as `20261109184402_seller_sms_learning_v5_outcomes`, `20261109184429_learning_policy_lifecycle` and `20261109184628_learning_evidence_refresh_cutover`. Their SQL also matches the production receipts exactly, and the filenames and references now reflect that installation history without changing any SQL or receipt.
