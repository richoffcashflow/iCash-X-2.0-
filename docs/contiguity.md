# Contiguity connection

Verified against official API docs 2026-09-28. Business-owned secret: CONTIGUITY_API_KEY (Production and Preview). API key presence alone is not account readiness.

## Available
- Read-only GET /numbers/leased preflight, outputs authentication and counts only.
- iMessage payload requires explicit sender; fallback.when is always empty; fast_track false.
- Test-only sender requires ICASH_CONTIGUITY_TEST_SEND=true plus exact CONTIGUITY_FROM and CONTIGUITY_TEST_TO. Not exposed by any web route. No live send was authorized or performed in setup.
- HTTP acceptance is not delivery; returned message_id must be persisted before reconciliation. No automatic retries, including timeouts, since provider idempotency is not established.
- Raw-body HMAC verifier using Contiguity-Signature with 300-second tolerance and constant-time comparison. This is a verifier, not an installed webhook endpoint.

## Activation prerequisites still outstanding
Active iMessage leased sender, account entitlements, server-side tenant/sender mapping, durable send job with credit reservation and suppression/pause checks, signed webhook inbox with deduplication and conversation routing, delivery/cost reconciliation, and explicit approved test recipient. No tenant route can currently send messages. No live acquisition enabled.

Configure webhook signing in Contiguity Console > Tokens > Webhook Signing, using CONTIGUITY_WEBHOOK_SECRET on the server. Do not configure a callback URL until the durable receiver is deployed. Provider webhook retry behavior and exact event payloads must be verified before activation. Never acknowledge and discard incoming seller replies.

Run: node --experimental-strip-types scripts/contiguity-preflight.mjs
Test: node --experimental-strip-types tests/contiguity.test.mjs

Official sources:
https://docs.contiguity.com/api-reference/product/leases/leased-all
https://docs.contiguity.com/api-reference/product/imessage/send
https://docs.contiguity.com/api-reference/webhook/signing

## Auth verification follow-up
2026-09-28: the introduction specifies Token while generated endpoint docs specify Bearer. A Vercel read-only check using Token authenticated successfully: GET /entitlements/ returned 200 and zero granted entitlements; GET /numbers/leased returned 403. Adapter now uses the verified Token format. A failed leased-number check alone does not establish an invalid key or absence of a leased number. No messages sent. Account access to leasing/iMessage remains unverified.

## September 29 SMS/MMS update
The earlier iMessage-only limitations above describe the previous release. See text-messaging-release.md for the new SMS/MMS transport, signed receiver, private inbox, STOP handling, spend gates, and remaining live configuration requirements.
