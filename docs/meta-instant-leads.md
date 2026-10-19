# Meta contact-first intake

This feature is disabled by default. The code and migration do not create a live
form, subscribe a Page, send a test message, or authorize a paid provider test.

## Seller flow

1. The reviewed Meta form collects name, mobile number and explicit AI call/text
   permission. Its optional, separate call-now checkbox uses the exact receipt
   text recorded in `icash_meta_lead_sources`. Never infer permission from a phone.
2. A signed Page `leadgen` webhook is stored durably. The worker retrieves the
   lead from Graph, checks Page/form/ad/consent/timestamp bindings, then creates a
   contact-only screening and draft deal for an eligible buyer in the HomeOffer
   Network pool. Unassigned contacts remain durable until a funded, active buyer
   is available. The first SMS and seller call dispatch
   independently through existing account and provider admission checks.
3. The AI asks for street, city and state, reads the address back, and waits for
   confirmation. The existing `icash_offer_and_contract` tool's `report_change`
   action accepts an address only when actual provider conversation history
   supports that confirmation. The DealMachine request budget is eight seconds
   during a call (15 seconds in background). This is a request timeout, not a
   promise about total response time or provider availability.
4. A matched property updates the same screening, deal and conversations. The
   existing property card and photo path take over. `get_offer` then uses the
   existing qualification, underwriting and price authority. An address alone is
   never authorization to quote a price. If the first call already ended before
   research became ready, at most one offer follow-up job may be queued. Active
   calls, unknown provider outcomes, explicit holds and authorized live quotes
   suppress that extra job. A returned quote is not a delivered-offer metric.
5. A missing, ambiguous or failed lookup uses the private address form. Unknown
   provider outcomes stay in review. Only a definitive zero-credit no-match may
   accept one corrected address; prior research evidence remains intact.

## Completion screen and attribution

Use `https://homeoffernetwork.com/sell/address?form=YOUR_REVIEWED_SOURCE_SLUG` for
the Meta completion-screen website button. This shared URL does not identify a
seller. The visitor enters the address and the same mobile number used in Meta;
the service stores an unconfirmed candidate and sends a private confirmation link
to the original opted-in phone. The link prepopulates that candidate. Only its
confirmation attaches the address to the original lead. A late Meta webhook can
match a pending completion form for 30 minutes.

The SMS link already identifies the lead and needs no phone re-entry. Its short,
unguessable capability is in the URL fragment; only its hash is stored, with a
seven-day expiry. It contains no phone, address or property data. Do not log the
fragment or paste a seller's link into tickets. Replays keep the canonical lead
and original campaign/ad attribution; duplicate opt-ins have separate receipts.

## Activation dependencies

Apply `supabase/migrations/20261018150000_meta_contact_first_intake.sql`, followed
by `supabase/migrations/20261018161751_meta_instant_network_pool.sql`, against the
expected schema. The second migration adds the owner-selected shared-pool routing.
The local PostgreSQL test exercises both, including the original website allocator.
Existing function patches assert their prerequisites and stop on schema drift.
Do not execute the individual config files again after the migrations.

Provision these **server-only** values through the deployment's secret controls:

- `META_LEAD_APP_SECRET`, `META_LEAD_VERIFY_TOKEN` and a random, at least
  32-character `META_LEAD_LINK_SECRET`.
- `META_LEAD_PAGE_TOKENS`: JSON mapping reviewed Page IDs to their Page access
  tokens with the required lead-retrieval/Page subscription access. Alternatively,
  an owner-provided system-user token already saved in
  `META_ADS_READ_ACCESS_TOKEN` may be reused only for Page IDs explicitly listed
  in `META_LEAD_ADS_READ_PAGE_IDS` (comma-separated). An explicit per-Page token
  takes precedence; malformed token maps fail closed. Reuse does not grant Meta
  permissions or subscribe a Page, and still requires an enabled source.
