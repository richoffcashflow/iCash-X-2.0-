# DealMachine integration review — September 28, 2026

Status: documentation reviewed; no authenticated vendor request made, no provider credits spent, no live data integration enabled. The DEALMACHINE_API_KEY environment variable exists in Production and Preview; its value and API entitlement have not been inspected.

## Verified public interfaces

The newer API uses https://api.v2.dealmachine.com/v1 with bearer keys documented as dm_sk_live_. Search supports estimate_cost=true and free count endpoints. GET /v1/usage reports the billing period and available credits. Property and person records are separately billed; returned contacts can increase a property query's cost. contact_audience=none avoids people credits for property-only screening. Same-entity deduplication is within a billing period, not perpetual free reuse. Default workspace request limits are 60/minute and 5,000/day.

Classic uses https://api.dealmachine.com/public/v1/. Its documented lead operations and limits differ. Do not send a key to multiple API versions as an automatic fallback; first identify its intended version and entitlement.

## Public price snapshot, not the customer's contract

Basic: $99/seat/month with 10,000 data credits. Pro: $149/seat/month with 20,000. Scale: $599/package/month with 100,000 and 10 seats. At full utilization the allocated subscription cost per included credit is $0.0099, $0.00745, and $0.00599 respectively. These calculations exclude unused capacity, extra credits, tax and any negotiated platform license. They are not marginal API prices or customer credit prices. Property plus contacts may use multiple credits.

## Rights needing confirmation

The published terms (effective July 14, 2026), sections 2(b) and 2(e), describe internal use and restrictions on making services available to others and competitive services. Public API availability alone does not confirm the planned multi-customer product license. Obtain the relevant Order Form or written API/platform agreement covering iCash X's own account serving customers, property images, contact display, retention, caching, and aggregate learning. Monthly billing deduplication does not establish caching or cross-customer reuse rights.

## Implementation sequence

1. Identify API version and inspect the actual account plan using documented non-billable metadata only. Keep credentials server-side; return sanitized capability/health results to administrators only.
2. Verify applicable platform/data rights and record the approved retention policy. Keep live delivery disabled until this is resolved.
3. Discover valid filters/fields; perform free count and estimate requests for one approved market. Keep pages small. Rank property-only results before selectively requesting contacts.
4. Reserve customer spend and provider capacity atomically before paid dispatch. Enforce tenant daily limits plus a global workspace request/credit cap. Preserve capacity for active contracts and callbacks.
5. Store actual returned credit counts, billing period, pricing version and operation ID. Reconcile responses/invoices. A timeout has unknown cost: do not blindly retry, refund or release its reservation.
6. Treat estimates as estimates, partial results explicitly, and unknown cost/rate cards as a stop condition. Use integer micro-units for sub-cent cost calculations. No customer charge or margin claim is finalized from this snapshot.
7. Produce real activity only from persisted results. No activity events from cost estimates should claim a property was acquired or a seller contacted.

## Sources

- https://dealmachine.com/guides/api-quickstart
- https://api.docs.dealmachine.com/concepts/credits
- https://api.docs.dealmachine.com/introduction
- https://docs.dealmachine.com/
- https://dealmachine.com/pricing
- https://dealmachine.com/terms-of-service

## Implemented preflight (not a live acquisition integration)

`npm run dealmachine:preflight -- 75201` checks usage, a ZIP-scoped count, and an estimate-only search in a trusted server runtime with DEALMACHINE_API_KEY injected. Omit ZIP for usage only. No property/contact retrieval is exposed, no retries are automatic, redirects are refused, and provider errors are sanitized. Tests use mocked transport; no authenticated provider check has run. Remaining work includes authenticated verification, durable global rate limits and credit reservations before any billable retrieval.
