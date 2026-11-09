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
2. Install `seller_post_call_identity` and `assistant_text_actions` disabled. Their canonical SQL is mirrored in `config/` and their timestamped migration files.
3. Release the same commit to web and worker and verify exact-main Reliability and both production deployments.
4. Under the existing budget lock, set `post_call_identity_enabled_at` to the current transaction timestamp and enable `icash_assistant_action_settings`. Never backdate activation.
5. Read back settings and fresh ordinary production receipts. Do not place development calls, send test texts, replay old conversations or purchase provider data.

The pre-existing main revision `b17ce3c` failed a native owner-retry selector stress test; its deployments did not replace the verified `7927e8d` production release. This release cannot bypass that check. Record the final verified release here after it completes.
