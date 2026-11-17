# Carrier voicemail cutoff

The owner requested that the AI stop talking to voicemail on November 16, 2026. Recorded outbound calls previously connected the AI immediately and depended on its prompt to recognize a greeting. Recent completed machine-call transcripts included the initial property question before mailbox audio. This change checks the carrier answer before recording or AI registration.

## Call behavior

New direct outbound seller calls save the immutable `call_context.answerPolicy=carrier_amd_enable_v1` at original admission. Their one-use dial requests synchronous Twilio `MachineDetection=Enable`, with an eight-second detection timeout, using the existing signed `/connect` URL directly. `Enable` returns at detection rather than waiting for a beep. The signed initial `AnsweredBy` verdict is checked only after the original nonce, account, call, sender, destination and active carrier identity match. A present canonical GET verdict must agree; null, absent and empty GET metadata do not override the signed decision.

Confirmed machine/fax returns Hangup before recording authorization, recording start or ElevenLabs registration. No greeting, pitch, goodbye, voicemail message or business tool is sent. The existing failure state and canonical terminal carrier settlement retain the original operation. A failed database write cannot prevent the exact carrier hangup; incomplete bookkeeping is left for reconciliation. A signed human or unknown verdict proceeds through all existing recording, provider, customer, contact and financial checks. Unknown is not proof that a person answered: existing prompt-directed voicemail and silence cutoffs remain the fallback. Invalid/missing/conflicting decisions on marked calls end without starting the AI.

Legacy calls without the marker retain their original transport and settlement behavior. Inbound calls retain their existing connection path. Both outbound and inbound stop tools now attempt their exact carrier hangup after an authenticated stop-intent write failure. Outbound confirmed carrier termination is not misreported as unconfirmed merely because a subsequent receipt save failed; receipt state remains honest.

An append-only audit reason distinguishes prospective machine cutoffs from fax and unconfirmed calls. Only a new marked machine cutoff with no recording or AI start, its exact completed carrier receipt, the separate AMD charge and settled original spend can enter existing unanswered follow-up eligibility. Reconciliation retries cannot erase that original reason. The ordinary timing, finite attempt limits, customer Pause, opt-outs, funds, current contact eligibility, manual takeover and later human-response checks still apply. Old audit rows remain null; no historical calls are reclassified or replayed, and no conversation is fabricated.

## Costs and rollout

Twilio prices AMD separately from connectivity at an estimated 7,500 USD micros ($0.0075) per completed call. The marker preserves that separate estimate for both machine-only carrier calls and calls that reach the AI. Canonical unanswered terminal calls have zero AMD fee. No AI or model cost is fabricated for a call that never registered. Original legacy manifests and prices are unchanged.

Admission requires at least 38,500 micros in the existing other-cost allowance (31,000 recording/storage plus 7,500 AMD). Read-only production review found all 391 enabled voice configurations use a 51,000-micro allowance. No quote increase, rate rewrite, provider plan change or credit purchase is required. SQL settlement rejects a rolling old collector that omits the AMD fee from a newly marked call.

Install the source- and access-pinned migrations once, in order: `20261117045315_carrier_answer_detection.sql`, then `20261117045709_carrier_answer_followup.sql`. They create no calls and change no historical contexts, receipts, wallet entries, consent or rates. They preserve function access/ownership and reject predecessor drift. Require the exact current-head Reliability checks and independent review before normal expected-head merge, then exact-main production verification. Do not bypass the serialized release controller or replay previous calls. Paid development calls remain disabled.

The second migration extends both the current routine and the already-installed, inactive three-touch predicates from PR #783. It does not activate three-touch or alter its activation timestamp. Its later release verification must use these reviewed successor hashes instead of the predecessor hashes in that PR's earlier release notes:

| Function | Successor definition MD5 |
| --- | --- |
| `public.icash_unanswered_seller_call_current(uuid,uuid,uuid)` | `61ec5e2634746d4c18e2045ec5d0004c` |
| `icash_seller_recovery_private.settled_unanswered_call(uuid,uuid,uuid)` | `d7236ebb5c5d07ad35db5198b132f481` |
| `icash_seller_recovery_private.meta_third_call_current(uuid,uuid)` | `022147f7097b951aab9a63fc0f891521` |

All other PR #783 source and once-only activation prerequisites still apply. Do not reinstall its existing migrations over these successors.

## Installed prerequisites

Both migrations were installed once on November 17, 2026 UTC, before application release. Hosted ledger versions are `20261117050511_carrier_answer_detection` and `20261117050539_carrier_answer_followup`. Their stored SQL MD5s exactly match the checked-in forward files: `310e6462c47b7555a7a227b1a0d16772` and `b777f54c77f0926c6cc9122420c81bea`. Do not apply them again.

Readback verified all result hashes and unchanged ownership/access. In addition to the follow-up hashes above, admission is `1832ddd79e5c74a1abcf1e0895be324e`, final gate settlement is `8e404e310ed1acfdc6bcd66ba8081506`, voice settlement is `c8abc446d71bdd367c27cbc29e88f839`, audit is `458c59a6c178a05a7f13aa423f6dd8d1`, and the new private helper is `a99c57ec375b8f101ae27128d8dba2d7`. Private tables retain RLS and postgres-only access; the helper is postgres-only. The ordinary routine remains enabled, with `three_touch_enabled=false` and `three_touch_activated_at=null`. Advisor categories and counts are unchanged, with no health findings. These database receipts do not establish that the matching application is live.

## Verification

Offline tests exercise signed and canonical answer evidence, all supported machine/fax outcomes, human/unknown and legacy continuation, missing/malformed/conflicting decisions, failed stop writes, invalid signatures and foreign call bindings, delayed/replayed callbacks, remaining duration and one-use dial marker propagation. Accounting tests execute admission, immutable marker enforcement, gate-only service-to-SQL settlement, the completed voice collector, old-collector omission rejection, idempotency, zero unanswered usage and preserved historical costs. Source/ACL and migration rollback checks retain the original SQL contract.

The local release verifier passed all 523 suites registered when it started. The separately added follow-up suite passed all 63 scenarios, including old/new compatibility and actual original predicates; all 524 currently registered suites are therefore covered. The accounting database suite passed 15 scenarios. TypeScript and independent review passed. Tests use synthetic calls; paid provider tests remain disabled.

These checks prove the application paths with synthetic carrier responses. They do not prove perfect carrier classification, perceived call quality, or live production outcomes. The eight-second bound can add a short silent answer-detection interval. Verify the deployed commit and observe ordinary future provider receipts without paid test calls.

Sources: [Twilio AMD](https://www.twilio.com/docs/voice/answering-machine-detection), [Call resource](https://www.twilio.com/docs/voice/api/call-resource), [US voice pricing](https://www.twilio.com/en-us/voice/pricing/us).
