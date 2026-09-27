# iCash X

Outbound-first wholesaling platform. The customer tries a free bot sandbox, funds iCash X credits, approves a daily spending limit, and can pause work. The bot searches houses and land without asking the customer to select a type. The initial market is inferred from verified checkout geography where possible, with one confirmation only if ambiguous. iCash X owns and operates the DealMachine, Twilio, Blooio, and ElevenLabs integrations. Customers do not configure vendor APIs, lists, campaigns, or prompts.

## State of this repository

This is a Vercel-deployed guided free AI bot sandbox plus tested pure credit allocation and closing workflow gates. The sample deal and $20,000 gross spread are explicitly fictional; the ranking score uses real deterministic code. It has no sign-up, payment processing, live property data, calling, messaging, contracts, or title integrations yet. The preview makes no charges or outreach and shows no fabricated live activity. Do not point paid ads at it as a working autonomous product.

## Deployments

- **Vercel**: Next.js app, authenticated customer API, Meta Pixel/CAPI, payments, and admin rate cards.
- **Railway**: durable worker for property ranking, outreach, follow-up, buyer matching, and title/closing coordination. Worker must be restart safe, idempotent, and fail closed.
- **Database**: tenant-scoped Postgres records, customer credit ledger, provider cost ledger, consent/suppression, opportunity state, event outbox, audit logs, and contracts.

Vercel's `i-cash-x-2-0` project and Railway's `iCash X / worker` service are linked to this repository. Railway runs a standby health endpoint with no job dispatch. There is not yet a shared queue or database connecting the web app to the worker. No vendor credentials belong in git or browser code.

## Operational controls

The `lib/outbound-brain.ts` allocator ranks verified closing and seller intent above cold prospecting, protects a follow-up reserve, applies a daily cap and gross-margin floor, and refuses unauthorized work. `lib/closing-workflow.ts` gates seller contracts, buyer terms, title verification, escrow deposit instructions, and close confirmation. These pure functions do not dispatch any operation by themselves. The production worker must reserve/settle customer credits transactionally with idempotency keys and verify every provider event.

See `docs/cost-model-and-controls.md`, `docs/outbound-brain.md`, `docs/property-data-benchmark.md`, `docs/conversion-and-experience.md`, and `docs/closing-workflow.md`. The customer-facing draft is `/costs-and-disclosures`; counsel must approve final terms and market-specific rules before live outreach.

## Verify

`npm test` checks pacing, authorization, margin, duplicate, reserve, pause, title, deposit, prospect ranking, and schedule gates. `npm run build` validates the Next.js app.
