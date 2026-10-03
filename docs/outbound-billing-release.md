# Outbound completion and billing: disabled review candidate

No live migration, deployment, call, wallet change, tariff approval or price change was performed by this package. The $9.46 staged reservation and all 14 nonprovider allocation decisions remain unapproved for this release.

## Operational path

A once-reviewed `VOICE_USAGE_POLICIES_JSON` policy can serve all correctly bound customer calls using `accountScope: "operation_owner"`. It does not require a human to approve each telephone number. The canonical customer call, operation, job, provider CallSID, destination contact hash, exact agent, provider account and originating number are checked before pricing.

The scalable carrier rule obtains an authenticated Twilio Pricing API tariff for the exact canonical destination and origin, verifies approved country/USD and the tariff ceiling, and persists the first per-operation snapshot. Carrier call duration comes from canonical Twilio Call GET. The media-stream cost uses an explicitly reviewed carrier-duration proxy and separate rounding. A null Calls.price never becomes zero or an actual-cost receipt. The resulting manifest is estimated, with all 16 categories retained and the original captured multipliers/ceiling enforced by the existing financial RPC.

Pricing API costs are current-tariff estimates, not reconstructed historical invoices. The configured maximum lag after terminal call time must be approved. The actual fetch-completion timestamp is checked before snapshot insertion; crossing the window writes nothing. Once stored, retries reuse the snapshot rather than fetch a different rate. The previous per-destination reviewed allowlist remains a bounded alternative, not the all-customer deployment route.

## Dedicated completion/billing scheduler

`/api/billing/outbound` accepts only the existing server CRON_SECRET bearer token (minimum32characters), no query selection. `OUTBOUND_USAGE_BILLING_ENABLED` defaults false unless exactly `true`; disabled mode makes no database/provider calls. The staged cron runs every minute only after publication, but remains inert while disabled.

The private queue enqueues registered live conversations atomically. It selects one globally oldest-due item with SKIP LOCKED, a120second lease and exact account/call/operation binding. This is oldest-due fairness, not equal-share scheduling per tenant. The worker verifies the existing ledger before provider access, so a committed-but-lost response cannot cause another debit. Missing completion delivery is reconciled without customer activity.

The existing canonical completion function may save transcripts, handoffs, opt-out suppression and callback requests as pending_dispatch_review, held or missed. This is intentional completion recovery. The worker does not dispatch calls, run acquisition, fund budgets, unpause accounts or execute callbacks. No callback insert trigger dispatching paid work was found in reviewed source.

Transient failures retry with60–900second backoff. At12failed attempts, including an expired final lease, the queue moves to review with an explicit reason. Invalid policy/evidence also moves to review. Funds are never silently released, canceled or marked zero. Recovery requires an explicit exact-account/call invocation with a reason; it cannot reset an active/completed item. Review queue monitoring and a supported operator recovery workflow are release requirements.

A provider write that was ambiguous before any live-conversation record was created remains an existing dispatch-recovery exception. The scheduler never redials or invents the missing provider identity.

## Required policy approval

The reviewed `OutboundCarrierRule` type is the exact shape. Use the API source with explicit `allowedCountries`, `maxMicrosPerMinute`, `policyVersion`, and `maxPricingLagSeconds`<=86400, shared operation-owner account scope, exact agent/Twilio account/origin, valid review interval, voice minute rounding/minimum, and separately reviewed media-stream rate/rounding/proxy assumption. All other category amounts/zero applicability need evidence, including the proposed40,000micro fixed allocation. ElevenLabs continues to require the bound inclusive USD observation, with separate LLM zero.

Twilio's published US standard outbound$0.014/min and media-stream$0.0044/min do not imply all+1 destinations share that tariff. The Pricing API selects the exact supported route, including a distinct Alaska tariff if country and price cap permit it. Unsupported/malformed/ambiguous routes hold. Static voice.microsPerMinute is required by the type but ignored/replaced in API mode, where a validated rate snapshot supplies it.

Existing seller rate85bb7381-0590-47dc-b70b-f77883ff3b70 and buyer rate1cb9d768-f0e5-4289-b219-5955d24ab148 are not changed. Their946cent reservation is an Alaska worst-case600second planning ceiling with20%buffer, not a flat final usage charge. Current staged expiry is2026-10-07T21:42:00Z. Any cap/rate/duration change requires separate approval and preflight.

## Integration and release order

1. Rebase exact manifest onto verified current main, preserving property-context and readiness changes. Merge vercel.json cron entries rather than replacing unrelated configuration.
2. Independently review and apply only the outbound price-snapshot migration and outbound queue SQL. Neither contains a backfill, policy approval, rate change or debit.
3. Deploy the exact reviewed application patch with flag disabled. Verify current provider/routing/duration configuration separately.
4. Approve complete tariff-selection and allocation policy, publish it for future calls, then explicitly enable the scheduler and intended outbound admission gates. No such approval is supplied here.
5. Verify a genuine allowed completed customer call end-to-end: canonical IDs, policy/rate snapshot, all16costs, one ledger debit, released unused hold and completed queue item. Test pause behavior, late receipt recovery and exhausted-review visibility.

## Tests

- Carrier adversarial tests cover operation-owner scope, exact destination pricing, country/unit/tariff limits, immutable snapshot retry, actual carrier vs shorter agent duration, null price, transient vs binding failures,16category manifest and the fetch-window race.
- Scheduler15scenarios cover tenant binding, completion recovery, ledger-first uncertain commit, retry/review, lease-result ambiguity and auth.
- Native PostgreSQL queue21scenarios cover global concurrent claims, finishCAS, expired leases, attempt12review, private ACL, tenant/party isolation and readback against synthetic operation/manifest/credit/ledger fixtures. These do not substitute for production financial/provider evidence.
- Price-snapshot PGlite tests verify migration, operation/account/conversation binding, first-writer snapshot and service/authenticated permissions.

All tests are local synthetic checks, with no real provider calls or financial changes. Final aggregate/build counts belong in the generated manifest/review report after current-main integration.

## Final integrated validation

Base commit4ee7a1887e6a9c89914b9b3acd2361bb66d54db1. All798 untouched current-main Git blobs were individually verified; all25property-release files and3readiness files remain identical. Integrated157test suites, TypeScript and production webpack build passed. Native queue21scenarios and snapshot SQL tests passed. Existing voice-ledger PGlite tests also passed, with their documented limitation: current fractional/account-margin wrappers and multi-session financial settlement are not exercised by that suite. No production end-to-end call or wallet readback has been performed.
