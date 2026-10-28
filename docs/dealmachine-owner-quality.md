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

## Verification result and separately approved retry

The first provider attempt ran at 7:11 PM Central on October 27 (00:11 UTC October 28), after the local quota reset. DealMachine returned HTTP 500 with `internal_error` and request ID `req_a830c75ddfd7b99b`. Its original raw response is saved privately. It contains no export ID, download or credit receipt: the cost is **unreported**, not zero. The v1 approval is consumed and its original deferral cannot be reused. Phone-activity integration remains unverified.

The owner subsequently said "try again". A separate v2 approval permits one additional attempt with the same exact owner/request and a maximum of one additional people data credit. It must reference v1's saved run and error request ID, retain its source binding, pass the existing quota and claim checks, and expire within one hour. The preview runner now selects only v2; it cannot reset or replay v1. A saved/unknown v2 outcome is terminal. This adds no automatic retry, calls, texts, customer-wallet charge, funding or provider billing change. All other paid development tests remain disabled.

That v2 attempt ran at 9:17 PM Central on October 27 (02:17 UTC October 28) and also returned HTTP 500, request ID `req_d20799be079dfd90`. Both separate approvals are consumed. Neither response supplies an export/download or reported credit usage. Preserve the unreported costs and both raw receipts; this failure does not establish the underlying cause or authorize a third request.

### Free contract checks after the failures

The export request's selected fields are now checked against the complete free people-field catalog before any approval claim or paid quota admission. Each exact selector must be unique and have a confirmed people/address-context billing category. Missing aliases, duplicates, incomplete catalogs and unknown/property billing categories hold without spending. The historical request body/hash is unchanged; the checker never substitutes a guessed alias or reuses an old approval for a new body.

The saved catalog exposed `person_full_name`, but did not list the requested `dm_person_id`, `full_name` or `phones`. The public export examples nevertheless use `full_name` and `phones`. This inconsistency leaves the field contract unverified; it does not prove that the aliases caused the server error. A JSON response identity is not proof of an exported owner-ID column.

History inspection now omits the completed-only filter and examines at most five exports across all states, with bounded metadata detail reads for failed, pending and processing entries. Pagination or unknown states hold admission; an active export also holds. This check is an additional guard, not the organization-wide atomic concurrency mechanism still required for production. History candidates are never associated with an owner merely by time, and no history URL is automatically downloaded.

The exact trusted preview saves raw field/history/detail responses in an insert-only, service-only integration-check snapshot keyed by commit. Rebuilding that commit reuses its snapshot. Console output contains only sanitized schema/status/count summaries, never contacts, provider messages, export IDs or signed URLs. Production and CI skip these live metadata reads. The free inspection runs early in the verified preview build; it does not create or reset a paid approval.

The first corrected free history read found two failed exports and no completed, pending or processing entries. Both detail records report no records remaining for export and mention active-phone filtering; no files or credit receipts are supplied. Sanitized diagnostics preserve that reported failure category without printing the free-form provider message. It does not establish an exact owner/request binding, prove which filter excluded the records, or authorize treating HTTP 500 as success or zero cost.

### Original preparation and quota history

`scripts/verify-dealmachine-active-export.mjs` prepares one exact-owner export with `active_phones_only`, `require_phone`, `scrub_dnc`, and `property_match: owner`. Its fixed request includes exactly one previously saved property-bound owner ID and people fields only: at most **one DealMachine people data credit**, under the documented per-entity pricing. No new property fields, broad audience, second purchase, automatic retry, call, message, customer-wallet charge, top-up or billing change is included.

The owner explicitly approved this one-credit verification on October 27. The standalone command retains the global paid-test stop. A narrow preview build entry point, `scripts/run-approved-dealmachine-active-export.mjs`, is restricted to the original repository, exact preview branch, production database identity and private request-hash approval. Production and CI cannot invoke the paid check.

At 5:16 PM Central, the shared local quota limiter denied admission: 4,900 of 4,900 daily requests had been used. The private request record confirms `admitted: false`, `outcome: quota_wait`, no provider response and no finished request. **No export request was sent and no data credit was used.** The daily window resets at 7:10:37 PM Central on October 27. Do not raise/reset the limiter to complete this test.