- `META_GRAPH_VERSION`: the Graph version reviewed for the connected app.
- `META_INSTANT_LEADS_ENABLED=true` only in production after installation and
  source review. Preview deployments remain disabled. Existing live-work,
  recording, DealMachine, SMS, wallet, membership and provider approvals remain
  necessary; this feature does not replace them.

Create one `icash_meta_lead_sources` row for each reviewed immutable form. For the
HomeOffer Network form, use `routing_mode=network_pool`, `account_id=NULL` and
`principal=HomeOffer Network`, with the actual network-sharing text and exact
contact-choice key/text/version from the form. Also supply its Page ID, form ID,
source slug, optional call-now key/text, and supported timezone. Preserve a review
reference and expiry for the actual form evidence. Never invent a checked choice
or infer permission from an arbitrary phone number. The owner-configured
submission basis below uses the authenticated receipt for that exact form.
Changed disclosures or targeting need
a new reviewed source rather than rewriting prior receipts.

Contact allocation uses the existing funded-membership, Run/Pause, channel,
billing-review and VIP-priority predicates. Rotation also counts unfinished Meta
contacts. Assignment does not create an acquisition charge. The first recipient
keeps the same screening, deal and thread when research becomes ready. Normal
recorded-cost acquisition pricing applies once, and the existing website
allocator resumes the second/third buyer schedule after 24/72 hours. Each later
recipient needs its own exact match/screening binding; a seller stop applies
across matches. The optional `direct` routing mode remains available for separate
forms that name one specific buying principal and account.

Webhook callback: `https://homeoffernetwork.com/api/webhooks/meta-leads`. Subscribe
the reviewed Page to `leadgen`; keep verification and signature secrets separate.
The production verification challenge works once both webhook secrets are saved,
even while intake is disabled. POST delivery remains unavailable until intake is
enabled; verifying the callback alone never creates leads or sends outreach.
The existing authenticated seller worker is the recovery path. Monitor durable
inbox states, provider receipts and held research rather than assuming a 200
webhook means a seller has been contacted. Exhausted retrieval attempts remain
visible in the inbox; reconcile before resetting any attempt.

The address input uses the existing Google Places key when configured and always
allows manual full-address entry. No new paid development test is authorized.

## HomeOffer Network form supplied October 18, 2026

The owner supplied these IDs and selected the completion URL below. They are
setup inputs, not proof that Meta permissions or form consent have been checked:

- Meta app: `1728166318272061`.
- Business portfolio: `802460598438968`.
- Page candidate from the supplied Business Suite `asset_id`: `1307748055763550`.
- Form: `4401851653462589`.
- Ad account: `act_588883577262327`.
- Published campaign: `120255627041280155`.
- Source slug: `hon-fast-cash`.
- Completion URL: `https://homeoffernetwork.com/sell/address?form=hon-fast-cash`.
- Contact fields confirmed by the owner: **Full name** and **phone**. There is
  no required property-address or email question in the Meta form. The phone
  field maps to `phone_number`; the address is collected after submission.

The existing Production `META_ADS_READ_ACCESS_TOKEN` was present during setup.
The owner reports it includes both `ads_read` and `leads_retrieval`. Its actual
Page/form access still needs verification. The Page-scoped reuse setting is
`META_LEAD_ADS_READ_PAGE_IDS=1307748055763550` was saved for Production on
October 18; no second token copy is needed. It takes effect in the next build
that includes this integration.
The Production `META_LEAD_APP_SECRET` is present. Its value remains inside the
deployment's secret storage. `META_LEAD_SETUP_APP_ID`, `META_LEAD_SETUP_PAGE_ID`
and `META_LEAD_SETUP_FORM_ID` select only the supplied objects for the read-only
production build diagnostic. The diagnostic records bounded form metadata and
subscription status in the service-only `icash_integration_checks` row
`meta_lead_setup`; it never retrieves lead records or sends outreach. Preview
builds make no provider requests and cannot replace that production receipt.
The owner selected the **HomeOffer Network pool** on October 18. No fixed owner
workspace is required for this source. The owner subsequently selected automatic
follow-up from the actual name-and-phone submission, without an additional
checkbox. This source uses `contact_basis=form_submission`; retain the original
Make receipt rather than inventing checked disclaimer or call-now responses.
Make setup, migrations and deployment remain activation dependencies. No paid
simulation is authorized by this setup request.

