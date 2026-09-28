# iCash X cost model and operating controls — working draft

**Status:** Provider pricing, DealMachine terms, and checkout rates have not been finalized. Do not enable funding or outreach based on this draft. All vendor accounts are owned by iCash X. Users do not supply Twilio, Blooio, DealMachine, or ElevenLabs credentials.

## Ledger design

For every operation, store an immutable customer credit reservation/settlement/refund and a separate actual provider cost entry. Key both to tenant, opportunity, operation, provider, currency, versioned rate card, and an idempotency key. Reconcile provider invoices and webhooks to the cost ledger. Gross profit = settled customer credit charges minus actual provider and directly attributable processing costs. Report margin by operation, connected call, qualified seller, contract, and closed deal. Never describe customer credits as a pass-through of vendor cost.

## Cost worksheet (fill from signed terms and current invoices)

| Operation | Raw vendor | Vendor unit/cost | Customer credit charge | Expected margin | Status |
| --- | --- | --- | --- | --- | --- |
| Property search/detail | DealMachine | TBD | TBD | TBD | Docs and contract needed |
| Owner/contact enrichment | DealMachine or approved source | TBD | TBD | TBD | Docs and reuse rights needed |
| AI outbound call attempt | Twilio + ElevenLabs + LLM | Per attempt and connected minute TBD | TBD | TBD | Sandbox and invoices needed |
| SMS | Twilio or Blooio | Per segment, carrier fees TBD | TBD | TBD | Route and registration needed |
| Follow-up email | Email provider | TBD | TBD | TBD | Provider needed |
| Contract generation/signature | E-sign provider | TBD | TBD | TBD | Provider needed |
| Payment processing | Processor | TBD | Included in gross-margin model | TBD | Processor needed |
| Hosting and data | Vercel + Railway + database | Usage based TBD | Allocated overhead | TBD | Projects needed |

