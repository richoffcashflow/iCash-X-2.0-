# DealMachine owner data review — October 27, 2026

## Filtered credit counts — October 29 Central / October 30 UTC

The first export after the reviewed capacity release completed with three owners, seven active-filtered phones and three used credits. The next successful provider response evaluated four owners, returned one row after filtering, and reported `credits: {used: 1, people: 4}`. The original response and CSV were saved, but the previous equality check incorrectly held persistence because it equated evaluated people with returned rows. New exports were paused during correction; another admitted request returned HTTP 500 and retains its own unresolved purchase and owner fence.

`credits.people` counts evaluated people, while `credits.used` reports newly charged credits ([provider response contract](https://api.docs.dealmachine.com/concepts/response-format#the-credits-object)). The receipt validator and SQL saver now require returned rows <= evaluated people <= requested unique owners. Actual used credits must still fit the delivered unique owners. Original aggregate fields remain unchanged; filtered-out owners receive no contact allocation or inferred charge. Missing, non-integer, excessive or contradictory counts remain held.

`supabase/migrations/20261030004249_owner_export_filtered_credits.sql` changes only that guard in the existing saver, retaining its grants, receipt bindings, atomic contact persistence and settlement. Recovery uses the original saved CSV without a new provider request or purchase. Offline regression cases exercise four requested owners, one returned owner, one actual credit, zero allocation for an excluded property, invalid counts, and unchanged raw provider evidence.

## Capacity recovery — October 29

Provider inventory timestamps can discard fractional seconds. A batch admitted at `01:18:58.133Z` was followed by a fresh complete idle inventory whose newest timestamp was `01:18:58.000Z`; the original comparison incorrectly held capacity. Migration `20261030012215_owner_export_capacity_precision.sql` compares the incident at the provider's whole-second precision. An inventory ending in the preceding second remains invalid, and every other completeness, freshness, quota and idle-state check is unchanged. This timing check never associates a provider history row with an owner or cost.

The already-held review is immutable. An operator can create one distinct follow-up linked through `supersedes`, only when its parent has complete idle evidence and this exact fractional-second mismatch. Root reviews remain unique per export, follow-ups unique per parent, and follow-ups cannot themselves have follow-ups. Each uses the existing one-request quota admission and fresh status check. No approval, counter, original export, owner fence or money hold is reset; future failures are not automatically reviewed.

The owner requested activation again and asked to repair the global blockage. The original HTTP 500 does not establish its cost or successful completion. It also must not be confused with evidence that an export is still running. `config/owner-export-capacity-recovery.sql` keeps those facts separate.

An operator can arm one private review bound to that original completed HTTP response, its immutable receipt hash and the reviewed release. With shared quota available, authenticated production maintenance claims one free `GET /v1/exports?limit=100&offset=0`. Errors, partial/empty inventory, old-only inventory, duplicate IDs, missing quota headers, any pending/processing/unknown state, stale evidence and a lost response keep capacity held. No paid request or download is part of this check. Its raw response is private and immutable. Production code does not automatically arm reviews for later failures.

A verified complete idle organization inventory releases only scheduling capacity. It does not associate any history row with the original owner, set that original export's terminal/completed timestamps, release its financial operation, fabricate a credit receipt or settle a charge. The original owner remains excluded from new lookup/export purchases, even through another property or account. The next unrelated export still uses the existing single-export lock/index, exact owner/DNC/activity contract and actual-credit settlement. A later unknown export retains its own capacity hold.

The schema installs without a review or activation. Roll out matching API/worker releases and full offline checks before arming the exact incident and requesting active mode. While quota is exhausted or the provider check is unresolved, a configured switch does not establish live filtering. Verify subsequent ordinary funded export receipts before claiming live results. Keep the 50/minute and 4,900/day limits, consumed paid tests and demonstration funding unchanged.

## Rollback state — October 29, 03:00 UTC

The first ordinary funded production export returned HTTP 500 `internal_error` at 02:46:38 UTC with one requested owner. It supplied no export ID, download, record count or credit receipt. Cost is **unreported**, not zero. At 02:49:47 UTC new exports were disabled; the original receipt, organization slot and financial operation remained held. Existing owner-only lookup research resumed. The later capacity-only recovery above is the sole reviewed exception to the global scheduling hold; it does not reconcile or repeat this purchase. See `docs/research-efficiency-replies.md` for the subsequent request-efficiency and preflight changes.

## Production export release — October 28 Central / October 29 UTC

V3 completed at 8:23 PM Central on October 28: HTTP 200, one exact property-bound owner, one non-DNC wireless number from three previously saved numbers. The numeric `internal_person_id` CSV value matches the requested `per_` suffix as text. Original-ID recovery and the original Google Storage CSV were verified. The actual receipt is `credits: {used: 0, people: 1}`; `properties`, `deduplicated` and `licensed` are absent. Their absence does not establish a deduplication reason. The other two numbers being absent does not establish why they were removed. This test approval is consumed.

The production candidate in `lib/owner-active-export.ts` uses that exact selected-field/owner/active/DNC contract for both one property and up to five properties. It replaces the paid people lookup for new work when `icash_research_private.owner_export_settings.enabled` is true. The existing property preview, financial screen, funded admission, manual control and contact rights remain authoritative. Shared owner IDs occur once in the export. There is no fallback purchase through `/people/ids` after any export attempt.

`config/owner-active-export.sql` installs disabled. Admission takes an organization advisory lock and persists a unique unfinished-export slot in the same transaction as shared quota and all existing reservations/claims. A timeout or missing export ID never releases that slot from elapsed time or an empty history search. An exact successful original response or original-ID terminal GET can establish provider completion; financial holds remain until actual usage and the CSV validate. External concurrent exports are still subject to DealMachine's own organization limit.

Raw responses, original request, raw CSV, SHA-256, recovery receipts and original admission time are private. Recovery is bounded to six leased attempts, at least ten minutes apart after the initial attempt, and can only GET the original export ID/download or persist its already saved CSV. Unknown paid work cannot be replayed. Missing/changed columns, unmatched/duplicate IDs, DNC/activity contradictions, unknown credit fields or inconsistent totals hold without enabling contacts or settling charges.

The export receipt's `used` and `people` fields have their own contract. Each saved property retains the unmodified aggregate provider credits plus an explicit `active-export-used-order-v1` allocation of actual used credits across unique returned owners. Missing provider fields are never manufactured. SQL independently checks owner-to-row association, phone/DNC values, complete allocation and the original CSV hash, then atomically saves all contacts and reuses existing actual-cost settlement. Final source admission requires the matching completed private export and original request start time. No source permission or ownership verification is invented.

`config/owner-active-export-sources.sql` preserves the legacy lookup credit manifest and adds a separate export manifest bound to the original private receipt, CSV hash, allocation and actual used-cost observation. DNC ingestion and both voice/SMS preparation accept shared-owner allocations without requiring invented lookup credit fields. Final checks still reject changed source, tenant, cost or revoked observations. Offline tests use actual SQL for admission, atomic allocation/settlement and this contact handoff; PGlite serializes SQL and does not establish multi-session contention behavior.

Release order: full offline CI; install the disabled migration; deploy matching Vercel API and Railway worker; verify both exact release commits; enable the private switch; observe ordinary funded production receipts without creating a development purchase. Rollback disables the switch for new work and leaves original export recovery and holds intact. The API allows 240 seconds, research/general worker requests 235 seconds, and their stall monitor 260 seconds so the documented 120-second provider timeout has time for receipt persistence. Other pools retain their shorter deadlines.

Incoming communications audit: the signed text alias/reply UI fixes are already on production main from earlier releases. The recorded incoming-call lane has current enabled normal configurations and completed, settled receipts through October 28. Recent lifecycle messages with no property route had no matching property thread or prior property outgoing message; no saved incoming property event was missing its message. No new paid call/text was placed to test this release. A new post-release incoming text receipt is still needed to establish live end-to-end evidence for the corrected aliases.

The remaining sections retain the earlier diagnostic history; statements that exports were unverified describe those earlier checks.

## Bounded continuation — October 28 Central

The owner said "keep testing" after learning that the quota reset but prior allowances were consumed. A separate v3 diagnostic permits one additional exact-owner export with at most one people credit and one paid POST. It uses another previously saved property-bound owner; phone count is only candidate selection, not evidence of activity. Its request replaces unconfirmed aliases with the catalog-listed people fields `person_full_name` and `has_active_phone_number`, and retains `people_ids` (one), `property_match:owner`, `anchor:person`, `limit:1`, `require_phone`, `scrub_dnc` and `active_phones_only`.

Only a private approval for the exact reviewed commit/request/source can execute, within one hour. A full-row compare-and-swap consumes it before any provider read. It admits at most four requests through the unchanged shared quota: one people catalog GET, one bounded all-state export history GET, the single export POST and one free GET of that original export ID. Missing/contradictory metadata, stale or exhausted provider quota, active/incomplete history, errors and uncertain results stop without a paid retry. The two exact non-premium people selectors use documented people-export pricing; absent catalog billing categories remain absent, and any explicit conflicting category blocks spending.

The original response and raw credit fields remain private. A successful export permits one bounded free GET of its original Google Storage download, saving its CSV privately. Missing ID/phone columns or incomplete financial fields remain unverified. A successful diagnostic does not enable production filtering or settle customer money. Production/CI skip it; demonstration funding, existing approvals, account automation, calls/texts and billing configuration remain unchanged. Preparation fixtures cover concurrency, exact scope, quota/expiry races, changed approvals, source conflicts, failed receipts and no replay. Live results will be recorded after execution.

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
The October 28 efficiency release also keeps eligible sibling properties when the first property's free preview has no usable owners. It creates no purchase for the empty property and retains the original whole preview and one paid batch receipt. Version-matched static duplicate-page reuse and disabled-list sync suppression are described in `docs/research-efficiency-replies.md`; provider exclusions and active-phone exports remain unverified.

Synthetic fixtures cover phone-less, mixed, missing, malformed and contradictory previews; filtering before the paid cap; shared owners across properties; exact paid ID sets; no reservation on an empty audience; and unchanged actual cost and DNC/source evidence. The actual single-property and batch services are exercised with mocked transport. No customer data, wallet, source configuration or outreach controls are rewritten.

Sources reviewed:

- https://api.docs.dealmachine.com/concepts/credit-efficient-queries
- https://api.docs.dealmachine.com/api-reference/properties/search-properties
- https://api.docs.dealmachine.com/api-reference/people/get-people
- https://api.docs.dealmachine.com/api-reference/people/export-people
- https://api.docs.dealmachine.com/api-reference/openapi.json


### One paid selected-field lookup above the local cap

After the two free checks, the owner explicitly authorized a paid active-phone test above 4,900 local requests. `scripts/check-approved-active-phone-lookup.mjs` prepares one new operation: one free field-catalog GET, then one `/people/ids` POST for the original exact owner with `enrich:true`, `include_properties:false`, and only `has_active_phone_number` selected. The documented exposure is at most one people data credit. The live catalog's missing `billing_category` remains missing; the check uses its exact non-premium people/contactability classification and the documented one-person lookup pricing, and stops on a contradictory category.

A distinct service-only approval binds the reviewed commit, exact request, historical owner source and prior terminal runs. It expires within one hour and is consumed by full-row compare-and-swap before either provider request. Fresh positive provider quota is required before the paid POST. Original responses and credit fields are saved privately; errors, missing receipts, timeouts and uncertain writes never authorize another purchase. Production/CI skip it, shared quota and customer money remain unchanged, and both old exports stay consumed. This check verifies a person-level response only, not per-number active/DNC scrubbing; it does not enable production filtering.
