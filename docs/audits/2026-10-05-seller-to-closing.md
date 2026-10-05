# Seller-to-closing audit — 5 October 2026

**Release verdict: not ready for unattended live operation.** The audit found a real gap between inbound lead assignment and first contact. This release adds the missing tracked handoff and immediate dispatch attempt for already-admitted channels. It does not make missing permissions, funding, provider acceptance or completed signatures appear valid.

## Correction: submitted-address research, 5 October

The owner clarified that the former Dallas, San Antonio, Memphis and Birmingham discovery targets are obsolete. Inbound research applies to each submitted address, regardless of the former city list. The city gate is removed from qualification, assignment, readiness and the owner setup page. Financial qualification, recorded data-use permission, duplicate prevention, lookup allowance and downstream contact/signing checks remain separate.

The four existing market scan scopes are disabled and 210 unstarted scan jobs are held; completed history is preserved. Production cold-discovery/contact-enrichment flags are false while acquisition mode remains inbound. Runtime admission also blocks market research in inbound mode. Submitted-address lookup and post-contract buyer search retain their own paths.

The owner’s confirmed data-use permission and $10 platform research allowance remain in place. Research does not require a funded recipient; delivery and initial contact do. No real seller submission, customer charge or phone call was fabricated for verification.

## Follow-up: immediate contact after research

**Activation update, 5 October at 11:47 CDT:** The owner explicitly approved enabling production outbound calling before the recorded-call acceptance test passes. The production `ICASH_RECORDED_OUTBOUND_READY` setting was changed to `true` and read back successfully. This authorization supersedes the activation rejection described below; it is not evidence of a completed test. Existing funding, contact, provider-review, recording, STOP and per-account checks continue to apply. Research allowance, market/data setup and funded-account prerequisites remain outstanding.

The owner clarified the intended sequence: submitted address → DealMachine research → funded user assignment → immediate SMS and call. The follow-up release removes the advertising-receipt dependency, targets assignment to the just-submitted lead, and starts the independent SMS/call attempts concurrently. New lead prices use 3× the recorded research and operating cost basis. The first assignment freezes that basis for later recipients; advertising reporting cannot debit customers retroactively. Historical paid prices are preserved.

The seller-processing switch and the existing owner's account voice configuration were enabled at the owner's request. Automatic approval review rejected changing the production `ICASH_RECORDED_OUTBOUND_READY` flag because no completed recorded-call acceptance exists; the production flag remains false. The existing inbound reception service remains enabled, but the recorded incoming replacement is not activated. A fresh readback still shows a missing Twilio price for the previous reception call, so its reserved credits cannot be reconciled yet. No funds, acceptance evidence, market reviews, or contact permissions were invented.

Validation: all 210 automated suites, TypeScript, production build, and the expanded isolated SQL test passed. New tests cover assignment without advertising receipts, exact-lead targeting, historical price preservation, fixed later-recipient charges, no retroactive advertising debit, duplicate prevention, tenant privileges, and a call starting while SMS is still awaiting its provider.

## Changes in this release

- Every paid seller assignment creates one durable response record. The response worker prepares an empty-price draft without overwriting existing terms, then attempts the existing text and call paths when their separate requirements are met. Submission processing and the one-minute seller cron both run this handoff. A provider timeout does not authorize another send or redial.
- Stop, suppression, manual control, a human handoff and an executed purchase stop the initial-response handoff. One successful channel cannot mark both text and voice as successful.
- A first call can use the name actually submitted in the bound HomeOffer request: “Hi, is this David?” The opener identifies the actual buyer and AI assistant. It refers to the requested offer; it does not claim an offer is ready. Names do not establish ownership.
- A fresh, already-permitted inbound request skips speculative daytime budget spreading for the first 15 minutes. Contact-hour rules, recording checks, actual wallet capacity and final dispatch checks still apply. This is not an all-hours call release.
- SMS uses the existing conversation's enabled sender instead of forcing every conversation through one environment-variable number. It preserves that sender and checks the account's voice-number binding. This supports separately provisioned senders; it does not buy numbers, rotate an ongoing thread, or resolve shared-number ownership by guessing.
- Default internal activity now includes assigned leads, responses needing setup, completed call results, buyer SMS replies, showing changes, verified title replies and accepted buyer-package emails. Existing seller, signature, closing and human-review events remain. External email/SMS alerts still follow the account's saved preferences.
- Owner operations now distinguishes configured settings, missing setup and flows not verified live.
- Repaired the isolated integration fixture's migration ordering and added an explicit downstream-only mode. It no longer silently treats the obsolete unrecorded calling fixture as evidence for the current recorded calling system.

## Observed production state