Sources to verify when configuring rates: Twilio [US voice pricing](https://www.twilio.com/en-us/voice/pricing/us), [US SMS pricing](https://www.twilio.com/en-us/sms/pricing/us), and [Voice Pricing API](https://www.twilio.com/docs/voice/pricing); [ElevenLabs pricing](https://elevenlabs.io/pricing). DealMachine and Blooio actual contracted/API prices must be provided and verified before values are entered. Refresh rates from signed plans/invoices rather than assuming public list pricing applies.

## Default pacing policy for testing

The pure allocator in `lib/outbound-brain.ts` currently caps one day at the lesser of the user's limit, 15% of the funded amount, and 12% of the current balance. It protects 25% of the funded amount from new prospecting, but can use that reserve for actual active deals. If an active opportunity exists, cold prospecting receives at most 30% of the remaining daily capacity. These are **initial experiment settings**, not a promise of deal timing or a replacement for a user's explicit limit. Admin configuration must replace code constants before launch.

Prioritize closing, contract, buyer response, seller interest, and due follow-up over new prospects. Only schedule actions with a real underlying event, verified permission, a due time, a unique ID, sufficient reserved customer credits, and estimated provider cost beneath the configured gross-margin ceiling. Never increase spending just to create movement in the app. Display real milestones and useful next actions; no fabricated activity or artificial urgency.

The server must perform an atomic reservation before dispatch and a single settlement/refund after the provider outcome. Retry only with the same idempotency key. Stop prospecting at the reserve, stop all paid work at the user's cap or zero balance, and alert the user when active work is paused. Refill only after explicit opt-in.

## Review gates

- Verify DealMachine data licensing, API pricing, caching/reuse, and request limits.
- Verify Blooio/Twilio routing cost, sender registration, deliverability, opt-outs, and failover.
- Verify ElevenLabs connected-call billing and voice consent requirements.
- Model chargebacks, refunds, taxes, payment fees, and free-user costs.
- Run cohort sensitivity cases at multiple answer rates, talk times, data hit rates, conversion rates, and buyer close rates before setting credit charges.
- Have counsel approve the final state-by-state wholesaling, AI voice, calling, texting, recording, and contract policy before live outreach.

## Official legal references for counsel

- [FCC ruling on AI-generated voices and TCPA](https://www.fcc.gov/document/fcc-confirms-tcpa-applies-ai-technologies-generate-human-voices)
- [FTC Telemarketing Sales Rule](https://www.ftc.gov/legal-library/browse/rules/telemarketing-sales-rule)
- [FTC Do Not Call guidance](https://www.ftc.gov/business-guidance/resources/qa-telemarketers-sellers-about-dnc-provisions-tsr-0)
- [Texas Real Estate Commission on equitable interests](https://www.trec.texas.gov/article/sale-equitable-interests-real-estate-clarified)


## All-in allocation guard (2026-09-28)

The pure allocation engine now requires a current, versioned cost quote and a configured company spending budget/protected reserve for every action. Unknown cost categories, expired quotes, insufficient company funds or a margin below the configured floor hold the operation. Customer credit reservations and company cost reservations are separate outputs. Sub-cent costs are represented in USD micros and rounded up only after aggregation and a configurable contingency buffer. The margin floor now applies to the buffered full cost allocation, not just the direct vendor charge; call it an all-in contribution target rather than accounting gross margin.

Required categories: DealMachine, ElevenLabs, Twilio, SMS/iMessage provider, email/Resend, OpenAI/other LLMs, Vercel, Railway, Supabase, GitHub, payment processing, title/e-signatures, support/shared overhead, paid acquisition, refund/dispute reserve and other. Zero is permitted only when a reviewed rate configuration establishes no attributable charge (for example, a bundled LLM already counted under ElevenLabs). Missing values must be null and block dispatch. Do not double count bundled charges. No account-specific prices or invoice amounts have been invented.

Monthly minimums, seats, phone-number rental, storage, egress, build minutes and idle infrastructure belong in the company budget even when no customer is active. Allocate a conservative share to operations using realistic usage, not hoped-for volume; reconcile actual invoices and avoid counting the same cost twice. Funding is not earned profit: unconsumed credits, processor fees, refunds/chargebacks, taxes and outstanding vendor liabilities must remain covered by a cash reserve. Include paid failed attempts and unreconciled requests. Unknown outcomes retain reservations; settlement needs provider receipts and idempotency.

**Launch blocker:** these are tested allocation policies, not a connected all-provider billing collector. Actual invoices, rate configuration, shared-cost allocation, atomic company/customer reservations, settlement and dispatch-time rechecks must be connected before autonomous outreach. Private acceptance tests retain their existing small session allowance and do not use customer wallets. The policies do not stop an external provider's recurring subscription or guarantee profitability.


## Connected reservations and observations (2026-09-28)

`lib/operating-costs.ts` now calls service-only Supabase RPCs for atomic company + customer reservations, a one-time dispatch claim, and idempotent settlement. The database enforces immutable versioned rates, complete categories, contingency buffer, all-in margin floor, customer daily limit, company daily limit, protected cash reserve, pause status, permission expiry and a recent eligible financial check for seller calls. All locks begin with the company budget row to serialize reservations. Provider timeouts retain both reservations. An undispatched operation can be cancelled for zero; a dispatched operation requires verified settlement evidence. An actual overrun or actual margin-floor breach records the cost and puts the operating budget on hold. Real cost overruns are recorded even when they exceed funding; reporting liabilities honestly takes precedence over hiding a negative economic result.

Private voice results now record ElevenLabs `cost_fiat` receipts idempotently. Official conversation docs define that value as USD including platform and LLM cost, so do not add the bundled LLM cost twice. DealMachine property lookups record reported provider credit units separately; those are not converted into dollars until account billing is verified. Existing verified voice results have been backfilled. Observations are unreconciled until checked against billing; they are not a full call cost or earned margin.

The production operating budget starts disabled, with zero configured funding and no invented rates. Railway remains in standby. The new server dispatch wrapper is ready for real provider adapters; those live seller adapters and durable jobs are not enabled. No new customer-facing settings were added. To release live work, populate reviewed rate versions from actual account bills/terms, allocate company cash and protected reserves, connect complete receipt settlement and provider permission checks, then enable the specific tested channel. The connected tools do not expose all required vendor billing invoices; account-specific rate verification remains open.

Database verification: rollback-only fixture tests cover duplicate reserves, missing underwriting, budget exhaustion without customer-wallet mutation, pause-before-dispatch, duplicate dispatch, duplicate/conflicting settlements, cancellation release, overrun circuit breaker and conflicting cost observations. All cost tables have RLS enabled and no anon/authenticated access. No live calls or customer charges were made during verification.


## Owner profit planning

The owner-selected tax planning reserve is stored in `icash_operating_budget.tax_reserve_bps`, initially 3500 (35%), and can be changed without deployment. It is not a statutory tax rate or a bank transfer. `ownerProfit` separates earned revenue, operating costs, marketing, EBITDA, interest/depreciation, estimated pre-tax profit and a reserve on positive profit. Marketing is subtracted before computing this planning reserve. Actual taxable income and timing can differ from this management estimate. IRS guidance: https://www.irs.gov/businesses/small-businesses-self-employed/estimated-taxes .

Estimated available cash is limited by both remaining profit and cleared cash after unspent customer funds, unpaid bills/commitments, protected reserves and the tax reserve. Input balances and obligations must cover the same reconciled period without overlapping amounts; prior distributions reduce the profit limit. Missing numbers return unavailable, never invented profit. Operating cash funding is not a verified bank balance. No owner profit dashboard or withdrawal is enabled until bank/processor balances and complete costs are connected.

Receipt retry comparisons use USD micro precision while retaining original evidence, preventing harmless JSON floating-point differences from becoming false billing conflicts. The shared REST adapter accepts empty successful RPC responses (204). Both cases have regression coverage.


## Current pricing policy: 5x fully loaded cost

The owner approved an 80% all-in pre-tax margin floor (minimum price = 5 × buffered fully loaded cost). The authoritative database setting is `minimum_margin_bps=8000`; both reservation and actual settlement checks use it. The allocator default matches and uses integer comparisons so an exact 80% margin is not rejected by binary floating-point rounding. `minimumCostBasedCharge` calculates a proposed minimum price from the reviewed cost and database margin configuration. Unknown costs still block work. Pack face values and customer balances are unchanged; this is an operation-pricing rule, not a promise of a deal or actual realized profit.

The fixed company daily dollar cap is now disabled with `daily_limit_micros=NULL`. This is not unlimited spending: company funded cash, protected reserves, customer available credits, customer daily pacing/limits, financial screening and outreach authorization remain required. A zero cap still means stop; a positive cap can be restored through admin database configuration. The operating engine remains disabled until rates, available cash and live channel dispatch are configured.
