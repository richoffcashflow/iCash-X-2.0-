# Seller hard stops and clear cash-purchase identity

The owner requested immediate termination and removal from outreach when a seller strongly rejects the inquiry, invokes DNC, threatens legal action over the contact, or directs hostile abuse at the caller. A follow-up is appropriate only when the seller remains open to a sale and actually agrees to the next step. Ordinary introductions should say assistant and explain the cash purchase; a direct question about AI still receives a brief truthful answer.

## Behavior

- Source-word hard stops take priority over identity, price, and callback questions in the same or later turns. Do not answer further questions, keep pitching, invite later contact, or create a callback after a hard stop.
- Runtime seller instructions use the existing exact-call recording stop tool immediately, followed by native `end_call` if necessary. The outbound registration boundary includes already prepared, limited, intake, and cancellation seller contexts; matched inbound and instant-lead role instructions receive the same stop policy. Frozen provider policies and their fingerprints remain intact.
- Permanent contact suppression is based on the authenticated original seller message or canonical call transcript, never a model-authored disposition flag or the fact that recording stopped. The existing source observer revokes contact eligibility, stops queued automatic work, and preserves original uncertain provider operations.
- A reproduced gap allowed automatic SMS admission after the carrier ended but before the seller transcript arrived. A prospective durable wait now binds the stop request to the exact account, phone, call, and source. Final automatic voice/text/AI admission waits for the canonical result; automatic email uses the existing exact assigned phone/email mapping. The source observer persists any suppression before resolving the wait in the same transaction. Original unknown results remain unresolved for that contact; unrelated contacts continue. Resolved receipts survive call-history retention. Existing manual/cancellation boundaries remain unchanged.
- Ordinary questions about title, lawyers, contracts, a price objection, a busy seller, or profanity about repairs do not by themselves establish hostile rejection. A plain no to selling still ends pursuit. No to ownership ends the property inquiry; no to repairs or a specific price stays contextual.
- An ordinary identity answer names the actual saved principal/company and explains the possible all-cash purchase. It does not claim to be the company owner, a human, or physically local without evidence. Direct AI questions are answered honestly before continuing with an interested seller. Interest is separate from ownership and authority to offer or sign.

## Release and verification

Apply only independently reviewed database changes after local source/parity/integration tests, recording exact migration receipts and readbacks. Preserve historical copy and learning attribution; new identity copy uses its prospective cutover. No retrospective seller outreach or paid development calls/texts are part of this change.

Production installation receipts are `20261115213627_seller_hard_stop_policy`, `20261115213630_seller_assistant_identity`, and `20261115213633_seller_terminal_receipt_wait`. Readback confirmed hard-stop classification, ordinary legal/repair/price exclusions, private execution/table grants, zero initial terminal waits, and a NULL identity-copy cutover. The original source observer tests and native PostgreSQL 17.11 stop/result/final-send races passed before installation. This is database verification, not an application deployment claim.

Follow the existing automatic release process: exact-head canonical Reliability checks, expected-head merge, exact-main checks, and matching production web/worker verification. Offline transcript and transport fixtures demonstrate code behavior and prompt assembly, not perceived audio quality, live hang-up latency, or a real delivered follow-up.

After verifying the exact web/worker release, activate only the fresh identity-copy cutover once:

```sql
update public.icash_seller_progress_settings
set identity_purpose_enabled_at=clock_timestamp()
where id=1 and identity_purpose_enabled_at is null;
```

Read back the resulting timestamp. Do not reset an existing cutover or replay earlier incoming messages. The source-word hard-stop policy and prospective terminal waits require no outbound activation or historical backfill.
