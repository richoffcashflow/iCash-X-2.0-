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
