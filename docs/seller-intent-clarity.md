# Seller return-call statements and ownership questions

Current production SQL reproduced two gaps: `I'll call you back.` had no deterministic dialogue action, and `Who owns it?` received `Which part would you like me to clarify?`. This repair recognizes complete, bounded statements and questions in the existing seller text conversation.

| Seller source | Informational reply |
| --- | --- |
| `I'll call you back.` and supported first-person equivalents | `Okay, call back when you're ready.` |
| `Who owns it?` and supported property-owner questions | `I can't confirm ownership from this text. Are you the owner of the property we texted about?` |

The return-call statement creates no callback request, schedule or outbound-call permission. The ownership question supplies no owner identity or agreement authority. Mixed instructions, quoted statements, conditions, refusals, human requests and instructions to call the seller do not match this grammar. Existing language/email handling, active-call and uncertain-receipt holds, pending facts, actual prior confirmations and repeat limits remain in place.

The database derives the intent from the exact original account/message and reuses `icash_seller_conversion_source`: existing enabled settings, conversion cutover, provider/event evidence and the original 24-hour source window. There is no new feature flag, cohort or activation. Shared memory does not need to be enabled. The marker is part of the original offer-context fingerprint; the TypeScript planner independently matches the source before replying. Informational replies stamp only the processed source/thread and retain prior offer/fact state. The normal locked save and final dispatch admission remain authoritative.

## Release order

1. Pass the exact-head application checks. Deploy this application's planner/helper to the web and both serving workers and verify the exact release first. Old SQL with the new application keeps its existing behavior until the marker is available.
2. Take a fresh read-only source and metadata preflight. Install `20261117184851_seller_intent_clarity.sql` once, with its byte-identical `config/seller-intent-clarity.sql`, and the migration-history entry in the runner's single transaction. It uses a two-second lock timeout and eight-second statement timeout. Any source, security, owner, volatility, configuration or ACL mismatch stops installation.
3. Read back the result hashes, metadata and migration history. Observe ordinary new traffic; do not replay old conversations or send paid demonstrations. A rollback of the application while this SQL is installed requires a separate compatible plan: old planners cannot interpret the new marker.

All functions are owned by `postgres`, use an empty search path, and allow execution only to `postgres` and `service_role`. The text-offer context retains security-definer behavior; all other listed functions are security invoker.

| Function | Required predecessor MD5 | Result MD5 |
| --- | --- | --- |
| `icash_seller_dialogue_context(uuid,uuid)` | `c8184bec64e238638cf45430ab204a2b` | `bee46c11ac1b8f40e4c0e8ec6b1b586a` |
| `icash_seller_text_offer_context(uuid,uuid)` | `5f6e0a4049af7b8ca40b1bcb599f3547` | `d8ed972f7edfe536ba06158849c889ef` |
| `icash_seller_information_action(text)` | `e408e8ad817d0947e81ae215cd55f821` | `291228d4fb3298c25ace9b3ac3f56af5` |
| `icash_seller_conversion_source(uuid,uuid)` | `50869661c2d8d43b48bdc197c395ac8a` | unchanged |
| `icash_seller_intent_clarity(text)` | must not exist | `fef110ec8ccbabff7e898af973a5c92b` |
| `icash_seller_intent_clarity_source(uuid,uuid)` | must not exist | `cc8bbca206a5e83e3e4f65cac5094893` |

## Verification and boundaries

`tests/seller-intent-clarity.test.mjs` restores the captured November 17 production predecessors, reproduces both old failures, and runs the migration and source-to-ingress-to-resume-to-planner-to-save-to-final-claim path. It checks SQL/TypeScript parity, unchanged pending facts/confirmations, repeated-answer limits, late account Pause/manual/contact-expiry rejection, original source cutoff, cross-account exclusion, newer source/human precedence, stale-research informational handling, private privileges, metadata/source drift and atomic migration-history rollback. No callback request or signing envelope is created.

The same suite runs on PGlite and disposable native PostgreSQL 17.11. With dependencies installed and the fixed loopback disposable test database available, run `node --experimental-strip-types scripts/test-seller-intent-clarity-postgres.mjs`. The helper rejects other database/role/socket targets. The offline fixture exercises real existing planning/save/claim SQL, with deterministic unrelated contact/provider/financial delegates; it does not prove the complete production financial stack, external delivery or live conversational quality.

This is separate from draft PR626's evolving preferences and offered-call permission work and draft PR620's carrier-notice classification. It does not activate either draft or shared memory. The independent Pause repair changes a different SQL function, `icash_seller_response_disposition`; this migration does not replace or source-pin that function, and its current result remains a mandatory exclusion. No historical backfill, provider mutation or hosted database write is included in preparation/testing.
