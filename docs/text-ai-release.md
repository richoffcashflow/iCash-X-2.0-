# SMS AI and customer communication prices

A durable incoming-message trigger creates one AI job for an already account/deal-bound thread. Unknown senders remain private and unassigned. The Railway runner consumes single-use capabilities through the existing internal automation endpoint. Generation requires an OPENAI_API_KEY, a reviewed sms_ai operation rate, funded company/customer budgets and an unpaused account/thread/property. Defaults use gpt-4.1-mini, at most 24 messages with 1000 characters each, 800 output tokens, 20 claimed jobs per thread per day. The model receives the deal address, stage, contact timezone and recent message history; not cross-tenant data. No provider retries. Claimed failures retain cost reservations and require review. Usage tokens and provider IDs are recorded, but complete vendor invoice settlement remains unfinished.

The model returns a structured draft, summary, action and exact seller quotes. Unsupported quotes are discarded. Financial/legal/contract/identity questions stay drafts; the model cannot send contracts, agree prices, sign, book appointments, create payment instructions or mark a deal closed. Attachments are not analyzed. Callback requests are visible pending scheduling, never falsely marked booked. Deterministic human/callback detection pauses the thread immediately; model-detected requests also pause it. STOP continues to use the existing global suppression handler.

Thread ai_mode defaults to auto per owner instruction. Routine qualification questions can auto-send only from a fixed server-side list, with first-message AI disclosure. Free-form generated text is review-only. Identical qualification actions are not repeated; at most 12 queued auto replies per thread/day. Permission, DNC, recipient local hours, both budgets, price availability, Pause, manual takeover and freshness are checked before dispatch. New messages supersede pending/drafted responses. No automatic retry of unknown sends. The current live operating budget remains disabled and no sms_send or sms_ai cost rate is fabricated.

Messages expose a compact AI draft/Needs you block inside the existing contact conversation. Draft editing never silently truncates content. No extra customer navigation.

## Owner-selected customer prices
The September 29 supplied screenshots supersede the earlier 2-cent proposal and Twilio-base-only benchmark.

| Communication | Customer rate | Stored USD micros |
|---|---:|---:|
| SMS segment | $0.0208 | 20800 |
| Outbound voice minute | $0.035 | 35000 |
| Inbound voice minute | $0.0213 | 21300 |
| Email | $0.001 | 1000 |

These are exact admin-editable desired communication prices in icash_communication_prices, not claims about Contiguity cost or a bundled AI voice price. Contiguity provider and carrier costs remain unknown. Existing all-provider operation rates were not overwritten. SMS now snapshots the exact 20,800-micro-dollar price when queued. The cost-verified settlement path accumulates fractional cents per account and debits only whole cents, retaining the remainder for later SMS usage. It never rounds every SMS up to 3 cents. Repeated settlement cannot debit twice. Actual provider costs must still be supplied before settlement. Voice and email catalog entries are saved desired transport prices; their duration/unit settlement adapters remain to be connected, and existing bundled operation charges are not changed. No customer was charged in this release.

## Validation
Mock provider tests cover bounded generation, strict schema, quote evidence, human detection and no retries. Rolled-back database tests cover trigger queueing, tenant isolation, cost gates, single claim, safe auto-response allowlist, duplicate prevention, disclosure, callback pause, unknown senders and public privilege denial. No live AI request or SMS send is included in deployment.

Provider references: https://developers.openai.com/api/docs/guides/structured-outputs and https://www.twilio.com/en-us/sms/pricing/us. Rate screenshots are the authority for customer prices.

Fractional billing validation: 13 SMS segments at $0.0208 produced exactly $0.2704 of usage, a $0.27 wallet debit and $0.0004 carried forward. All fixtures were rolled back; duplicate settlements made no extra debit.
