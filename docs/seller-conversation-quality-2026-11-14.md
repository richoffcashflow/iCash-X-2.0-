# Seller conversation quality — November 14, 2026

The owner requested natural, efficient seller calls/texts, a saved-name owner-confirmation question, and no voicemail conversation or false seller-review task. Existing UI and source-bound offer, contact, customer-control and delivery protections remain in place.

## Confirmed failures and changes

- Completed machine-only calls were interpreted as callback requests because the gap classifier read a mailbox's “call me back” before checking whether a person answered. The SQL classifier now checks the whole source transcript first. Clipped English and Spanish mailbox/screening variants are recognized consistently in TypeScript and SQL; a later live answer or opt-out still wins.
- An untouched callback-review item is retired only when its exact completed, same-account/property call is machine-only and its saved quote matches the source. Original transcripts, reason history and financial records are retained. Manually edited reviews, queued messages and unknown operations are excluded. No old outreach is replayed.
- The recorded seller prompt puts the stop-recording/end-call action before property context, including the observed clipped mailbox cues. This is model-directed cutoff using the existing bound tools, not a new carrier AMD integration or a guarantee of detection before speech.
- The first outbound greeting can ask “Hi, is this Sonya, the owner of 2123 Main Street?” using a valid, unambiguous saved name bound to the exact account/property/dialed phone. Names are confirmation candidates, never ownership proof. Missing/ambiguous/blocked names and lookup failures fall back to the generic owner question.
- Inbound matched-seller and outbound runtime prompts share the same answer-first guidance without changing frozen provider fingerprints. A price request establishes conversation interest and makes personal motivation optional. Reuse answered condition, occupancy, timing and listing facts; respect personal-question refusals. Current refusals still stop qualification. Only the existing server offer tool can authorize a price or contract.
- An explicit zero answer to a total repair-budget question is accepted across calls and texts. A descriptive repair answer or explicit lack of an estimate can continue by SMS using an available research allowance; it records the actual answer and retains unrelated material-fact holds. “No repairs” alone, an uncertain amount, an individual repair item or a different budget never creates a zero repair allowance. The SMS regression proceeds through the actual source-bound save, authorized offer and accepted-offer agreement step while retaining the larger research allowance.

## Production database receipts

Applied through the migration service, with exact predecessor guards:

| Migration | Verified outcome |
| --- | --- |
| `20261114170419_seller_voicemail_no_review` | 14 untouched false callback-review items resolved; zero remaining recent machine-only callback-review items |
| `20261114170550_seller_voicemail_live_reply_boundary` | Standalone Spanish unavailable announcement is machine-only; mixed sentence with a live owner remains human |

Final function hashes: `icash_call_has_seller_response(jsonb)` = `327a1732d83fc97fd6eaedc3b08417a8`; `icash_seller_gap_reason(jsonb,boolean)` = `30843675bbfb0cfbbe7d330f89559d34`. Service-only ACLs, invoker security, immutable volatility and empty search paths are unchanged. No provider configuration, wallet mutation or paid demonstration was used.

## Validation and release

Offline regression fixtures cover machine-only review suppression, SQL/TypeScript parity, later live speech, actual callbacks, opt-outs, SMS review, tenant/source boundaries, intentional holds, immutable transcripts, migration drift rejection, named greetings, missing contact lookup, price-first qualification and exact zero budgets. The SMS suite exercises the real SQL save/claim path through offer acceptance and contract steps. Existing eligible unanswered-contact follow-up uses the updated shared predicate and retains original settlement, source, cadence and current-control checks.

Application changes use the existing `auto-release` controller after local review and checks. Database receipts alone do not prove a web/worker release, successful seller call, delivered agreement, signed contract or closed deal. Paid development calls/texts remain disabled.
