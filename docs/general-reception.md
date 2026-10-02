# Existing-number reception test candidate

Local code only. Installation is disabled by default. This initial path takes an
unverified message from any caller on the one verified existing business number;
it does not disclose stored properties, continue contracts, send messages, schedule
callbacks or create outbound permission. Main and the old owner tests are untouched.

## Installation and funding

Apply `config/general-reception.sql`, then
`config/general-reception-customer-funding.sql`. The second migration is mandatory:
runtime refuses the old business-only envelope. It uses the existing customer
wallet/operation ledger for the fixed account, pinned incoming-call rate and a hard
65-cent customer reservation for a maximum 60-second test. No credits are added,
no daily/lifetime budgets are raised and no account is globally unpaused.

The explicit inbound-only opt-in permits only the exact privately admitted
reception operation while outbound remains paused. The existing paid activation,
wallet balance, daily limit, rate and claim guards remain authoritative. Admission,
credit reserve, operation claim and CallSID/nonce receipt are one transaction.

The 65 cents is a customer reservation ceiling, not proof of the actual provider
invoice. The current rate is a planning estimate. Provider cost/margin remain
unverified until independently bound receipts are available. Missing or uncertain
costs retain the reservation; this path never automatically increases the charge,
refunds unknown work or settles from an LLM summary.

## Provider setup and release

- Review a NEW dedicated branch of the fixed existing agent. Never reuse Main or
  the expired owner-test branch. Use the exact exported receptionGreeting/prompt,
  60-second duration, max_tokens120 (runtime accepts 1–150), no external tools/KB/
  MCP/executable workflow/procedures, μ-law8000 input/output, recording off,
  authentication on, concurrency1, queue/burst off and initiation callback off
- Read back the full reviewed configuration hash/version and freeze the branch
  operationally. Register-call selects a branch, not an immutable version; a
  preflight hash is not provider-enforced version pinning
- Initial test uses receipt_mode=provider_readback: the authenticated owner control
  finds the exact server-issued user_id through ElevenLabs, then GETs the unique
  conversation and terminal Twilio call using existing credentials. It requires
  exact nonce/CallSID/agent/branch/version/carrier binding. No new webhook secret
  is needed. Optional signed webhook handling may reuse a valid post-call HMAC;
  NEVER substitute the initiation bearer secret
- After authorized deployment/SQL/provider review, explicitly enable the reviewed
  incoming rate, inbound configuration/opt-in and RECEPTION_ENABLED. Set the exact
  Twilio Voice URL to https://www.geticashx.com/api/reception/inbound, and both
  applicable fallback routes to /api/reception/fallback. Preserve original routing
  for rollback. Check TwiML application precedence. No native AI bypass/fallback
- Run the authorized real test to establish audio, 60-second termination, receipt
  binding and measured charges. No live acceptance test is claimed by this patch

## Admission and completion

All Twilio form fields participate in HMAC validation against the fixed canonical
URL. Verify account, called DID, inbound direction, new ringing CallSID, and a
fresh independent Twilio receipt. Caller ID is only a throttle/routing hint.
Provider preflight and all writes share a 12-second deadline. SQL deduplicates
CallSID/nonce, serializes one call at a time and applies caller throttling.

Only the admitted receipt holder calls register-call once, then returns its raw
XML response. Every refusal/fallback emits Reject first, before answering. There
is no custom audio relay. Register-call does not support native call transfers.
Rejected Twilio calls are not a guarantee of zero upstream Contiguity fees.

Authenticated provider readback (or a separately configured signed postcall) must match the server nonce, CallSID, agent, actual
branch/version and one conversation. Only nonblank caller utterances are retained
as UNVERIFIED intake; no customer identity/property ownership/consent is created.
Unknown registration or missing terminal receipt retains both budget and the
concurrency lock for operator review. No retry may create a second AI session.

## Follow-on scope

`inbound-value-policy.ts` is a separately tested preflight, not wired to live calls:
verified DID-account mapping; unique property match counted before eligibility;
fresh numerical underwriting; existing customer credits/daily allowance; real
signing-envelope/active-deal priority; polite cutoff for actual nonprogress, with
legitimate property/price/process questions answered briefly. No question-count
cutoff or profit guarantee. Ambiguity/stale evidence cannot charge a guessed
customer or discard a good seller as a bad property. New leased-number routing and
full customer/deal continuation need their own integration and tests.

## Verification and sources

Run npm test, TypeScript noEmit and npm run build. SQL tests run actual candidate
SQL locally via PGlite; serialized PGlite is not independent-session Postgres lock
contention proof. With shared node_modules, Turbopack needs a temporary common-root
override; restore it and do not commit the workspace-specific path.

Official contracts reviewed:
- https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/register-call
- https://github.com/elevenlabs/elevenlabs-js/blob/main/src/api/resources/conversationalAi/resources/twilio/client/Client.ts
- https://elevenlabs.io/docs/api-reference/agents/branches/list
- https://elevenlabs.io/docs/eleven-agents/workflows/post-call-webhooks
- https://www.twilio.com/docs/usage/security
- https://www.twilio.com/docs/voice/twiml/reject
- https://www.twilio.com/docs/usage/webhooks/webhooks-connection-overrides