## Make connector intake

`POST https://homeoffernetwork.com/api/webhooks/make-leads` accepts the connected
Facebook Lead Ads **New Lead (Instant)** bundle. Authenticate with a dedicated
Bearer key in Make's saved HTTP credentials. Production stores only its SHA-256
hash in `META_MAKE_RECEIVER_JSON`, together with `pageId`, `formId`, and
`testLeadIds`. Never use the Meta App Secret or Page access token as this key.

Send JSON or `application/x-www-form-urlencoded` fields: `lead_id`, `page_id`,
`form_id`, `created_time`, `full_name`, `phone_number`, and optional `ad_id`,
`adset_id`, `campaign_id`. Map the original date as ISO with timezone or UNIX
seconds. Optional `custom_disclaimer_responses` contains actual responses only;
the two-field submission source does not require it. Empty ad IDs are accepted.
Use the Facebook **Date created** mapping chip directly when it already produces
an ISO timestamp. Do not send a literal `formatDate(...)` expression. Field names
are the exact lowercase keys above; `Ad ID` is not an alias for `ad_id`, and an
ad's ID must not be reused as its ad-set ID.

Apply `20261018221018_meta_make_intake.sql` before
`20261018225224_meta_first_call_admission.sql`. The latter aligns final call
admission with reservation admission for a currently verified, contact-only Meta
job. Property underwriting remains required for ordinary seller offer calls.
`icash_meta_recover_unstarted_voice(account, job)` is a service-only recovery for
the specific pre-provider `dispatch_permission_changed` failure with a cancelled,
zero-cost, never-dispatched authorization. It creates at most one replacement
job, retains the original job/spend evidence, and returns to the normal worker.
Provider attempts, unknown outcomes, opt-outs and inactive accounts are excluded.

Known test `1075706761942372` and Meta's dummy name/phone placeholders are stored
as tests and never dispatched. Real receipts are immutable, Page/form scoped,
and deduplicated by the same acceptance function as the original Meta callback.
The submission receipt retains its actual ID/time/name/phone; source policy
selects the basis for follow-up. Existing checkbox sources remain unchanged.
The pool, text-only requests, opt-outs, Pause, credits, provider admission,
private address links and same-card property conversion remain shared paths.
No outside-hours call-now request is fabricated from the submission.

Apply `20261018232526_meta_test_contact_exclusion.sql` to enable source-scoped
`test_lead_names`. Save only owner-identified test contacts on the specific source.
Matching ignores case and repeated spaces. The database classifies them before
claiming or assigning work; the acceptance function also prevents a bypass.
The original connector payload remains intact. Never apply a global name block.

For earlier form submissions, create a one-time Make scenario using Facebook Lead
Ads **List Leads**, the same Page/form, and the existing authenticated HTTP module.
Map the original IDs, submission times and contact fields from that module. Keep
the instant scenario running for new leads. Skip already imported IDs when their
optional attribution fields would differ: conflicting receipts are not rewritten.
The normal network pool assigns each accepted contact; a replay does not create
a second card or repeat initial outreach. Keep this import scenario unscheduled.

The first SMS asks for a reply with the street, city and state in one segment.
It includes the supplied first name when it fits without changing SMS encoding.
Private address links are sent for the lookup fallback, instead of making the
initial response depend on a click. Initial outbound and returning inbound calls
identify HomeOffer Network and ask for the seller's property address before
qualification. Confirm the complete address before research, and reuse any saved
address. Contact cards show the seller, activity and address progress; the same
screening/deal IDs become the normal property card after a successful match.

