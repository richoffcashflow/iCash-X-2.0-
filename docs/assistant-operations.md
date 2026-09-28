# Assistant identity and operating boundaries

Implemented: tested pure policy functions in lib/assistant-policy.ts and an explicitly fictional Alex identity in the sample conversation. These are not connected to a database, voice agent, provider dispatcher, or signature service yet.

## Identity
Use the shared name Alex for every customer and every call. Customers do not configure the assistant name. Bind it to the verified legal buying entity or sole proprietor. Outbound caller number and reply email must belong to the configured business route. Never impersonate the customer or claim to be a human. The sample introduction identifies the assistant as AI. Channel-specific disclosure and contact eligibility must be reviewed before enabling real outreach. Contract parties remain verified legal entities, never the assistant persona.

## Conversation and property memory
Require tenant and deal scope on facts, offers, documents, callbacks and actions. Returning callers must be resolved using verified contact records; a shared phone number is not enough to merge records. Ask which property when ambiguous. Store facts with source evidence, verification state and expiry. Seller statements are attributed statements, not verified ownership, funds, repairs or title facts. Unknown answers trigger clarification or a review task.

Maintain separate callback jobs with confirmed time zone, due time and promises. A statement about tomorrow is not a scheduled job until confirmed and durably saved. Multiple properties owned by one seller can share a contact thread, but no offers, funds, title files or signatures are merged.

## Authority and handoff
Offer limits use integer cents and expiring authorization. Verify ownership and all required owners before sending contracts; signatures require a separate explicit authority check and approved documents. A ready policy decision alone does not grant signing power.

Human takeover pauses automated dispatch immediately. Resume requires an explicit release plus acknowledgment of the latest conversation version. Atomically recheck that version when claiming a send operation to avoid a racing human reply.

## Dispatch integration required
Use authenticated server context, never browser-supplied tenant IDs or policy booleans. Obtain a shared atomic lease for the canonical contact across customers without disclosing other tenants' identities or conversations. Check suppression, contact permission, hours, available credits and idempotency before every dispatch. Bind the lease, spend reservation and outbox event in a transaction; use provider idempotency and reconcile uncertain sends before retrying. Recheck authorization after delays. Release reservations for confirmed non-dispatches.

## Multiple active deals
Keep every signed deal pinned, surface urgent decisions and approaching closing deadlines, then promising leads. Reserve follow-up capacity for existing obligations before new acquisition. Show only source-backed stage changes. Title confirms deposits and closing; confirmed proceeds are separate from projected spreads. Failures create actionable review items rather than synthetic progress.

## Launch blockers
Durable tenant-isolated storage; verified business onboarding; provider integrations; canonical contact leases; suppression/permission evaluation; durable callback queue; transactional credit reservations; approval records; signature/title integrations; audit events and operator alerts. This commit does not enable live outreach or contract execution.
