# Seller conversation quality — November 14, 2026

The owner requested natural, efficient seller calls/texts, a saved-name owner-confirmation question, and no voicemail conversation or false seller-review task. Existing UI and source-bound offer, contact, customer-control and delivery protections remain in place.

## Confirmed failures and changes

- Completed machine-only calls were interpreted as callback requests because the gap classifier read a mailbox's “call me back” before checking whether a person answered. The SQL classifier now checks the whole source transcript first. Clipped English and Spanish mailbox/screening variants are recognized consistently in TypeScript and SQL; a later live answer or opt-out still wins.
- An untouched callback-review item is retired only when its exact completed, same-account/property call is machine-only and its saved quote matches the source. Original transcripts, reason history and financial records are retained. Manually edited reviews, queued messages and unknown operations are excluded. No old outreach is replayed.
- The recorded seller prompt puts the stop-recording/end-call action before property context, including the observed clipped mailbox cues. This is model-directed cutoff using the existing bound tools, not a new carrier AMD integration or a guarantee of detection before speech.
- The first outbound greeting can ask “Hi, is this Sonya, the owner of 2123 Main Street?” using a valid, unambiguous saved name bound to the exact account/property/dialed phone. Names are confirmation candidates, never ownership proof. Missing/ambiguous/blocked names and lookup failures fall back to the generic owner question.
- Inbound matched-seller and outbound runtime prompts share the same answer-first guidance without changing frozen provider fingerprints. A price request establishes conversation interest and makes personal motivation optional. Reuse answered condition, occupancy, timing and listing facts; respect personal-question refusals. Current refusals still stop qualification. Only the existing server offer tool can authorize a price or contract.
- An explicit zero answer to a total repair-budget question is accepted across calls and texts. A descriptive repair answer or explicit lack of an estimate can continue by SMS using an available research allowance; it records the actual answer and retains unrelated material-fact holds. “No repairs” alone, an uncertain amount, an individual repair item or a different budget never creates a zero repair allowance. The SMS regression proceeds through the actual source-bound save, authorized offer and accepted-offer agreement step while retaining the larger research allowance.

## Deeper conversation and reply review

- A bounded review of the latest 1,500 completed seller calls in seven days found three source-supported interest candidates, including one known owner demonstration excluded from sales evidence. One real conversation repeated English qualification after the seller said they did not understand English. Another repeated timing questions while the seller repeated an asking amount. Runtime guidance now asks the preferred language once and clarifies/saves an asking amount before returning to timing. These are conversation improvements, not evidence of a qualified or closed deal.
- All 59 authenticated incoming property-text events in the seven-day review had stored messages. Two threads were subsequently retired. The latest price question was present in its active thread, default-thread selection and workspace summary. An incoming provider ID may be absent when the authenticated event supplies its source receipt.
- Optional preview-summary failures could hide the entire otherwise valid conversation. Customer and owner message routes now retain the authorized raw conversation when only that metadata lookup fails; failed authorization, tenant selection or raw-message reads still fail. Unknown unread metadata remains unknown.
- A fresh price question reached immediate review because its screening was 24 hours and 13 minutes old. Deterministic informational replies now pass both preparation and final sender admission without renewing financial authority. Existing current contact, source, route, controls and exact-copy checks still apply. Price quotes and contracts retain their original freshness requirements.
- The display audit found 253 active expired automatic `no_response` draft reminders with no explicit review reason: 251 delivered initial texts and two empty calls. Their later reminder states varied. They are background history regardless of reminder delivery, so the shared workspace, badge and assistant query excludes them before pagination. Explicit callback, human-request, delivery-unknown and other actionable reviews remain visible. This is an application display change; source records remain intact.
- A strict full phone menu was falsely classified as an opt-out/person request because its options included a do-not-call list and a representative. TypeScript and SQL now recognize that exact full-menu structure; preceding, appended or later real speech and STOP still win. The cleanup preserves existing manual property controls because their earlier provenance cannot be reconstructed safely.

The private source-recovery function accepts an exact account/message/job/body hash and snapshots the original failure. It can restore only the unchanged, never-attempted price-question job in the observed one-hour screening boundary to pending. Any prior ticket, spend, outgoing message, newer conversation, changed source or failed current admission blocks recovery. A rejection also consumes its immutable receipt. The function sends nothing; ordinary preparation and final transport admission remain required. No public, authenticated or service API role can invoke it.

The reviewed fresh price question was recovered once. The ordinary worker queued its deterministic condition question and its provider-backed outgoing message reached `delivered` at 5:29:22 PM UTC on November 14. The recovery receipt retains the original `needs_review` job snapshot. This was ordinary source-bound production follow-through, not a paid development test; delivery does not establish seller agreement or a closed deal.

## Production database receipts

Applied through the migration service, with exact predecessor guards:

| Migration | Verified outcome |
| --- | --- |
| `20261114170419_seller_voicemail_no_review` | 14 untouched false callback-review items resolved; zero remaining recent machine-only callback-review items |
| `20261114170550_seller_voicemail_live_reply_boundary` | Standalone Spanish unavailable announcement is machine-only; mixed sentence with a live owner remains human |
| `20261114172357_seller_information_reply_liveness` | Informational reply preparation and final admission repaired without relaxing monetary offer/contract authority |
| `20261114172512_automated_menu_request_evidence` | 21 additional untouched false machine callbacks and one strict false phone-menu handoff resolved; 35 total machine callback reviews resolved and zero active machine-only callback reviews remaining at readback |
| `20261114172822_seller_information_source_recovery` | Private one-use original-source recovery installed with RLS, invoker security and no API-role access |

Final function hashes: `icash_call_has_seller_response(jsonb)` = `8912be25a77473b2a09dc88b30885ae4`; `icash_seller_gap_reason(jsonb,boolean)` = `f6a94dba3b06a52897f2a041d5e87362`; `icash_seller_dialogue_reply(uuid,uuid)` = `4d1bba5de6ce229067d5d62ac9cdee43`; `icash_claim_text_before_owner_question(uuid,uuid,text)` = `2ab7c58cc5a38b95651bb0ecb054d40d`. Existing service-only ACLs and function security attributes remain unchanged. Private recovery hash is `629a596a95939665b0dfc6f32eeee274`. No provider configuration, wallet mutation or paid demonstration was used.

## Validation and release

Offline regression fixtures cover machine-only review suppression, SQL/TypeScript parity, later live speech, actual callbacks, opt-outs, SMS review, tenant/source boundaries, intentional holds, immutable transcripts, migration drift rejection, named greetings, missing contact lookup, price-first qualification and exact zero budgets. The SMS suite exercises the real SQL save/claim path through offer acceptance and contract steps. Existing eligible unanswered-contact follow-up uses the updated shared predicate and retains original settlement, source, cadence and current-control checks.

Deeper fixtures cover strict menu recognition, expired-reminder filtering before pagination, independent attention readback, optional summary failure, informational preparation through final claim, and successful/rejected/idempotent recovery including NULL admission. The production webpack build and TypeScript check passed. The broad local release run encountered a phone-access fixture timeout; that fixture passed alone. Do not describe the entire broad suite as passed; exact-head canonical Reliability checks remain the release gate.

Application changes use the existing `auto-release` controller after local review and checks. Database receipts alone do not prove a web/worker release, successful seller call, delivered agreement, signed contract or closed deal. Paid development calls/texts remain disabled.