Read-only database, provider and signed-in owner checks were performed during this audit.

| Area | Evidence | Result |
|---|---|---|
| Seller research | Processing disabled; platform allowance $0; no data-use review; no enabled seller markets | Blocked |
| Lead distribution | No active live daily accounts; zero seller intakes and assignments | No live delivery to verify |
| First call | Account voice configuration disabled; recorded outgoing release held | Blocked |
| Owner call acceptance | Previous attempts failed/declined; no successful recorded acceptance; review expired and carrier cost receipts pending | Not passed |
| SMS inventory | One enabled sender | Cannot provide three distinct sender identities for the same seller yet |
| Voice inventory | One approved voice on the account configuration | Different voices for all recipients cannot be guaranteed |
| DocuSeal | Test and live API/template connection checks passed; two enabled current templates in each mode; zero signing envelopes | Connected, not exercised through actual signers |
| Email | propertymsgs.com and geticashx.com verified; sending and receiving enabled in Resend | Provider configuration verified |
| Account updates | Global update capability enabled; zero accounts enrolled in external alerts | Internal inbox available; email/SMS enrollment absent |
| Pricing | New standard and voice cost multipliers both 3 | Configured; historical reservations keep their original snapshots |

The current owner call allowance still shows one unused attempt and $1 uncommitted within its original three-attempt/$3 cap. That does not release the expired review or replace missing carrier receipts. No live test call, seller/buyer message, legal signature or payment was made during this audit.

## Flow audit and remaining gaps

| Step | What is implemented | What remains before claiming complete automation |
|---|---|---|
| Seller submits | Validated, versioned agreement, deduplication, persisted request, targeted address lookup and assignment, immediate background processing | First response follows completed research and funded assignment, as clarified by the owner. Advertising reports no longer delay assignment. Actual account-specific channel configuration is still required. |
| Research and distribution | DealMachine address-only lookup; real financial inputs; maximum three recipient accounts; initial, 24-hour and 72-hour distribution; exact duplicate charging protection; 3× research pricing independent of advertising reports | Platform allowance, reviewed markets and active accounts are missing. Shared research lasts eight days, but automated financial call admission requires 24-hour freshness: later recipients need a separately funded refresh path. |
| First SMS/call | This release supplies the durable handoff into existing permitted channels and records failures | The checkbox does not create the actual account-specific channel records. No live acceptance test has passed. Unconditional immediate calling outside contact hours is not released. |
| No answer | Ambiguous sends are held; confirmed callback requests have durable scheduling | A complete automatic no-answer cadence is missing. Do not classify a declined recording prompt, uncertain dial, voicemail or opt-out as a successful conversation. |
| Appointments/showings | Callback tools and showing proposals exist; confirmed access requires both parties | SMS callback requests still require review; showing proposals are not an autonomous calendar booking system. |
| Human handoff | Voice and text handoff/control records stop automation | An open request is not a completed human transfer. Test actual owner notification, acknowledgement and resumption. |
| Purchase signing | Ordered seller/customer signatures, immutable terms, exact recipient binding, reviewed templates, bounded customer auto-sign authority | Complete an actual DocuSeal test-mode envelope with controlled test signers. Do not sign a real agreement as a test or enable general auto-sign without its saved authority. |
| Buyer discovery | Executed live purchase required; bounded DealMachine search, deduplication and deal-specific buyer qualification | A discovered cash-buyer record is not current proof of funds, buying criteria, signatory authority or outreach permission. No real buyer was contacted in this audit. |
| Buyer package | Idempotent requested-package email, actual deal terms, transparent assignment price, reply routing, provider receipt | This is requested-package delivery, not a verified mass-outreach campaign. An accepted email is not delivery, buyer acceptance or a deposit. |
| Title | Verified contact, signed-document attachment, initial email, bounded follow-up, authenticated replies and structured milestone confirmation | General autonomous negotiation of arbitrary title problems and title-company SMS are not implemented. Lien disputes, contract amendments and wire changes require human/title-company handling. |
| Closing | Ordered title/assignment/deposit checks; verified closing milestones; no fabricated wallet proceeds | No actual title file, closing or bank receipt has been tested. |
| Learning | Opener experiments and bounded outcome policy exist | The general learning-event helper is not wired into the current complete seller/deal lifecycle; its cohort model references the older deal table. There is no basis for claiming that end-to-end machine learning is already optimizing closings. |

## Test evidence

