# Outbound enforcement: one entry point to the actual code

Source audit: **2026-10-01**, deployed code baseline **c5015233de631b93267a671ef1478a19b893ec85**. This file documents implementation and observed readiness; it does not activate outreach or certify legal compliance. Configuration and evidence can expire after this snapshot.

## The executable switch

Start with [`lib/live-work-admission.ts`](../lib/live-work-admission.ts). It contains the shared application channel switches and automation-ticket admission:

- `liveWorkReady`: full-work release requires the literal string `ICASH_LIVE_WORK_READY=true`
- `smsWorkEnabled`: SMS may be released independently with `ICASH_SMS_WORK_READY=true`
- `discoveryWorkEnabled` and `contactWorkEnabled`: independent, paid property/contact research gates
- `automationWorkReady`: the independent exceptions cover only `seller_opener`, `discovery`, and `contacts` tickets

At the audited baseline, [`dispatchLiveVoice`](../lib/live-dispatch-service.ts) still repeats the full-work flag check directly. SMS dispatch uses the shared module. A local, behavior-preserving consolidation of these application checks is being prepared; it is **not deployed by this document**.

An enabled flag is only the first gate. It cannot create contact permission, release a campaign, resume an account, reserve money, approve an offer, or satisfy provider configuration.

## SMS: exact enforcement chain

| Requirement / decision | Classification | Actual enforcing code |
| --- | --- | --- |
| SMS channel enabled; provider API/webhook configuration present | Application release / configuration | [`smsAccountReady`](../lib/sms-channel-readiness.ts), [`dispatchTextMessage`](../lib/text-message-service.ts) |
| Authenticated account owner; same-origin request; Run requires full-work release or an independently ready SMS/research channel | Tenant security / control | [`POST /api/work/control`](../app/api/work/control/route.ts), [`workAccount`](../lib/work-account.ts) |
| Current explicit campaign acknowledgment, separate campaign release, current business identity | Application campaign control | [`icash_record_sms_inbound_campaign`, `icash_sms_inbound_campaign_current`](../config/sms-inbound-campaign.sql); [`outreachCampaignPolicy`](../lib/outreach-campaign.ts) |
| Exact account, real property/deal, state, seller phone, sending business, timezone and bounded expiry | Tenant / factual scope | [`icash_submit_authority_review`, `icash_decide_authority_review`](../config/reviewed-action-authority.sql), SMS branch in [`sms-contact-intake.sql`](../config/sms-contact-intake.sql) |
| Actual sending-business SMS permission and prior-contact evidence; external DNC receipt/source; reviewed market/channel evidence | Provider-related requirements implemented by app evidence checks | [`icash_decide_authority_review`](../config/sms-contact-intake.sql), [`icash_sms_thread_review_current`](../config/sms-contact-intake.sql) |
| New recipient currently requires a trusted human review; raw purchased contacts do not become approved threads | Current implementation choice / missing automatic source integration | [`POST /api/authority-reviews/admin`](../app/api/authority-reviews/admin/route.ts), [`requireTrustedOperator`](../lib/trusted-operator.ts), [`sms-contact-intake.sql`](../config/sms-contact-intake.sql) |
| Current sender, exact reviewed rate hash and communication price; positive cost coverage | Pricing / configuration integrity | [`icash_sms_intake_rate_current`, `icash_sms_thread_review_current`](../config/sms-contact-intake.sql), [`sms-flat-customer-pricing.sql`](../config/sms-flat-customer-pricing.sql) |
| Account running, released campaign, fresh eligible screening, no manual property takeover, no prior opener/conversation conflict | Application workflow | [`icash_next_automation`, `icash_claim_text`](../config/sms-inbound-campaign.sql), [`sms-opener-unstarted-recovery.sql`](../config/sms-opener-unstarted-recovery.sql) |
| Fresh evidence revision and suppression rechecked atomically immediately before dispatch | Final database authority | [`icash_claim_text`](../config/sms-contact-intake.sql), base claims in [`text-messaging.sql`](../config/text-messaging.sql), campaign claim in [`sms-inbound-campaign.sql`](../config/sms-inbound-campaign.sql) |
| Wallet availability, daily/lifetime spending limits, reservation, once-only settlement | Money safety | [`scoped-spend-activation.sql`](../config/scoped-spend-activation.sql), [`communication-fractional-billing.sql`](../config/communication-fractional-billing.sql), [`sms-flat-customer-pricing.sql`](../config/sms-flat-customer-pricing.sql) |
| Provider acceptance is recorded; uncertain dispatch is held for reconciliation, not blindly resent | Delivery / duplicate safety | [`dispatchTextMessage`](../lib/text-message-service.ts), [`icash_accept_text`](../config/text-messaging.sql), [`seller-opener-delivery-order.sql`](../config/seller-opener-delivery-order.sql) |

