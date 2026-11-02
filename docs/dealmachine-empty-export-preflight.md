# DealMachine empty-export prevention

The November 2 investigation found a recurring provider failure mode: most failed records in the saved organization export inventory report no records remaining after phone scrubbing, while original POST responses contain only HTTP 500, `internal_error`, and a request ID. That history is not bound to individual purchases by timestamp and cannot establish their costs.

Two separate free checks examined the exact five owners in the currently held November 2 request. The first created a people list successfully but immediately counted zero unfiltered records; it stopped and deleted that list. The second confirmed all five person IDs with `enrich:false`, explicit zero credits, then created another list. After 30 seconds, list readback and the unfiltered count both reported five. The active-phone plus non-DNC count was zero. Both temporary lists were deleted. The checks made ten free provider requests in total and no exports, paid lookups, contact downloads, calls or messages. Exact original responses are private in `icash_integration_checks`, under the two `dealmachine_owner_count_review_20261102_v*` records.

## Resulting behavior

- New contact batches create an exact-ID people list with `add_as_prospects:false`. The durable claim permits only one creation attempt.
- A later worker capability, at least 30 seconds later, requires an unfiltered list count equal to the number of selected owners. Zero, partial, malformed or uncertain baseline counts hold the batch; they never mean that no owners qualify.
- Only then does a free count apply `has_active_phone_number` and `has_non_dnc_phone`, with `has_wireless_phone` for the mobile pool. A verified zero removes all original sibling snapshots from contact selection and the pending research buffer, allowing later work to proceed without a purchase or reservation.
- Positive counts permit only the unchanged owner-bound active/DNC export. SQL independently requires the exact account, items, request and a recent positive preflight before paid admission. The existing wallet, quota, scope and duplicate checks remain authoritative.
- Preflight creation/count receipts are private and immutable. Database acknowledgment recovery saves only the identical original response. Provider errors, timeouts and unknown list creations never become a new creation attempt. Cleanup deletes only the list bound by its original matching name/type/ID receipt, with at most three separately claimed free cleanup attempts.
- Aged failed or interrupted checks appear in the existing owner-export monitoring. Original export money and delivery holds remain untouched.

## Limits and release checks

The person-level active and non-DNC flags may describe different phone numbers. A positive count does not guarantee a nonempty export; the actual export still performs the required phone-level filtering. A later ambiguous export keeps its original hold and needs its own reviewed capacity check. No historical receipt is converted to success or zero cost.

List membership uses verified safe numeric internal IDs; larger identifiers are held without rounding. Source changes, account changes and different mobile/active cohorts cannot reuse another preflight. A failed baseline does not discard good leads. The new settings install inactive; enable only after matching API/worker releases and exact-commit CI pass. Review the current HTTP 500 separately through the existing one-use free inventory procedure before restoring its shared capacity.

Offline tests exercise zero and positive counts, sibling selection, stale/foreign sources, malformed data, uncertain creation, receipt-save acknowledgment loss, cleanup, SQL privileges and final purchase gating. Native PostgreSQL tests contend across multiple real sessions for list creation, receipt saving, count work and cleanup. Live free verification above is evidence for the preflight API contract; it is not a new paid export test.

Official references: [Create list](https://api.docs.dealmachine.com/api-reference/lists/create-list), [count people](https://api.docs.dealmachine.com/api-reference/people/count-people), [people preview](https://api.docs.dealmachine.com/api-reference/people/get-people), [export people](https://api.docs.dealmachine.com/api-reference/people/export-people).
