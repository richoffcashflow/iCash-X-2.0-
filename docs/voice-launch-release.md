# Voice routing and callback integrity — 2026-09-29

## Delivered

- `POST /api/internal/voice/inbound`: ElevenLabs conversation-initiation webhook with a separate server-only bearer secret, strict input validation and no-store responses.
- Calls bind to an enabled called-number/agent route, an unchanged reviewed provider agent, and one account/property/party matching the public SMS number and caller. Ambiguous, unknown, suppressed, paused, test or unconfigured calls fail closed.
- Service-only routing and receipt tables; idempotent call-SID + conversation binding. Wallet, company limits and configured full-call cost reservation precede registering the call. Replays cannot debit twice or move a call between tenants.
- Incoming mode collects caller-provided information only. Caller ID is not authentication. It does not reveal stored messages, account information, private negotiation terms, or quote an offer. After provider reconciliation, a handoff asks the owner to verify the caller/property. This is safe intake, not fully autonomous inbound negotiation.
- Existing result polling saves incoming summaries; existing per-call callback/handoff tools work. Incoming callbacks remain held for verification. No new incoming call grants outbound contact permission.
- Outbound dispatch now releases a reservation only when the same worker atomically holds an operation that has not reached provider dispatch. Unknown provider outcomes retain their reservations and cannot be automatically retried.
- Confirmed post-call times update provisional callback times. Unconfirmed requests cancel provisional bookings. A callback outside contact hours is held rather than silently moved 30 minutes.
- Existing seller-first signing, exact-document auto-signing, buyer matching and verified closing workflows remain intact.

## Connection steps still required

1. Contiguity forwards +14243948384 to the purchased Twilio +17816093521, preserving caller ID. This is not configured by code deployment.
2. Provision/review a separate production ElevenLabs agent. Do not reuse the private practice agent. Configure callback and handoff server tools with Authorization `Bearer {{secret__icash_call_token}}` and conversationId from the provider's conversation ID. Tool endpoints are `/api/internal/voice/callback` and `/api/internal/voice/handoff`; their route schemas are authoritative. Use at most 600 seconds initially (900 absolute maximum).
3. Register the provider agent/phone/tool IDs, exact conversation-config SHA-256 and enabled current per-account voice configurations. The shared outward caller ID must match Contiguity. Identity/selected voices must be approved.
4. Add current seller_call, buyer_call and incoming_call rates covering the entire call duration, ElevenLabs, telephony, LLMs if separately billed, and allocated overhead. No voice rates existed at this release inspection. Do not make up account-plan pricing.
5. Add a random 32-byte-or-longer `ELEVENLABS_INBOUND_WEBHOOK_SECRET` to Vercel. Configure ElevenLabs workspace conversation initiation URL to `https://www.geticashx.com/api/internal/voice/inbound` and header `Authorization: Bearer <same secret>`. Enable fetching initiation data for the production agent and required prompt/first-message/duration overrides. Do not configure a fallback agent to reveal data, negotiate or use tools if the webhook fails. Verify provider failure behavior before activation.
6. Add the enabled inbound route, linking the purchased Twilio number, Contiguity public number, reviewed agent, incoming rate and expiry. Bind the purchased Twilio number to that agent in ElevenLabs. Verified outbound caller IDs alone cannot accept inbound calls.
7. Validate a real end-to-end call only with owner authorization for paid minutes. This release places no calls or sends messages.

These are deployment prerequisites, not customer onboarding settings. This release does not enable global automation, change funding mode, fabricate cost settlement, move deposits, create signed agreements, or claim closing proceeds. No 100k-user load test was performed.

## Verification

- TypeScript and focused voice, callback, signing, closing and cost-policy checks.
- Rolled-back database fixtures: timestamp correction, cancellation, one-time reserve release, uncertain-call protection, caller/agent/role matching, replay identity, duplicate reservation protection, and service-only access.
- Existing contract/closing database checks verify signing order, test isolation and evidence-bound closing transitions.
- No paid provider requests in fixtures.

Provider reference: https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/customising-calls
