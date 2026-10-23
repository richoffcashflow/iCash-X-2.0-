# Assignment-aware outbound inventory

An account could repeatedly pay the search overhead for pages whose properties
were already assigned to other customers. The save step correctly preserved
exclusive ownership, but the dispatcher reported returned rows as queued research.

Discovery now consults recent saved query pages and current exclusive assignments
before calling the provider. It advances known occupied pages without a lookup or
customer charge. Final admission repeats the check under the financial lock and
also prevents two accounts from purchasing the same page while its first result
is unknown. At most 64 cached pages advance in one pass. Provider timeouts retain
their original holds; this does not retry an uncertain purchase.

Each saved receipt records how many properties were actually queued. The API
reports `no_new_properties` when none were queued. Confirmed duplicate-only and
empty pages receive platform coverage in the settlement transaction, preserving
the real cost manifest, original debit and paired credit. Covered duplicates do
not consume the customer's prospecting allowance. A separate idempotent correction
RPC can restore an evidenced historical duplicate charge without changing history.

Nationwide accounts gain up to 200 additional ZIPs from fresh provider geography
metadata. Existing positive-equity market count receipts seed the pool; one free
location request per maintenance invocation refreshes and expands it in the
states already present in the approved shortlist. No customer is billed for ZIP
metadata. Explicit city/ZIP restrictions, data rights, state exclusions, Pause,
membership, contact permissions and the existing prospecting limits remain intact.
Three consecutive duplicate-only pages move an account to another eligible ZIP,
with a six-hour cooldown for that account's unproductive ZIP. Existing contacts
and active deals continue through their normal higher-priority paths.

Sources checked October 23, 2026:
- https://api.docs.dealmachine.com/api-reference/locations/list-locations
- https://api.docs.dealmachine.com/api-reference/properties/search-properties

Apply the migration before deploying the application. Existing applications may
temporarily receive an admission hold for known occupied pages until the new
preflight is deployed. The release performs no paid development calls or searches.