The app currently uses a 9:00–20:00 recipient-local envelope, narrowed by the reviewed contact window; DNC evidence at most 30 days old; screening evidence at most 24 hours old; and bounded review expiry. These are **implemented app thresholds**, not a claim that every jurisdiction or provider mandates these exact numbers. Source/state-specific requirements still need valid coverage.

## STOP, replies, and follow-up

- [`verifyContiguityWebhook`, `parseTextWebhook`, `isMessageOptOut`](../lib/contiguity.ts) authenticate and normalize incoming events, including supported opt-out phrases
- [`POST /api/webhooks/contiguity`](../app/api/webhooks/contiguity/route.ts) accepts only authenticated events for a known sender; [`icash_ingest_text_event`](../config/text-messaging.sql) records receipts and suppression
- [`text-stop-voice.sql`](../config/text-stop-voice.sql) propagates SMS STOP to relevant voice permissions/jobs/callbacks. Existing suppression has shared-sender/global-phone scope; it is not evidence of another customer's relationship and must not leak that customer's records
- Ordinary account Pause holds work for later Run. Recipient STOP/withdrawal cancels or invalidates pending eligible work. Pause also stores durable daily-billing stop intent in [`icash_pause_work_and_billing`](../config/durable-work-billing-stop.sql)
- The SMS-first campaign uses a bounded positive-reply classifier in [`icash_prepare_sms_inbound_reply`](../config/sms-inbound-campaign.sql). A positive response is not an outbound AI-call grant
- [`icash_review_sms_campaign_reply`](../config/sms-campaign-reply-attention.sql) creates revision-bound customer attention when follow-up cannot proceed. Stale acknowledgments cannot hide a newer reply: [`POST /api/work/text-attention`](../app/api/work/text-attention/route.ts)
- Call invitations are held when incoming AI is unavailable: [`dispatchTextMessage`](../lib/text-message-service.ts). Legacy free-form AI SMS is separately held by [`text-ai-service.ts`](../lib/text-ai-service.ts) and campaign SQL; selecting this campaign is not permission for arbitrary automated replies
- Human-directed replies retain current recipient/budget checks and are handled in [`sms-manual-reply-continuity.sql`](../config/sms-manual-reply-continuity.sql). This map does not promise a complete automated qualification/offer/closing flow while incoming routing remains unavailable

## Outbound AI voice: exact additional gates

[`dispatchLiveVoice`](../lib/live-dispatch-service.ts) requires full-work release, an issued owned job, current enabled production voice configuration, an API credential, a phone-bound permission, current contact hours, and no suppression. [`contactEligibility`, `callEligibility`, `verifiedOfferCeiling`](../lib/live-dispatch-policy.ts) check evidence and financial scope.

Before any dial it also checks:

1. Real account identity, running state, and consistent configured business/caller number
2. The provider's current agent configuration hash, approved voice, maximum duration, required tools, and exclusion of practice agents
3. Current seller/buyer rate and duration coverage; seller financial screening or buyer marketing context as applicable
4. Budget reservation through [`icash_reserve_paced_voice`](../config/daytime-pacing.sql)
5. Atomic reviewed authority through [`icash_claim_reviewed_voice_job`](../config/reviewed-action-authority.sql), final contact checks in [`icash_claim_voice_job`](../config/live-dispatch.sql), and campaign restrictions in [`sms-inbound-campaign.sql`](../config/sms-inbound-campaign.sql)

The SMS-first campaign blocks outbound AI voice even when another general gate permits voice. No approved offer ceiling means the call may not quote an offer. An incomplete provider receipt or timeout does not authorize another dial. Buyer contact also requires the separate current buyer qualification/marketing path in [`buyer-qualification.sql`](../config/buyer-qualification.sql) and [`buyer-voice.sql`](../config/buyer-voice.sql).

The separate one-use owner transport check in [`owner-voice-acceptance.sql`](../config/owner-voice-acceptance.sql) is a bounded diagnostic mechanism, not business campaign permission or proof that production Main is ready.