- **209 automated test suites passed.** Includes current admission, recording policies, signing validation, SMS, stop/opt-out, tenant boundaries, notifications, billing and UI policies.
- **Additional thread-sender routing test passed:** separately configured sender, disabled-number hold, and verified voice/SMS continuity; mocked provider only.
- **New isolated response SQL test passed.** Real new migration and existing SMS machinery; synthetic account/contact evidence only. Checked assignment handoff, missing permissions, immutable existing terms, bounded retries, Stop, single-channel failure visibility, no duplicate text, suppression and private account alerts.
- **Downstream-only deal simulation passed ten stages**, exercising 80 actual schema/config files, 223 real local RPC calls and 44 intercepted provider requests. Covered purchase signatures, buyer discovery/qualification, assignment ordering, title replies, deposit/closing ordering and spending controls.
- **TypeScript and optimized production build passed.**
- The old full journey attempt first exposed incorrect fixture ordering, then correctly stopped at `recorded_call_release_required`. The downstream-only run explicitly substitutes a synthetic seller statement; it is not proof of a live seller-to-closing run.
- DocuSeal read-only API checks establish connectivity, not completed signatures. Resend domain checks establish verified domains, not message delivery. No result here should be promoted to live end-to-end acceptance.

## Operating recommendations from the research and audit

1. Make receipt and first response separate measurable events. Track form-to-text-acceptance, form-to-call-start, actual connection, qualified conversation, signed purchase, buyer commitment, close, net cost and opt-outs. “Queued” must not be displayed as “sent.”
2. Use a short acknowledgement and one question. Refer to the exact inquiry, confirm identity/property, then condition, timing, decision-makers and price. Do not say “your offer is ready” until a current authorized offer exists. Do not invent different offers to create competition.
3. Use a conservative no-answer experiment once the missing cadence is built: one follow-up text after a confirmed unanswered call, then an agreed callback or a bounded later attempt. Stop on reply, booking, handoff, opt-out, duplicate, signed purchase or unresolved provider outcome. Measure this against a holdout; it is a proposed starting policy, not a proven wholesaling conversion optimum.
4. Keep one stable sender and voice for each buyer–seller conversation. Allocate a different verified identity for another independent buyer only when available. With one number, do not silently remap replies between accounts.
5. After contract, rank buyers by stated buy box, verified funds/authority and observed completion history. Include accurate terms, access instructions, condition evidence and deadlines in requested packages; maintain backup buyers. The code must not manufacture those facts from a list lookup.
6. Make title exceptions specific human tasks with an owner and due date. AI may summarize and draft a reply, but signatures, amendments, deposit release and changed wire instructions need the appropriate verified authority.
7. Optimize against mature closed-deal outcomes and complete costs, not text replies alone. Keep an exploration group and rollback thresholds for opt-outs and complaints. No live data exists yet to identify a winning cadence or script for this business.

## Research sources

- [Harvard Business Review: The Short Life of Online Sales Leads](https://store.hbr.org/product/the-short-life-of-online-sales-leads/F1103B), 2011. The accessible primary summary supports avoiding slow response, not a specific guaranteed close rate or a uniquely optimal script.
- [Contiguity webhook documentation](https://docs.contiguity.co/api-reference/webhook/overview): HTTPS, quick acknowledgement and asynchronous processing; retries are not guaranteed. Durable storage and reconciliation are needed.
- [DocuSeal API reference](https://www.docuseal.com/docs/api): ordered submissions, recipient email verification, submission status and signed-document retrieval. The implementation's email 2FA field is documented.
- [DealMachine property count/search reference](https://api.docs.dealmachine.com/api-reference/properties/count-properties) and [response format](https://api.docs.dealmachine.com/concepts/response-format): separate property/person anchors and contact audiences; lookup outputs are data, not contact authority.
- [FTC Telemarketing Sales Rule guidance](https://www.ftc.gov/business-guidance/resources/complying-telemarketing-sales-rule) and [47 CFR 64.1200](https://www.ecfr.gov/current/title-47/chapter-I/subchapter-B/part-64/subpart-L/section-64.1200): consent, identification, opt-out and contact-time requirements depend on the actual call and party. Blanket removal of those checks was not treated as a launch fix.

## Release acceptance still required

1. Actual lookup allowance, licensed data-use evidence and reviewed launch markets. Campaign-cost reports are optional internal reporting and do not hold customer delivery.
2. A funded active account and valid channel configuration for contact immediately after completed research and assignment.
3. Reconcile existing call costs, refresh the bounded call-test review through its normal workflow, and complete one controlled recorded call with audio, transcript, STOP, callback and human handoff evidence.
4. Complete controlled SMS delivery/reply/STOP and a real DocuSeal **test-mode** signing flow; then test an actual requested package and title reply using controlled recipients.
5. Implement and test the remaining no-answer, multi-identity allocation, later-recipient refresh and lifecycle-learning work above before advertising a fully autonomous wholesaling business.
