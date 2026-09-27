# Seller to title to closing — operating specification

The user chooses Houses or Land, provides a legal name or company name for contract preparation, funds credits, approves a daily limit, and can Pause at any time. Derive an initial market from verified checkout geography where possible; request one short confirmation only if ambiguous. iCash X uses its own provider accounts. No buyer or seller activity starts until production gates pass.

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
