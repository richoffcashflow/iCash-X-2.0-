# Live fulfillment and launch readiness

## Shipped in this change

The Railway one-use ticket scheduler can dispatch seller qualification calls through the ElevenLabs Twilio integration. It checks fresh financial screening, company identity, explicit contact permission evidence, suppression, local hours, account Stop, manual property takeover, provider configuration review and a full-duration cost quote. A single database transaction claims both the call job and its reserved operation. Existing discovery, enrichment, conversation import and seller-first signing remain in place.

Calls are limited by the configured reviewed cap (maximum 900 seconds). Rate records must declare `voice_max_duration_seconds` covering that cap. Costs must include all existing ledger categories. No rate, funding, contact permission or production template was invented or enabled by this migration.

Callback requests use a per-call capability. An exact future date/time and IANA zone, readback, and confirmation are required. Dispatch additionally requires the completed provider transcript extraction to agree with the saved time. Expired callbacks are held; they do not create catch-up call bursts. A changed callback time or failed tool requires review. Unknown provider outcomes hold the account/contact against another call, including after a process crash. They must be reconciled before release.

The scheduler admits at most one new voice ticket every 30 seconds globally while continuing other work between admissions. This is a conservative rollout limit, not the eventual multi-tenant capacity target. Each account/contact allows one active or unresolved conversation. Existing paid work already accepted by a provider may finish after Stop; Stop prevents subsequent claims. Calls never automatically restart after an uncertain write.

## Production configuration still required

1. Reviewed rate versions for property search, owner enrichment, full-duration seller calls and document delivery. Fund the protected operating reserve separately from customer credits.
2. Licensed discovery configuration per account, with data rights expiry, market ZIP, underwriting reserves and contact credit cap. Enrichment is not permission to call.
3. A dedicated production ElevenLabs agent connected to the owned Twilio line. The existing private practice agent is explicitly rejected. Review the agent prompt, required disclosure, local contact policy, first message, tools, data collection, duration and provider call limits. Store the SHA-256 of the exact `conversation_config` JSON returned by the agent GET API and a review expiry in `icash_voice_configs`. Changed configurations cannot dial until reviewed again.
4. Server tools for `POST /api/internal/voice/callback` and the existing `POST /api/internal/voice/handoff`. Bind their Authorization header to `Bearer {{secret__icash_call_token}}`. Bind conversation identity to the provider's system conversation ID, not untrusted caller text. Include these tool IDs in `required_tool_ids`. Tool definitions must also be reviewed whenever edited; the agent hash does not independently hash external tool bodies.
5. Per-contact permission evidence, expiry, normalized E.164 number and SHA-256 contact key, DNC check, and recipient timezone. Defaults are 9 AM–8 PM; narrower permitted windows can be configured. Do not populate these fields merely because a number was enriched. No contacts were authorized in this release.
6. Approved offer authority per property when an actual offer may be quoted. Preliminary valuation alone does not authorize an offer. No authority means qualification only. Live call contract delivery stays disabled until the approved delivery tool is connected.
7. Approved production signing templates for each supported jurisdiction and scenario. Existing test-only documents do not authorize live contracts.

## Readiness and unresolved implementation

Run `select public.icash_launch_checks();` with service access for configuration checks. Signed-in users can read their own result at `/api/work/readiness`; no provider credentials or contact data are returned. The normal account endpoint uses actual readiness rather than a hard-coded working state.

`lib/launch-readiness-policy.ts` explicitly reports three incomplete capabilities: all-provider cost settlement, buyer outreach execution, and title/closing execution. These are code capabilities, not environment flags. The buyer ranking planner and closing state machine are not live executors. Connecting and verifying those paths is required before removing these blockers. They must not be flipped simply to enable checkout.

Live checkout and daily-plan creation now require the server readiness check as well as existing payment flags. Preview/test checkout remains available. Stop and cancellation remain available while launch is blocked. Existing subscriptions are not changed by this rollout.

Missing evidence also includes Stripe sandbox renewal/webhook verification and a controlled end-to-end live-provider verification. This change made no calls, sent no messages, charged no cards, signed no contracts and consumed no paid voice minutes.

## Reconciliation

For `provider_outcome_unknown_no_retry` or `provider_receipt_needs_reconciliation`, reconcile the ElevenLabs/Twilio receipt and the operation ledger before any release. Never set a held job back to ready to retry it. For a crash leaving `dispatching`, use the same reconciliation procedure. Reserved money is not recognized as actual cost or as a final customer charge. A stopped or rejected pre-dispatch reservation may need release after proving no provider request was accepted; do not release unknown writes.

## Verification

- `node --experimental-strip-types tests/live-dispatch.test.mjs`: mocked adapters, no network.
- `tests/live-dispatch-database.sql`: transaction-only fixtures ending in ROLLBACK; verified against Supabase.
- Existing daily billing, conversation, screening, financial, signing and callback regression tests.
- Production Next.js build.

Migrations: `config/live-dispatch.sql`, followed by `config/launch-readiness.sql`. The scheduler wrapper is a one-time migration; do not rerun its rename statements. Tables and RPCs are service-only with RLS and explicit permission revocation for anonymous and authenticated client roles.