## Provider requirements versus app choices

- **Contiguity contract:** its current Communications Services Terms §3.2(g) prohibit unsolicited communications, and §6.1 requires applicable carrier standards. These are provider conditions, not a feature flag the application can waive. [Official terms](https://contiguity.com/legal/communications-product-terms)
- **Contiguity channel guidance:** review the provider's additional current channel guidance when approving a source and campaign. The SMS-specific page could not be freshly retrieved during this document check; the contract provisions above were verified. [Official SMS guidance](https://docs.contiguity.com/kb/compliance/text/prohibited)
- **DealMachine:** §2(g) says supplied contact data does not guarantee the customer's right to contact people; the customer must establish appropriate consent or an applicable exemption. A likely-owner hint or a phone not flagged DNC is not that evidence. [Official terms](https://www.dealmachine.com/terms-of-service)
- **App choices:** per-new-recipient human review, the evidence-age thresholds above, conservative financial screening before outreach, exact source/rate binding, and SMS-first campaign sequencing are implementation policies. They should not be described as universal legal requirements
- **Security and money controls:** tenant ownership, authenticated webhooks, immutable evidence, STOP/suppression, exact final claims, budgets and idempotency prevent cross-account access, unwanted contact and duplicate charges. They are enforced independently of marketing policy

This is a source/code map, not a legal opinion. A customer acknowledgment or claimed exemption is an assertion until supported by the configured evidence process; it cannot silently rewrite provider terms or recipient facts.

## What currently prevents a fully automatic live campaign

At the audited configuration snapshot, property/contact research and the independent SMS channel had been released; full-work/incoming AI remained held. Channel release alone does not establish an eligible campaign or recipient.

1. **Automatic initial recipient admission is missing in deployed code.** Already approved current threads can progress automatically without per-message confirmation. New purchased numbers still need the human-review writer; there is no connected trusted source producing machine-verifiable SMS permission/prior-contact and property-association evidence
2. **A campaign must have a current acknowledgment, separate release and running account.** This document neither changes them nor assumes a customer's campaign has them
3. **Each recipient still needs current source/scope evidence, DNC checks, no opt-out, valid property binding, current pricing and available budget**
4. **Incoming AI routing remains unverified end to end.** The observed initiation authentication failure has not been resolved; no secret mismatch is asserted without evidence. The existing authentication and full-work holds remain in [`POST /api/internal/voice/inbound`](../app/api/internal/voice/inbound/route.ts), with exact invitation/account/property routing in [`sms-inbound-campaign.sql`](../config/sms-inbound-campaign.sql)
5. **Production outbound Main readiness is separate from an owner test call.** Current reviewed configuration hash, production rates, scope and genuine recipient permissions must pass the voice path above

## Prepared locally, not deployed by this document

- A negative imported-source DNC guard was implemented and tested: a retained `doNotCall=true` observation prevents seller admission/final dispatch. False/unknown flags grant nothing; paid source records are retained. **The deployed baseline currently displays these flags but does not yet consult them in the final seller claim**
- A non-sending legal-review preview was implemented and tested. It writes only a separate immutable simulation audit, never messages, permissions, reservations or provider calls. It does not complete automatic production intake
- A default-disabled trusted-evidence machine admission path is in local development. Its goal is automatic entry for independently verified eligible new recipients, with exception-only review, immutable machine provenance, current final checks and preservation of explicit pauses. No real source or production approvals have been created

The DNC/preview release passed 116 suites, typecheck, production build and isolated SQL checks. Deployment is paused. Local staged files are not represented as installed database functions by this map.

## Can all executable enforcement be one file?

The **app-level channel decision can have one executable module**, and `lib/live-work-admission.ts` is the existing place for it. SMS/voice callers can import that module instead of repeating environment comparisons.

The complete enforcement cannot physically be one API file without losing necessary boundaries: PostgreSQL must check fresh authority and money under transaction locks; server code must verify provider responses/configuration; webhook routes must authenticate events; providers enforce their own terms. A route returning “allowed” cannot replace a database check that must happen later, atomically with reservation/claim.

A future versioned policy definition could generate selected TypeScript and SQL constants, with checked generated artifacts and parity tests. That is a separate refactor, not completed here. Missing or invalid policy must hold work; removing a file must fail the build or deny admission, never enable unchecked dispatch. This document is the single navigation/audit entry point, not a removable enforcement switch.