A greeting or missing extracted interest is not a decline. Call observations
require actual seller refusal wording or an opt-out before pausing the lead.
English and Spanish voicemail greetings and empty/silent turns do not count as
responses. The live prompt leaves one brief voicemail and uses `end_call`, with
one check for a silent human line. Returning callers with a submitted address
confirm the same property and continue its existing lookup. Fallback-link replays
recognize accepted/delivered provider receipts without sending again; uncertain
messages remain held. Spoken street expansions and Spanish yes/correct are
accepted only with the original seller street and full agent readback.

The owner supplied the published campaign through an Ads Manager URL containing
both the ad account and campaign IDs above. Its existing production spend source
was saved with tracking campaign `120255627041280155` and automatic imports
enabled. Its first successful production import was October 18, 2026 at
11:00:30 AM CDT (`2026-10-18T16:00:30Z`), with status `synced`. The scheduled
importer validates Meta account access, campaign ownership,
USD currency and timezone before accepting any spend. Saving the source is not
proof that the saved token has that access. This configuration does not publish
or change ads, and it does not activate instant-form intake or CRM feedback.
The importer reads seven completed account-local days, not today's running
spend; a newly launched campaign may have no usable acquisition-cost average
until completed-day spend and attributed leads exist. Never treat missing
campaign costs as zero or silently manufacture an estimate.

## Response optimization

Owner operations shows real response rate, address confirmations, qualified
offers, cost per response and median time to first accepted outreach. The 24-hour
response cohort excludes leads younger than 24 hours. Delivery receipts,
voicemail, automated replies and opt-outs do not count as positive responses.
Missing ad costs remain pending, never zero. In Lead costs, use the Meta campaign
ID as the tracking campaign, connect its actual spend report, or record a labeled
source/campaign estimate. Acquisition keeps current 2x pricing and the 20% VIP
discount, with no change to previously settled charges.

Optional CRM feedback uses the existing seller dataset/CAPI access token and the
separate `META_INSTANT_CRM_EVENTS_ENABLED` flag. Stages are `InstantFormReceived`,
`SellerResponded`, `PropertyAddressConfirmed` and `CashOfferReady`. They carry the
original Meta lead ID and stable event IDs; they contain no transcript, address
or speculative offer. Verify event mapping in the connected Meta dataset before
enabling or selecting a campaign optimization event. This code does not change
the campaign objective or promise that Meta has sufficient conversion volume.

## Local verification

Run `node --experimental-strip-types tests/meta-instant-leads.test.mjs`,
`node scripts/test-meta-instant-leads-pglite.mjs`,
`node --experimental-strip-types tests/seller-address-fallback.test.mjs` and
`tsc --noEmit --incremental false`. Fixtures exercise signed receipts, consent
bindings, spoken address evidence, single-segment links, canonical deduplication,
same-record promotion, unknown-result protection, Run/Pause, text-only requests,
wallet admission and private RPCs. The CI suite also executes the real final SQL
admission chain and verifies evidence-preserving recovery of an unsent first call.
Contact-only cards show call/text history and
Pause/Resume; their manual SMS composer becomes available after property matching.
All provider transports are local fixtures. PostgreSQL fixtures use a schema-only
snapshot and isolated billing/provider delegates, not production account rows.
# Owner-requested historical imports

For an owner-selected export batch, register only the new source/Meta lead ID
pairs in `icash_meta_import_priorities`, with a batch reference to the original
export. This service-only marker chooses the eligible client whose last inbound
seller assignment is oldest, using account creation when they have never received
a lead. Both website assignments and unfinished Meta contacts reset the wait.
Existing funded membership, Run/Pause, channel and billing-review checks still
apply. The normal VIP/weighted rotation remains unchanged for unmarked leads.

Submit original records oldest first through the authenticated Make receiver,
preserving Meta timestamps and ad/set/campaign IDs. Remove only Meta export ID
prefixes (`l:`, `f:`, `ag:`, `as:`, `c:`). Exclude known tests and already imported
IDs before sending; do not replay an existing ID with corrected attribution.
Priorities never reassign existing contacts or create another outreach attempt.
