# Operational contact eligibility

Local review artifact based on `aa3fc9ad0f6745265f9595f6746ddad8c6e4aa87` (the frozen 35b8af release plus the exact eleven released research/contract-separation files and sixteen released atomic requested-ZIP files). Not deployed by this patch author.

## Behavior and scope

For purchased seller contacts, the software no longer requires an operator to approve a recipient permission record before voice or SMS work can be considered. Existing customer/account setup, campaign selection/release and Run controls remain. No new per-list or per-contact attestation screen is added.

A new `icash_operational_contacts` row represents owned source data plus current DNC and operating checks. It explicitly records `consent_verification=not_performed`. It is not recipient consent, an independent legal review or a finding that outreach is lawful. Customer responsibilities remain in existing campaign disclosures and the clarified disclosures page.

Legacy permission/review records are retained. New voice jobs have a separate `operational_contact_id` foreign key; exactly one of that key or the legacy `permission_id` must be set. Operational SMS threads keep `permission_until`, `permission_evidence` and `sms_review_request_id` NULL and use distinct operational eligibility/pricing fields. The compatibility voice read projection aliases an operating expiry to the old internal `permission_until` interface; no consent row or consent evidence is created.

This change covers the purchased seller-contact workflow. Buyer qualification/marketing, maximum offers, contracts, signatures and disposition authority retain their separate existing controls. The existing SMS-to-inbound campaign still blocks outbound AI calls.

## Checks retained

- Exact account, current owner, sending-business, property and immutable source-result hash binding
- Genuine current DNC receipt, enabled source, explicit clear status, source/receipt expiry and 30-day maximum check age
- Provider-reported DNC=true in any matching saved source remains a hold
- Global SMS STOP and voice suppression, original withdrawn/revoked evidence, manual holds
- Quiet-hours operating policy, provider configuration, current rate/price, wallet/reserve/margin controls and inventory exclusivity
- Existing first-call/frequency, callback, unstarted retry and unknown-provider-outcome protections
- Final-claim rechecks rather than relying on earlier UI/status or scheduler checks
- Existing actual usage collection, immutable exact-number carrier-price snapshot, 16-component settlement, reserve release and one ledger debit

All original owner-enrichment flags (`permission=unverified`, `ownershipVerified=false`, `outreachAuthorized=false`) are unchanged.

## Quiet-hours provenance

Voice initiation is restricted to 09:00 inclusive–18:00 exclusive in the source-record time zone, for both legacy and operational contacts, with any narrower recorded window preserved. Preflight, final atomic claim and daytime budget pacing agree. SMS keeps its existing 09:00–20:00 policy. Source-record time zones are used only with an explicit source reference. Unknown-location voice fallback is 19:00–20:00 UTC (Pacific/Honolulu operating clock 09:00–10:00); SMS fallback remains 20:00–22:00 UTC (10:00–12:00). It is not an assertion that the recipient is in Hawaii or proof of their current location. Mobile/VoIP/travel can change actual location; this policy is not legal clearance.

SMS fallback is limited to the 452 geographic, in-service NPAs in the official NANPA 2026-10-02 dataset after excluding Guam/CNMI (671/670). Voice additionally excludes American Samoa (684), leaving 451 supported geographic NPAs. Unknown, unassigned and non-geographic NPAs receive no fallback. A source-record time zone is required for excluded territories. No claim is made that these are learned “best times.” `config/nanpa-geographic-npas-2026-10-02.json` records the official source URL, original CSV hash, filter and exact list. Future NPA changes require a reviewed dataset update.

## Ordered application and privilege review

1. Preserve the full current release and its already-applied research/contract separation.
2. Apply `config/operational-contact-eligibility.sql` after all current voice/contact, DNC, SMS seller-opening and accounting definitions.
3. Apply `config/operational-sms-eligibility.sql` after step 2 and the latest SMS seller-opening/recovery definitions.
4. Deploy the matching application code. New application reads require the new view; do not deploy code first against an old schema.
5. Any saved-response provider-observation adapter is a separate migration/policy decision and is not activated by these two core files.

Both SQL files fail rather than silently patch an unrecognized function boundary. Neither migration calls preparation/dispatch, creates consent or customer acknowledgments, inserts DNC clearance, enables a source policy, sends a message/call or changes cost multipliers/rates/budgets. Scheduler operation after approved rollout can create eligible operational targets and carry out work already enabled by customer controls; this is the requested workflow change.

