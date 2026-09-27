# Outbound brain — product and worker specification

The customer funds an iCash X balance. The bot searches both houses and land, selecting records and deciding the next action. A verified billing ZIP or market signal can suggest the first market; ask one short question only when the market is ambiguous. The customer does not manage lists, campaigns, prompts, or providers.

## Optimize for closed deals, not activity volume

The ranking layer combines estimated equity, property condition, explicit seller intent, buyer fit, contactability, freshness, and actual stage outcomes. Missing or stale evidence lowers confidence; it never becomes a fabricated high score. The credit allocator prioritizes signed contracts, title and buyer work, interested sellers, and due callbacks over cold prospecting. It applies the user's daily cap, a protected follow-up reserve, and a provider-cost margin floor. A response or closing is never guaranteed.

Use exploration for new property segments, but measure incremental cost per verified seller conversation, qualified seller, contract, interested buyer, title opening, and actual closing. Compare by market and property type without sharing identifiable seller data between tenants. Do not train from mere clicks or falsely labeled conversions. Start with deterministic rules; tune weights from enough verified outcomes, holdout evaluations, and failure analysis. Pause rollout on cost or compliance regressions.

## Work schedule

Offer **Standard hours** and **24/7 analysis** after funding. 24/7 means background data analysis and permitted non-contact work can run outside ordinary hours. It may use more credits only within a separately shown and authorized daily cap. Outbound calling/texting obeys the contact's local legal window, consent status, suppression list, and channel policy regardless of the user's mode. Missing jurisdiction/consent information blocks the contact. Pause stops both research and outreach, except essential deadline notices and audit records.

## Buyer outreach and channel release

Seller-facing outreach must identify iCash X and its actual role as a prospective property buyer or authorized representative. It must not claim to sell a service to the owner or conceal the nature of the contact. The fact that iCash X seeks to buy property does not, by itself, authorize AI-generated voice calls or automated SMS. The FCC treats AI-generated voices as artificial/prerecorded voices under the TCPA. Keep AI cold dialing and automated texting disabled by default until counsel approves a jurisdiction and channel-specific policy, including the required consent or applicable exemption, number type, do-not-contact suppression, identification, local hours, and recording consent. A contact's opt-out immediately suppresses further outreach on the relevant channels. Re-evaluate the policy at every attempt; never infer permission from public owner data. Maintain evidence and a policy version for each decision.

An optional later inbound path can accept seller-initiated calls or responses and offer a clearly disclosed AI conversation. Capture separate, specific, revocable permission for subsequent AI-generated outbound calls and texts, with the exact language, timestamp, channel, number, seller identity, and evidence retained. An incoming call or a generic interest in selling is not blanket consent for future AI outreach. Keep this path outside V1 prospect acquisition until counsel has reviewed the flow and recording requirements.

## Photos, repairs, equity, and signers

- Photos and seller-described condition produce an **estimated repair range with confidence and evidence links**; they do not prove structural condition or determine a final price by themselves.
- Equity is an estimate from approved property data, liens, and any voluntarily supplied payoff. Verify with title and seller before relying on it. Do not claim a precise payoff from a rough model.
- Ask whether every legally required owner or signer is involved when a real opportunity reaches an offer. Do not assume every spouse must sign or that one person can bind all owners. Verify vesting and signing authority with title/counsel.
- Show a concise "Needs you" task only when authorization, material terms, or a legal signature is required. The app can prepare and send approved forms; an authorized person signs.

## Reliability

Railway worker pulls durable queued jobs. Each job has tenant ID, property/opportunity ID, evidence snapshot, due time, consent decision, policy version, expected cost, user credit reservation, and idempotency key. Recheck all gates immediately before dispatch; lock the job; use retry/backoff and dead-letter status. Twilio, Blooio, ElevenLabs, and DealMachine credentials remain server-side in iCash X accounts. Webhooks are authenticated and deduplicated. Persist all genuine movements to the activity feed. Never synthesize seller replies or status events to increase engagement.
