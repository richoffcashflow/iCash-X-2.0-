# Disabled outbound carrier usage extension

Local implementation only. A new local-only snapshot migration is included; no live migration, rate change, deployment, call, or live write was performed. There is no enabled policy in this package.

The existing `VOICE_USAGE_POLICIES_JSON` entries may opt into `components.twilio.kind = outbound_carrier_estimate`. All other 15 categories remain mandatory; ElevenLabs remains its inclusive USD receipt and LLM must be zero. The complete settlement remains estimated. Existing SQL ceilings, server authority and immutable settlement conflict checks are unchanged.

## Exact policy shape

Use `OutboundCarrierRule` in `lib/outbound-carrier-usage.ts`. Required fields:

- kind: outbound_carrier_estimate
- evidenceRef and snapshotId: reviewed stable identifiers (at least ten characters)
- accountId: exact tenant OR accountScope: "operation_owner" with accountId omitted for explicitly approved shared policy. The tenant is always derived from the account-scoped immutable operation/live call/job chain. agentId and twilioAccountSid remain exact provider identifiers.
- from: exact E.164 caller number; destination: exact E.164 destination for the reviewed allowlist option only (omit for API option)
- reviewedAt, validFrom, validUntil: timestamps, reviewed before call creation and call within validity
- voice: {microsPerMinute: integer, rounding: "up", minimumMinutes: integer}
- stream: {microsPerMinute: integer, rounding: "exact" or "up", minimumMinutes: integer, assumption: reviewed explanatory string}
- source: {kind: "reviewed_destination_allowlist", documentUrl: reviewed HTTPS source URL, reviewer: reviewer identifier of at least ten characters}

No numeric production prices are supplied. Destination pricing must be reviewed from appropriate supplier evidence, including Alaska and other distinct routes. A generic US/+1 rate must not be used.

## Scalable machine-generated pricing snapshots

For automated different destinations under one reviewed policy, use source:

`{kind: "twilio_pricing_api", allowedCountries: ["US"], maxMicrosPerMinute: REVIEWED_INTEGER_CAP, policyVersion: "reviewed-version-id", maxPricingLagSeconds: REVIEWED_WINDOW_UP_TO_86400}`

Omit destination. Each canonical destination must independently match the tenant-bound contact SHA256. The server makes authenticated GET to `https://pricing.twilio.com/v2/Voice/Numbers/{canonicalTo}?OriginationNumber={canonicalFrom}`. The returned destination_number and origination_number must exactly match; currency must be USD and iso_country must be approved. Exactly one outbound_call_prices entry is accepted, with an applicable origination prefix and nonnegative decimal current_price at most the approved cap. Missing, foreign, unsupported, ambiguous or over-cap tariffs hold without settlement. The static voice.microsPerMinute field remains required by the type but is replaced by the validated API rate in API mode; set it to zero to avoid misleading configuration.

No per-phone human review is required in API mode. The once-reviewed policy still binds the tenant, provider account, agent, originating number, countries, tariff cap, voice/stream units, time window and all other costs. An explicitly approved accountScope: operation_owner policy can serve all tenant-bound calls sharing these seller/buyer rate IDs and provider configuration without per-customer manual review. Explicit accountId remains available for a bounded rollout.

The new migration creates an RLS-locked append-only `icash_outbound_price_snapshots` table and service-only insertion RPC. A snapshot is bound to operation/account/conversation/agent/contact, provider SID/account, reviewed policy hash and selected country/rate. First writer wins; every collector rereads and revalidates the persisted snapshot. Repeated settlement therefore never fetches a changed tariff or charges a second time. Changing the policy for an existing snapshot fails closed. No arbitrary provider JSON, destination telephone number or secrets are persisted. The originating business telephone number is persisted as a binding.

This API adapter intentionally uses a fresh post-call current tariff, and remains an estimated cost, not a historical receipt. It does not claim to recover historical pricing. API lookup must occur within the reviewed maxPricingLagSeconds after canonical terminal time (at most 24 hours); older calls hold for review. Persisted snapshots retain fetchedAt and must satisfy the same window, while retries reuse them after that window. It must be deployed with the snapshot migration, reviewed global selection policy and complete approved allocations before enabling automatic settlement. Pre-dispatch quote pricing remains the existing reviewed reserve policy; if final usage exceeds it, the unchanged ledger ceiling holds for review.

The explicitly reviewed exact-destination allowlist remains an alternative. Multiple enabled policies for the same rate fail closed. API mode solves this limitation by selecting each bound destination within one policy.

Official schema verified at https://www.twilio.com/docs/voice/pricing (2026-10-02), including the origin-filtered number resource and snake_case JSON response. No live authenticated preflight was performed here.

## Provider evidence

The collector verifies the tenant-filtered live call's agent/contact hash and operation voice:<job UUID>, loads the tenant-bound job, and requires dispatched job state and matching conversation. Stored job provider_call_sid must equal the authenticated canonical ElevenLabs conversation metadata.phone_call.call_sid. Canonical Twilio Call GET then must match account, SID, exact from/to, outbound-api direction, completed status, terminal end time and nonnegative integer actual duration.

Voice cost uses Twilio actual carrier seconds and reviewed voice billing units. Stream cost explicitly uses carrier duration as a documented estimate, not actual stream duration. The policy snapshot SHA256, SID, duration, rates, rounding and stream assumption are retained in the component evidence. Null or later-populated Twilio Call.price does not change cost classification or create an invented receipt. No destination phone numbers or credentials are written into settlement evidence.

The reconciler passes server-only provider credentials and request signal. Authenticated reads use pinned official HTTPS endpoints, no redirects and bounded bodies/time. Identity/policy mismatches return cost_evidence_incomplete with no settlement RPC. Transient provider HTTP/network failures, incomplete carrier calls, missing terminal duration and not-yet-populated current_price return carrier_usage_unavailable for capped scheduler retries. Complete calls reattempt the collector on each settle attempt, so a missing carrier receipt can be retried without rewriting a transcript.

## Existing staged bounds

This extension does not change seller rate 85bb7381-0590-47dc-b70b-f77883ff3b70 or buyer rate 1cb9d768-f0e5-4289-b219-5955d24ab148, the 946-cent reserve, 600-second maximum, disabled state or October 7 expiry. The 40,000-micro allocation remains unapproved. A 600-second agent cap is not assumed to cap actual carrier duration; SQL quote-ceiling review remains mandatory when usage exceeds the reserve.

## Verification

Run `node --experimental-strip-types tests/outbound-carrier-usage.test.mjs`, existing voice-usage-service tests, `npm test`, and `npx tsc --noEmit`. Unit prices and identities in tests are synthetic, not deployment configuration. No real provider request is made by tests.
