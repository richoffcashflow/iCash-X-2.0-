# Meta response display correction

Install `20261109000500_carrier_text_notice_meta_projections.sql` after the shared classifier and response-text projection migrations. This is a read-only display correction for historical Meta records. It does not clear `icash_meta_leads.response_at`: the original value remains a stop barrier for unanswered follow-ups, cancellation and outreach admission.

The service-only, security-invoker helper changes a displayed response timestamp only when all original evidence matches:

- The stored response channel is SMS and the response time exactly equals a received incoming notice's original creation time.
- The notice belongs to the same account, lead, seller thread and deal/screening.
- The existing shared whole-message, attachment-aware carrier predicate identifies the notice.

Missing legacy messages, unknown channels, mismatched accounts/lead/property bindings, nonreceived messages, outgoing notices and different timestamps retain the original response unchanged. A notice arriving later does not erase a prior response. The notice's embedded phone digits are not used as identity proof.

For that exact affected case, the helper returns the earliest remaining source-backed text, matching human Meta call, confirmed-address time or bound received seller-email reply. Nonnotice text is retained conservatively, including unknown message formats, quotes, attachment captions and legacy messages without provider IDs. Retired threads retain their historical human evidence. Voice uses the current Meta call-outcome predicate and original contact-key binding. Address confirmation is independent response evidence. Email uses the existing account/deal/opener/reply/recipient receipt bindings. A raw null response stays null.

Only `icash_meta_workspace_response_leads`, the retained `icash_meta_workspace_leads` and `icash_workspace_response_counts` substitute the helper for their raw response reference. Filtering and ordering happen before pagination. All other query predicates, joined reply evidence, signed-purchase counts, search scopes, ACLs and return shapes remain unchanged. No new interest claim is created.

No source table is updated, and no cache or raw response is rewritten. The next display query reflects a later genuine reply without a backfill. Original Pause, decline, voice-pause, suppression, consent, accepted messages, unknown costs and source records remain unchanged. All other raw Meta readers retain their current behavior, including operational stop controls and provider-event history. Historical data with insufficient proof remains conservative rather than being labeled as no response.

## Verification

`tests/carrier-text-notice-meta-projections.test.mjs` runs the actual shared classifier, filtered text view, current call predicates, current seller-text projection and reviewed display RPC definitions in isolated PGlite with synthetic fixtures. It covers exact and mismatched sources, unknown legacy history, notice-only rows, earlier/later/simultaneous human texts, retired-thread evidence, attachments and quotes, calls, voicemail, address confirmations, seller email, cross-account isolation, order/count/page consistency, source/unknown-cost preservation, raw unanswered-follow-up predicates, unchanged call-writer definition, unchanged unrelated display predicates, service-only function ACLs and atomic rejection of an unexpected final predecessor. It does not call provider services, exercise production, or claim native concurrent-transaction coverage.

The final integrated release must test the actual migration order and full schema prerequisites. Config and migration copies are byte-identical. Literal predecessor guards fail closed rather than replacing unknown logic. This implementation and its local tests do not establish a production deployment or restored carrier delivery.