New privilege surface:
- Service-role-only access to operational routing table/view and preparation/current-check functions; no customer direct grants.
- `icash_lock_operational_dnc(account,contact)` is a narrowly scoped SECURITY DEFINER boolean helper with empty search_path. It only row-locks the receipt/source referenced by that exact operational contact/account. No writes, table locks, permission grants or evidence mutation. PUBLIC, anon and authenticated execution is revoked. The service role still has no UPDATE grant on DNC evidence.
- Existing evidence tables, legacy FKs and accounting APIs remain. Voice job FK/constraint changes and service-only helper require deployment/security review before application.
- Confirm the existing hosted baseline permits the inventory helper to use the `extensions` schema. Local native fixtures grant schema USAGE only to model that baseline; this patch does not grant extra DNC privileges as a workaround.

## Verification

- Existing tests and TypeScript; matching Next webpack production build (Turbopack rejects the local shared dependency symlink)
- `test-operational-sms-eligibility-pglite.mjs`: owned source→projection→scheduler→owner confirmation→interest→inbound invitation→inbound admission; DNC/source/STOP/rate/business/tenant/funds/manual/nighttime/replay negatives
- `test-operational-voice-eligibility-pglite.mjs`: separate operational FK→queue→pacing/reserve/inventory→final claim→provider-bound result→durable queue→mock authenticated providers→exact-number snapshot→actual settler/readback/one ledger debit; zero fabricated permission records
- `run-operational-locks-postgres.sh`: real two-session native PostgreSQL incoming-versus-outgoing and direct-queue-versus-dispatch lock races, service-role entrypoints, event idempotency and helper ACL denial; the same runner with `voice` also tests native final-claim daytime boundaries and settlement
- Independent reviewer verified service-role preparation, queue, reservation and claims; bounded DNC lock ACLs; 101-phone preparation across repeated batches; official NPA-list parity

No production calls, messages, payments, source-policy activation or SQL application were performed.

## Known boundaries

The core requires actual DNC evidence and does not convert an old `doNotCall=false` into a newly verified check. A separately reviewed source policy may describe provider-reported national observations with honest timestamps/coverage; state/local requirements and recipient consent are separate.

Existing SMS sender+recipient threads are not silently reassigned, unpaused or renewed when a new evidence version arrives. This deliberately preserves manual/STOP/provider-uncertainty state. Automatic metadata-only renewal requires a separate bounded design.

## Disclosure versioning

The disclosures page is an informational clarification dated October 3, 2026. The patch does not alter `fundingTermsText`, `dailyConsent`, campaign-policy text, their version constants, existing acceptance rows, or historical receipts. It does not assert that any existing customer accepted new contract text. No indemnity, fixed liability cap or new waiver is added. Existing mandatory-rights and unlawful-conduct exceptions remain.

## Precise remaining buyer-contact requirements

This core removes the internal approval prerequisite only for purchased **seller** contacts on voice/SMS operational paths. It does not remove buyer-contact permission requirements. Buyer outbound voice still uses an existing `icash_contact_permissions` buyer record and the operator review path with buyer/account binding, channel-specific evidence and current DNC. Separately, `icash_buyer_voice_context` still requires the verified signed purchase, current disposition/marketing authority, completed buyer package, matching qualified buyer criteria and matching price/property/repair limits. Those marketing/transaction controls are distinct from buyer recipient-contact approval. Operational buyer SMS is not introduced. Do not describe this core as removing every contact-permission gate across all roles.

Voice daytime tests cover 08:xx/09:xx/17:xx/18:xx final SQL claims for both legacy and operational contacts, JavaScript 08:59:59/09:00/17:59:59/18:00 boundaries, narrower windows, both DST transitions, and seasonal supported-region fallback checks. This is an initiation window; existing connected calls retain their existing duration cap.

## Source-defined financial adapters

No financial reserve-chain/bootstrap definition is introspected at deployment. Existing reserve-before-activation/inventory implementations and ACLs remain untouched. The pacing and paced-reservation adapters are canonical CREATE OR REPLACE statements generated from the released local SQL fixture and repository sources; their compiled definitions match the previously tested behavior exactly. They still call the unchanged reserve-operation/activation/cost chain. Other guarded voice/context/SMS/scheduler definition patches are enumerated in the manifest for deployment review. No protected live definition was read.
