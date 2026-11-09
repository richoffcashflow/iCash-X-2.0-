# Prospective seller SMS learning

Identity-v5 connects new, footer-free cold seller introductions to observed selling interest and verified deal outcomes. It does not rewrite earlier assignments, queued messages, sent messages, contact permissions, provider receipts or charges. It changes selection among three reviewed texts; it does not generate new copy or modify application code autonomously.

| Variant | Reviewed template |
| --- | --- |
| `identity_cash_v5` | Hi, contacting you for {principal} about a cash offer. Do you own {address}? |
| `identity_as_is_v5` | Hi, contacting you for {principal} about buying as is for cash. Do you own {address}? |
| `identity_timing_v5` | Hi, contacting you for {principal} about a possible cash sale. Do you own {address}? |

The exact buyer principal and street address are preserved. A candidate must fit one 160-character GSM segment using the existing character allowlist; unsupported or long text is never truncated. Only enabled templates matching these reviewed literals participate. If just one template fits, it remains exploration and still passes the negative-feedback guard.

## Assignment and activation

Install `20261104052433` (evidence policy), `20261104052834` (SMS assignment), then `20261109184402` (SMS outcomes). The SMS migration guards the exact existing queue, candidate, assignment and v4 renderer definitions. Its new private setting starts disabled. The global evidence-v2 release setting must also be enabled before SMS can activate.

After the exact web/worker release and required CI checks pass, the service-only `icash_set_seller_sms_learning_enabled(true)` enables future assignments under the existing operating-budget admission lock. Deactivation uses the same function with `false`. Deactivation affects future choices; it does not cancel or modify an existing conversation. Historical v4 copy and inbound/owner demonstration paths retain their prior behavior.

Only ordinary outbound discovery screenings participate. Owner accounts, inbound seller requests, practice/test records and accounts funded only in test mode are excluded. These exclusions also apply to outcome refreshes.

The candidate helper is read-only. The final queue retains every original source, recipient, thread, pricing, route and financial check. It records one immutable assignment and its evidence-v2 decision snapshot together. Twenty percent of accounts form a stable comparison group using balanced approved choices. In the adaptive group, a verified winner receives the 60% bucket and challengers retain the other 40%. Insufficient evidence keeps exploration. A negative-feedback hold removes that arm from both groups; no allowed, renderable arm means no new experiment assignment.

Stored variant, body, context, decision ID, selection mode, creation time and established message binding cannot change. Ordinary delivery observations can still attach the original message and update receipt timestamps. Candidate reads do not write decisions, reserve money or authorize a send.

## Outcomes and cost meaning

An exposure requires the exact assignment/message/account/thread body binding, a provider-confirmed delivered message and the original canonical operation dispatch time. A queued or accepted message is not an exposure. An ownership “Yes” is never a reward.

Selling-interest evidence requires a delivered, dispatched follow-up whose exact text is `Would you be interested in selling your property for all cash?`, followed by an unambiguous affirmative received reply with no intervening conversation turn. The positive outcome window is 72 hours from the original introduction dispatch. That whole window must finish before interest contributes a positive result. Opt-outs affect the safety guard immediately; refusals and later negative evidence prevent a positive label. Verified purchase and closing windows are 30 and 60 days respectively, using the existing signature and title evidence readers.

Cost includes the original opener, related outgoing texts, text-AI operations and calls to that same seller contact in the 72-hour contact window. Calls without a carrier ID are still included when their original operation is uncertain. Missing, estimated, unsettled or unsupported cost evidence prevents promotion. `cost_cents` means settled customer contact usage charges, not provider expense or total deal profit. Completeness covers incurred operations through the earlier of the window end and now; it does not predict future charges. Research/acquisition spending is not relabeled as contact cost.

The existing bounded learning refresh calls the separate identity-v5 refresh after its unchanged legacy logic. This replaces derived aggregates only. Old interest-v2 and identity-v3/v4 outcomes never become v5 evidence. Actual prospective conversion improvement still requires observed production results.

## Verification

`tests/seller-sms-learning-v5.test.mjs` exercises the real queue, candidate, pricing, route and observation functions with synthetic local data and an explicit decision-policy boundary. `tests/seller-sms-learning-v5-policy.test.mjs` connects the actual evidence-v2 SQL decision and recording functions, including a single fitting template and unsafe-arm holds. `tests/seller-sms-learning-v5-outcomes.test.mjs` verifies dispatch, delivery, interest, refusal, full contact costs and verified higher-funnel evidence.

`scripts/test-seller-sms-learning-v5-postgres.py` requires the isolated localhost Reliability PostgreSQL database. It checks both migration/queue lock orders, simultaneous queues producing one assignment/decision, deactivation preserving history and a competing thread Pause. These tests make no provider calls. Production activation requires this native check to pass; PGlite alone does not verify concurrent database transactions.