The original approval and denied-request record are preserved. A single service-only deferral records the exact original run, database non-admission proof and a 7:10:37–7:45 PM Central execution window; it does not reset the row to `approved`. The deferred preview first checks that capacity is available, then uses a compare-and-swap claim bound to the original run and deferral ID. A lost claim, started request, network uncertainty or saved response permanently prevents another export. The request remains exactly one saved owner, with the same one-credit cap; no calls, texts, wallet charge or provider billing change is allowed.

The original provider response, including reported credits and errors, is saved before interpretation. The free artifact reader accepts only that response's single HTTPS Google Storage download, verifies a bounded one-row CSV and saves the original file privately. Build output contains only field names and value shapes, never contact data or signed download URLs.

Offline fixtures cover concurrent attempts, absent/expired/changed approval, source mismatch, a lost claim response, a lost export response, failed receipt persistence, exact one-person scope, the executable stop, non-admission deferral, quota waits and the inability to defer a provider attempt. The export format remains unverified after both failed attempts; this preparation does not turn on production scrubbing.

### Historical first-attempt continuation (consumed)

The original continuation used draft PR #482 (`codex/dealmachine-active-phone-contract-20261027`), the private v1 row and its original non-admission proof. It required `waiting_for_quota`, the unchanged request hash, no admitted request, available quota and the saved execution window. That continuation has completed with the HTTP 500 above; these conditions are historical and do not authorize another export.

Inspect the saved credit receipt and sanitized CSV schema from that build. A saved response permits free inspection of its original download, never a replacement export. Missing/uncertain/error results remain held. Production phone activity support still needs exact owner-to-row mapping, original export receipt/download recovery, organization-wide export concurrency and actual net-credit settlement; it must not be declared active merely because the test completes.

## Verification

### Separately authorized free preview above the local cap — October 28

The owner authorized testing above the app's exhausted 4,900/day safety cap. `scripts/check-approved-active-phone-preview.mjs` is restricted to the same trusted preview repository/branch/database and a separate private approval for its exact reviewed commit. A one-use compare-and-swap occurs before either of its two possible provider requests. It does not reset/increase shared quota or reopen either paid export.

The first request reads the free people-field catalog and records the provider's current per-minute/daily quota headers. Missing/empty quotas, an incomplete catalog or a 429 stop the check. The second request can only read the original owner through `/people/ids` with `enrich:false`, `include_properties:false` and `fields:["has_active_phone_number"]`. The historical source is used only to bind the identity; no source age, DNC or outreach permission is renewed. Raw responses are private. Zero cost requires an explicit zero-credit receipt. An omitted/null/malformed activity field is unknown, never false, and does not prove active-number scrubbing.

This replaces repeated catalog/history reads in this preview's verified build. The ordinary owner-capability inspector skips this exact preview branch so rebuilds cannot add unclaimed catalog requests. The completed export-history snapshots and standalone inspectors remain available; production behavior is unchanged. No provider export, enriched contact purchase, calls, texts or customer-wallet transaction is part of this test. At preparation time the live result is unverified.

V1 ran at 11:21 AM Central on October 28. The catalog GET succeeded; the preview POST returned HTTP 400 `fields requires enrich=true`, request `req_1bd9d773bab87f1e`, with no credit receipt. Its two raw responses remain private and immutable. Fresh headers reported 60/minute and 5,000/day, with 4,984 daily requests remaining after that POST; the app's separate rolling quota remained 4,900/4,900. V2 is a distinct free check bound to this exact rejection and the same historical owner. It removes `fields` and inspects the default `enrich:false` response, again with at most two requests, zero requested credits and no automatic replay. The total allowance for these two free checks is four requests.

Synthetic fixtures cover phone-less, mixed, missing, malformed and contradictory previews; filtering before the paid cap; shared owners across properties; exact paid ID sets; no reservation on an empty audience; and unchanged actual cost and DNC/source evidence. The actual single-property and batch services are exercised with mocked transport. No customer data, wallet, source configuration or outreach controls are rewritten.

Sources reviewed:

- https://api.docs.dealmachine.com/concepts/credit-efficient-queries
- https://api.docs.dealmachine.com/api-reference/properties/search-properties
- https://api.docs.dealmachine.com/api-reference/people/get-people
- https://api.docs.dealmachine.com/api-reference/people/export-people
- https://api.docs.dealmachine.com/api-reference/openapi.json
