# Outbound property filter learning

Four reviewed DealMachine property audiences retain the existing single-family,
70% equity requirement: baseline, vacant (`is_vacant_home`), absentee owner
(`has_absentee_owners`), and estimated repairs of at least $25,000
(`estimated_repair_cost`). These fields follow DealMachine's property-filter
reference at https://api.docs.dealmachine.com/reference/property-filters.
Every search remains property-only, uses the free estimate before admission, and
retains the existing small page size, funding allowance and dispatch protections.

Each account and discovery revision has an independent provider cursor for every
audience. The operation sequence remains unique across all audiences. Existing
baseline searches start at their current page. Overlapping properties keep their
first screening and attribution; they never create another outreach queue entry.
Empty or unsupported free estimates retire only that audience for the current
revision. Paid failures remain unresolved and cannot trigger a fallback request.

New groups receive balanced page batches. After every available group has at
least 30 mature attempted properties and complete costs, a group with at least
three interested owners can receive the three learned slots in every five batches.
The other two slots keep exploring. Ranking uses smoothed interested owners per
settled customer cent and penalizes opt-outs. This is a conservative allocation
heuristic, not a statistical significance claim or an answer-rate guarantee.

Evidence is restricted to the same account and ZIP over 90 days. A first actual
call/text attempt needs 72 hours to mature. Interest requires a completed call
with a seller response and a saved positive interest result, or a strict affirmative
reply directly after the receipt-backed selling-interest SMS. A YES to ownership,
voicemail, queued message or STOP never counts as interested. Counts describe
unique properties, not dial attempts. Costs include unsuccessful and overlapping
research as well as bound owner lookup, call, text and email operations. Only
settled customer charges count; unresolved operations prevent learned allocation.

Owner enrichment now filters the free property preview to likely owners before
applying the paid-person cap. Unknown people, renters, residents and family-only
matches do not consume paid lookup slots. A likely-owner match still does not
establish verified ownership or outreach permission. An empty completed preview
frees discovery queue capacity without recording a response or a paid receipt.

## Release and observation

Apply `outbound_filter_learning` with `icash_discovery_filter_settings.enabled`
false, deploy the application through its existing release gates, verify the
production commit, then enable row 1. No rates, budgets, provider approvals,
contact permissions or customer Pause values are changed by activation.

`icash_discovery_filter_stats(account_id, zip)` returns private aggregate evidence.
`icash_discovery_filter_state(account_id, revision, sequence)` also returns the
current cursors and initializes a new revision; it is not a public reporting API.
The tables and functions are service-role only. Use the pages table to inspect
empty, unavailable, claimed and completed outcomes. Do not interpret newly
activated groups as winners before their receipts mature.

Rollback: disable row 1 to stop choosing new experimental plans. Already claimed
plans retain their recorded input and are saved with the filtered receipt RPC.
Do not delete claims, reset cursors, or release unknown charges to force a retry.
Legacy baseline discovery resumes using the global operation sequence, so rollback
may skip baseline pages; re-enabling uses the saved per-filter cursors.

Local verification uses synthetic provider responses and isolated PGlite. It
checks owner selection, balanced/learned allocation, budget delegation, cursor
scope, immutable claims, deduplication, free empty results, mature SMS/call evidence,
settled costs, account isolation and opt-outs without spending provider credits.
