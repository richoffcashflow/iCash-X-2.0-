# DealMachine owner data review — October 27, 2026

The seller pipeline buys property intelligence first and owner contacts only after financial screening. It explicitly requests `contact_audience: none` for property research, then obtains a free `contact_audience: owners`, `enrich: false` property preview. The paid `/v1/people/ids` request contains only the selected property-bound owner IDs, deduplicated across a batch, with `include_properties: false`.

The shared selector now excludes an owner when the free preview explicitly reports `availability.phones: 0`. Exclusion happens before the contact cap and before a money reservation or paid request, for both single-property and batched paths. Missing/null availability remains unknown for older preview compatibility. Invalid or conflicting duplicate metadata holds before purchase. A non-owner `contact_type` cannot be overridden by a contradictory `is_likely_owner: true`. Actual ownership is still unverified until confirmed; contact eligibility uses the existing separate rules.

Read-only inspection of the latest 50 completed production owner batches found nine purchased contacts without phones among 232 returned people. The matching free previews reported zero phones for those nine. This is evidence for the selection fix, not a claim of realized savings or a provider invoice attribution. No paid requests were issued for this review.

## Existing property selection

All discovery strategies require Single Family and at least 70% provider-estimated equity. The four existing audiences are baseline, vacant, absentee-owner and repair-heavy properties. Their allocation uses verified outcomes and cost evidence. Research query v2 also requests no active lien, no HOA lien and no delinquent-tax flags. Local screening independently checks debt, numerical liens, repairs, fees and the lowest available equity estimate before buying contacts. Returned property receipts are retained even when a record fails screening.

Numeric open-lien fields must not simply be filtered with `<= 0`: all 1,660 eligible records in the inspected 24-hour sample had NULL `num_total_open_liens`, while 1,672 held records reported a positive value. The provider's documented AND-only predicates do not express the needed “NULL or zero” condition. Reintroducing the old numeric filter would discard usable inventory. Keep the local screen and original query versions until a supported upstream condition is verified. The existing provider exclusion-list optimization is currently disabled; do not claim it is active or replay the old uncertain exclusion query.

## Phone activity capability gap

The current API docs and OpenAPI schema support `active_phones_only: true` on `/v1/people/export` and `/v1/properties/export`. It removes phone numbers with inactive **or unknown** reported activity. Export is a separate synchronous CSV/gzip workflow with signed downloads, its own result/credit schema, and a recommended 120-second client timeout.

The schema does **not** list this option on `/v1/people/ids`. Its phone objects contain number, line type, DNC status and carrier; the latest saved production responses have exactly those fields, with no phone-activity status. `availability.phones > 0`, a carrier, or a wireless line is not evidence of an active number. Do not add an export-only flag to a lookup and assume it was applied.

Full phone-activity scrubbing is therefore **not enabled by this release**. It requires either a provider-confirmed lookup capability or a separately implemented export acquisition path with exact owner-ID scope, durable export receipts/download recovery, bounded concurrency and net-credit settlement. Preserve the original caller/contact and financial controls; do not infer zero charges from filtered-out rows or retry an uncertain export. Development simulations remain disabled unless the owner approves a concrete spend limit.

The live, free catalog read on October 27 confirmed `has_active_phone_number` as a non-premium BOOLEAN people filter and field, with no direct person-ID filter or per-number activity field. The existing-export inventory was empty, so no previously purchased export can establish the CSV header/owner-ID/phone format. These checks made only free GET requests; they did not retrieve contacts or create an export.

## Prepared verification, disabled

`scripts/verify-dealmachine-active-export.mjs` prepares one exact-owner export with `active_phones_only`, `require_phone`, `scrub_dnc`, and `property_match: owner`. Its fixed request includes exactly one previously saved property-bound owner ID and people fields only: at most **one DealMachine people data credit**, under the documented per-entity pricing. No new property fields, broad audience, second purchase, automatic retry, call, message, customer-wallet charge, top-up or billing change is included.

The executable still stops at the existing global paid-development-test prohibition and is not a build hook. Enabling it requires fresh explicit owner approval, a reviewed executable, and a service-only approval row with the exact request hash, one-credit cap, owner/source binding and one-hour maximum expiry. A conditional claim consumes the approval once before the request; an uncertain claim, network outcome or receipt write never authorizes replay. The original response, including actual reported credits and errors, is retained in the private integration-check row before interpretation. No approval row or paid request has been created.

Offline fixtures cover concurrent attempts, absent/expired/changed approval, source mismatch, a lost claim response, a lost export response, failed receipt persistence, exact one-person scope and the executable stop. The export format remains unverified until the bounded test is explicitly approved and run; this preparation does not turn on production scrubbing.

## Verification

Synthetic fixtures cover phone-less, mixed, missing, malformed and contradictory previews; filtering before the paid cap; shared owners across properties; exact paid ID sets; no reservation on an empty audience; and unchanged actual cost and DNC/source evidence. The actual single-property and batch services are exercised with mocked transport. No customer data, wallet, source configuration or outreach controls are rewritten.

Sources reviewed:

- https://api.docs.dealmachine.com/concepts/credit-efficient-queries
- https://api.docs.dealmachine.com/api-reference/properties/search-properties
- https://api.docs.dealmachine.com/api-reference/people/get-people-by-ids
- https://api.docs.dealmachine.com/api-reference/people/export-people
- https://api.docs.dealmachine.com/api-reference/openapi.json
