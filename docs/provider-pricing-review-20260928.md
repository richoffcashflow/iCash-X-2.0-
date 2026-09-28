# Public cost references — reviewed September 28, 2026

These are public pricing references, not account-specific invoices or enabled operation rate cards. All dollar figures are USD. A fully loaded operation quote must add actual usage, fixed-cost allocation, payment processing, acquisition and reserves once each. Unknown does not mean zero. Do not assume every included credit/minute will be used.

| Component | Verified public reference | Accounting treatment |
|---|---|---|
| ElevenLabs Agents | $0.08 additional voice minute; $0.16 burst minute; model usage additional | Disable burst in final live dispatch policy; reserve maximum authorized duration plus LLM/carrier costs. Reconcile cost_fiat including platform + LLM once. |
| DealMachine | Property/contact credits separately metered; account plan/overage determine dollar cost | Use returned credits, plan entitlement, actual billing-period consumption and licensed reuse rules. See existing integration review. |
| Railway | Pro $20 minimum with $20 usage included; memory $0.00000386/GB-second; CPU $0.00000772/vCPU-second; service egress $0.05/GB | Bill is plan minimum or applicable usage, not minimum plus the same included usage again. Allocate actual worker usage. |
| Vercel | Pro $20/month with $20 usage credit; extra seats and usage can add cost | Reconcile plan, seats, compute and traffic; do not assume flat unlimited $20. |
| Supabase | Pro starts $25/month; $10 compute credit in displayed base configuration | Additional project compute, storage, egress and other usage vary. |
| Resend | Pro $20/month for 50,000 emails; extra $0.90/1,000 | Track subscription allocation and billable overage; included sends are not automatically free for margin accounting. |
| Stripe | Standard domestic online cards 2.9% + $0.30; international/conversion extras | $20 domestic-card purchase example costs $0.88, before other fees. Use actual balance transaction fees for reconciliation. |
| GitHub | Team public $4/user/month; Free available | Actual plan/seats/Actions/storage usage required; zero only when genuinely no attributable cost. |
| Twilio | Official US voice page inspected; rendered table did not expose a reliable numeric rate | Obtain account-specific Pricing API rates by destination and features, plus number rental/recording/other enabled components. No guessed rate. |
| OpenAI / ElevenLabs model fees | Model-specific and separately metered | Selected model/input/output/cache tokens required; Agents model charges should follow its actual receipt, not assumed direct OpenAI billing. |
| SMS | Quote pending | Disabled. |
| Title / signing | Provider and commercial terms not connected | Unknown, never zero. |
| Advertising / support / disputes / tax | Not fixed vendor API prices | Actual company inputs and reserves required. Tax planning is separate from the operation cost margin. |

Sources reviewed:
- https://elevenlabs.io/pricing/agents
- https://api.docs.dealmachine.com/concepts/credits
- https://dealmachine.com/pricing
- https://railway.com/pricing
- https://vercel.com/pricing
- https://supabase.com/pricing
- https://resend.com/pricing
- https://stripe.com/pricing
- https://github.com/pricing
- https://www.twilio.com/en-us/voice/pricing/us

## Release status

The 5x fully loaded cost floor and atomic credit reservations are deployed. The deterministic screening queue is separately implemented; it does not enable paid acquisition. Automatic discovery, verified outreach dispatch, e-signature and title provider integrations remain unfinished. A public price reference cannot safely substitute for missing company cash funding, account-specific cost allocations or dispatch integration.
