# Contiguity SMS/MMS release

SMS and MMS use POST /send/text with the explicitly configured sender, `fast_track:false`, and no retries. The existing Token authentication format previously verified against the account is retained; generated API reference examples currently use Bearer. A live send has not yet verified either channel on the new line. Sender +14243948384 is registered in the service-side allowlist; `CONTIGUITY_FROM` must match. No number purchase occurs.

Implemented:
- Signed webhook at /api/webhooks/contiguity, raw-body HMAC and five-minute replay tolerance; durable event-ID deduplication.
- text.incoming.sms, text.incoming.mms, text.delivery.confirmed, text.delivery.failed, text.cancelled and numbers.substitution. A substitution disables the original sender pending review.
- One sender/recipient pair can belong to only one account/deal thread. Unmatched messages are retained privately without assigning them to a tenant. Threads and permission evidence are service-managed, not client-editable.
- STOP and common opt-out phrases suppress that recipient across this platform and cancel unsent queued messages. START does not automatically reinstate permission. Provider-queued/in-flight sends cannot be recalled by this local suppression; cancellation API integration remains pending.
- Account-owned outgoing API, exact request-key deduplication, atomic budget reservation/claim, Pause, contact hours (09:00–20:00 recipient timezone), explicit SMS permission expiry/evidence, DNC checks, reviewed sms_send/mms_send rates, tenant/deal matching and cost limits.
- SMS size conservatively limited to one segment. MMS accepts up to three independently verified, account/deal-owned asset records with cumulative size <=5 MB. No client-submitted arbitrary media URL is accepted by the outgoing API. Asset upload/verification pipeline is not included.
- SMS composer and conversation history inside existing deal details. MMS attachment links appear only for approved Contiguity attachment paths; no automatic media download or repair-cost inference. Outgoing MMS is API-ready with verified asset IDs; no upload UI yet.
- Provider acceptance is distinct from delivery. Early/out-of-order receipts are reconciled under a shared provider-ID lock; delivered status cannot be downgraded by a failure event. Timeouts stay needs_review with reservations retained. Actual provider-cost reconciliation remains a separate outstanding platform function.

Configuration still required for live use:
CONTIGUITY_API_KEY, CONTIGUITY_FROM, CONTIGUITY_WEBHOOK_SECRET; webhook v2 URL and events configured at Contiguity; sender failover disabled at provider; validated active SMS/MMS entitlement; verified thread/permission bindings; actual provider pricing installed as reviewed operation rates; funded operating budget. The release does not fabricate pricing, permission, contracts, users or live activity. No automated seller/buyer SMS campaign generator or media-underwriting engine is enabled. Incoming messages are retained even while the bot is paused.

Build script checks leased numbers read-only and saves only configuration booleans, matched-line state and channel names to private integration diagnostics. No provider body or key is logged. Lease endpoint failure does not by itself mean the API key is invalid.

Validation: mock transport/schema/opt-out/signature tests; rolled-back database checks for Pause, one-use claims, duplicate request keys, account isolation, unmatched inbound quarantine, STOP cancellation, early delivery receipt and out-of-order failure; production build. No SMS, MMS or paid calls sent in validation. Full provider round trip remains pending.

Official sources reviewed September 29, 2026:
https://docs.contiguity.com/api-reference/product/text/sms
https://docs.contiguity.com/api-reference/product/text/mms
https://docs.contiguity.com/api-reference/webhook/example-v2
https://docs.contiguity.com/api-reference/webhook/signing
https://docs.contiguity.com/api-reference/product/leases/configure

## September 29 verified inbound and conversation update
Production received the owner's Hello message at 12:53:44 UTC through the signed webhook. This verifies incoming SMS persistence, not outbound delivery or automatic customer assignment. The message remains unassigned because no verified deal thread exists for that sender.

Deal messages now display separate contact conversations, with each reply form inside its own thread. Previously all contacts' messages were interleaved. Open message panels refresh every ten seconds without overlapping requests; refresh stops when closed and skips requests while the page is hidden. Nested conversation toggles cannot close the parent panel. Failed refreshes retain existing messages and retry. No outbound send, SMS pricing, permission grant or operating-budget change was made for this update.
