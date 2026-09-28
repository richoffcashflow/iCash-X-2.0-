# Seller to title to closing — operating specification

The bot searches houses and land. The user funds credits, approves a daily limit, and can Pause at any time. Request a legal name or company name only when a real contract is being prepared. Derive an initial market from verified checkout geography where possible; request one short confirmation only if ambiguous. iCash X uses its own provider accounts. No buyer or seller activity starts until production gates pass.

## Stages

Seller interest → approved seller contract draft → signed seller contract → buyer matching → buyer terms review → signed buyer agreement → verified title/escrow opened → deposit instructions sent → escrow confirms deposit → closing scheduled → title confirms closing.

The workflow engine in `lib/closing-workflow.ts` rejects invalid jumps. Each transition in production needs a durable event, tenant and opportunity IDs, evidence pointer, actor/provider, timestamp, idempotency key, and audit trail. A human reviewer or authorized policy must approve terms and exceptions. Vendor webhooks and title confirmations must be authenticated.

## Buyer terms and deposit

- Buyer payment of all closing costs is a **proposed deal term**, never a universal fact. Present it clearly in the buyer's written agreement; do not tell a buyer it applies unless that agreement contains it and counsel has approved the form for the market.
- Any deposit amount, deadline, refundability, default remedy, and exceptions must be in the signed agreement and confirmed by the closing agent. “Nonrefundable” may be conditional or restricted by local law and contract terms. No blanket promise or automatic forfeiture.
- The bot may send only a title/escrow verified payment link or instructions from a trusted channel after matching the title company, transaction, recipient, and agreement terms. iCash X does not take possession of earnest money or change wire instructions.
- Confirm receipt from escrow/title, not a screenshot or buyer claim. Require separate verification for any changed wiring instruction. Never ask a buyer to wire money to iCash X.
- For title coordination, use authenticated email/SMS channels, structured tasks, deadlines, and a human handoff for disputed terms, title defects, legal questions, or closing changes.

## Pause and deadlines

Pause stops new prospecting, calls, SMS/email outreach, offer negotiation, buyer solicitation, and deposit requests immediately. It does not erase signed agreements or legal deadlines. The app must still display deadline and title notices, preserve records, and offer a human escalation/transfer so obligations are not missed. Resume requires the user's action and renewed preflight checks.

## Profit and learning

Prioritize a real seller answer, due follow-up, signed contract, verified buyer response, and title milestone over more cold contacts. Learn from outcomes at each stage with tenant isolation and de-identified aggregate features. Compare cost per qualified seller, signed contract, buyer, title opening, and actual closing. No model may override consent, contract terms, credit caps, margin floors, or user pause to chase a conversion.

## Required reviews

Market-specific wholesaling/assignment rules, buyer closing-cost allocation, deposit language, escrow custody, AI voice and telemarketing consent, state recording consent, title company agreements, and privacy/retention. These rules cannot be replaced by a generic disclaimer.

## Contract preference at the milestone

When a genuine seller contract is ready, ask once: **Review before sending** or **Prepare and send within my approved terms**. The second choice authorizes preparation and sending only. It never authorizes the system to forge a signature or exceed offer limits. Obtain the actual authorized signer’s e-signature through the approved signing flow. Store the legal individual/company name as entered, verify signing authority for entities, and let the title agent confirm vesting before closing.

## Buyer and closing planning additions

`buyer-engine.ts` deterministically shortlists matching criteria confirmed within 30 days, deduplicates supplied canonical entity IDs, scores verified funding/authority and closing outcomes, and budgets a maximum five contacts while protecting a supplied reserve. Discovery before contract is allowed, but deal-package outreach requires a seller-signed agreement and marketing authorization. This is planning code, not a working API integration. Proof of funds and purchase authority must still be checked; a database cash-purchase marker is not proof of present readiness. Keep backups until the buyer's obligations and applicable contract restrictions are resolved; never promise the property to conflicting buyers.

`deal-operations.ts` derives the next step and flags title issues, buyer withdrawal, and approaching or missed deadlines. It separates buyer signature, escrow-confirmed deposit, title, closing and proceeds. A signed deal stays pinned while active; failed/closed deals remain in history. `contactDispatchAllowed` requires exclusive contact ownership and blocks duplicates, human takeover, pause and suppression. Production must acquire the contact lease atomically in shared storage using a normalized, hashed contact identity. Do not expose other tenants' contact records or transaction details. No memory-only lock is sufficient across workers.

Production buyer packages must be generated from verified property facts, authorized photos/documents, evidence-backed repair/value estimates and approved terms, with source dates and missing fields marked unknown. Use a signed-contract/marketing-rights gate before sharing. Package generation and provider contact remain pending. Buyer outcome learning should use confirmed closing performance, never replies alone, and tenant data must not be shared without appropriate rights.

## Callbacks and appointments

`callback-policy.ts` validates a confirmed UTC due time and an IANA seller time zone, blocks early/late dispatch, and rechecks permissions, contact hours, human takeover, pause, reserved credits and exclusive job ownership. Resolve natural phrases against the conversation timestamp in the seller's time zone. Ask for confirmation for ambiguous dates, DST gaps/repeated times, unknown zones, or inconsistent requests. A callback request does not independently prove all required channel permissions.

Persist the original request, normalized time, time zone, confirmation evidence, contact channel, opportunity, version and idempotency key in a durable job. Confirm the local time to the seller and show it on the deal card. Rescheduling supersedes the prior job atomically; opt-out cancels eligible future outreach. Calls and in-person showings are different appointment types: a showing needs confirmed access and attendees. If a job is missed, do not silently call hours late; surface it for review. Reconcile a provider call ID before any retry. Notify about deadline risk even when paid work is paused. The queue, real calendar, provider dispatch and time parsing are not implemented yet; the sample callback is fictional.

## Multiple deals and repeat relationships

`workspace-priority.ts` groups active opportunities for each seller within a single tenant and ranks attention, urgent deadlines, signed deals and closing work ahead of prospecting. Each property keeps its own contract, title file, deposit, deadline, credit reservation and outcome. Never merge legal obligations just because the owner matches. Coordinate outreach across that owner's properties; one conversation owner, no conflicting AI and human contacts. The global contact lease blocks concurrent cross-tenant contact without revealing tenant records. Closed-deal counts require a recorded confirmation time; balances and proceeds still come from separate ledgers.

Production repeat-buyer learning should maintain verified purchase criteria, recent activity, response time, completed closings and failure reasons, with stale data discounted. Customer retention is measured using verified closed outcomes, cost per qualified opportunity, actual support burden, repeat funded use, refunds and net gross profit; do not optimize solely for deposits or increase spending for activity. Preserve useful history and data access, with pause and export available. Multi-deal planning policies are tested but database persistence, learning pipelines and dispatch are not yet connected.

## Property evidence and transparency

Promising leads surface before contract and the signed card remains visible through closing. PropertyMedia accepts a provider photo only after server validation of origin, usage rights and source; absent or broken photos show a neutral placeholder. No stock image is represented as the property. SellerEvidence currently demonstrates fictional contact details, message-style call transcripts and call summaries. Production contact data, summaries, recordings and documents must be tenant-scoped, linked to provider event IDs and authorized for retention/display. A summary must link to its underlying transcript or recording and mark uncertainty. Raw provider payloads, retries, internal scoring implementation and credentials stay in the backend; truthful product milestones and evidence remain available to the user. Never disguise simulated activity as live.
