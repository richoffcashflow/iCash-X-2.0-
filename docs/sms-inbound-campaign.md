# SMS-first to seller-initiated AI call

Staged implementation only. No production migration, campaign release, SMS, contact purchase or call is performed by this patch. Only genuinely permitted, solicited SMS cohorts are eligible; customer acknowledgment never becomes recipient consent.

## Flow

1. Authenticated customer explicitly checks and saves the versioned campaign acknowledgment. The record stores exact text, account, verified user and timestamp and is append-only. Saving selects `sms_inbound`; campaign release defaults OFF. Daily funding consent and billing are unchanged.
2. A separately reviewed release must bind the customer's current principal and actual SMS source/cohort to the sending business. It cannot be created by the customer endpoint. Missing identity, changed business identity, stale version or missing release holds dispatch.
3. Existing funded scheduling can prepare the cash-offer-interest opener, with AI disclosure and STOP language. Final dispatch keeps genuine SMS permission, DNC, suppression, recipient-local hours, fresh eligible screening, manual takeover, pause and current-rate/budget checks.
4. Only an exact short affirmative response to the accepted/delivered opener can produce one fixed invitation. Qualified, negative, injected, ambiguous and human/callback requests do not become invitation permission. They stay in existing review/attention handling. No free-form model text is auto-sent in this mode.
5. An accepted/delivered invitation binds exact account, property/screening, thread, sender, recipient, incoming number and expiry. The incoming provider webhook authenticates and binds call SID, conversation ID, agent, caller/called numbers and current agent hash. It uses the reviewed incoming-call rate and reserves the account's funds before allowing the conversation. It does not require or create outbound AI voice permission.
6. Caller ID is only a routing hint. The AI asks the caller to provide their identity/property and never exposes stored customer/deal facts. Existing incoming result handling creates verification attention before those facts can affect deal terms. No offer, contract sending or automatic callback is authorized by this path.

Selecting this mode blocks existing outbound AI voice jobs and callbacks at final atomic claim, including a concurrently committed selection. Legacy AI qualification jobs cannot claim, queue or dispatch automatic replies after this mode is selected. STOP cancels pending SMS and prevents incoming receipt replay under the existing suppression policy. A shared caller never chooses an arbitrary tenant: conflicting accepted open-deal bindings are rejected.

## API

`GET /api/work/outreach-campaign` returns `policy:{version,text,mode}`, `configured`, `released`, `acknowledgment:{acceptedAt,version}|null` and `liveWorkReady`.

`POST` accepts exactly `{accepted:true,version,mode:'sms_inbound'}` from the authenticated same-origin owner. It returns the same state with `saved:true`. A stale version is 409. No browser account/user ID, release flag or recipient permission is accepted. `configured` means saved selection; `released` is independently controlled. Neither asserts that the bot is running.

## Database and release order

Apply `config/sms-inbound-campaign.sql` once after current reviewed authority/buyer qualification, text messaging/AI, market expansion, seller-opener and incoming voice migrations. It wraps existing functions rather than removing their financial/security implementation. Current function signatures are checked and renamed; do not blindly reapply.

Apply schema before dependent API/UI code. The schema seeds no acknowledgment, campaign release, contact/source evidence, price, inbound route, credentials or live flag. The optional outbound destination-price guard is a separate unpublished artifact and is not part of this release.

## Actual prerequisites still missing

Production inspection on September 30, 2026 found no inbound route, no `sms_send`/`incoming_call` operation rate, and no eligible SMS thread. The named owner has review access, but that access grants no cohort permission.

Before release: verify an actual permitted SMS cohort for the sending business; configure current supplier-backed SMS and incoming rate/usage policies; verify the Contiguity sender and webhook; independently review Main's current hash/tools, 600-second duration, audio-off and inbound failure behavior; configure the known incoming number to the matching business sender and rate; verify `ELEVENLABS_INBOUND_WEBHOOK_SECRET` through supported secure setup if absent. Keep work OFF until these checks and a separately authorized controlled SMS/inbound acceptance test pass.

Official provider limitations: [Contiguity prohibited use](https://docs.contiguity.com/kb/compliance/text/prohibited), [communications terms](https://contiguity.com/legal/communications-product-terms), and [lease terms](https://contiguity.com/legal/lease). The provider prohibits unsolicited/cold outreach; a customer checkbox cannot change that. [ElevenLabs incoming webhook shape](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/customising-calls) supports the existing five-field authenticated initiation binding.

## Verification

- Focused API test: `node --experimental-strip-types tests/outreach-campaign.test.mjs`
- Real PostgreSQL simulation: `node --max-old-space-size=384 --experimental-strip-types scripts/test-sms-inbound-campaign-pglite.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js`
- The latter loads real repository schemas and functions, then synthetic accounts, source permissions and provider receipts. It covers acknowledgment isolation/default OFF/idempotency/immutability, actual opener/positive/invitation/incoming claims, duplicate receipt, stale rates, pause/takeover/screening/permission changes, source-business change, old AI jobs, cross-account claim, negative replies, STOP and role restrictions. No network access or production records are used. Multi-session contention and actual provider transport remain separate verification limits.
