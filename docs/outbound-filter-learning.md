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

New groups receive balanced page batches, including at least one batch for each
available audience in the current revision. Feedback is reevaluated before each
new batch. A group with at least 10 actual attempted properties, three confirmed
interested properties and complete costs can receive two learned slots in every
five batches immediately. Once at least 30 attempts are resolved, that can rise
to three slots. The remaining slots keep exploring; another group's slow results
or unsettled charges cannot freeze a fully settled candidate. One reply cannot win.

Ranking shrinks small samples using the Wilson lower endpoint with z=1.645 on
confirmed interest divided by all actual attempts. Multiply by attempts, subtract
half the opt-out count, floor at zero, and divide by settled customer cents plus
1,000 cents. Pending attempts earn no assumed reward and are never saved as failed
outcomes. The endpoint follows NIST's worked formula:
https://www.itl.nist.gov/div898/handbook/prc/section2/prc241.htm.
This is an allocation heuristic, not a significance test on adaptive samples or
an answer-rate guarantee. The objective is interested properties per dollar;
raw replies, ownership confirmations and call volume cannot earn promotion.

Three consecutive settled pages containing only duplicates or completed empty
owner previews reduce that audience to periodic probes. Cooled audiences share
one probe slot per five batches, balanced by page count. A productive probe restores
normal exploration; no audience is permanently discarded for poor results. If all
audiences cool, balanced searching remains available. Queued screening, financial
holds, held owner lookups, unpaid/uncertain operations and unanswered outreach are
not evidence of a wasted page. Provider pagination and free empty/unsupported
estimates can still exhaust an arm.

Evidence is restricted to the same account and ZIP over 90 days. Confirmed interest
and opt-outs are available immediately. An unanswered actual call/text attempt
remains pending for 72 hours; only then does it mature. SMS maturity starts from
the latest saved send/delivery receipt timestamp, never queue creation. Late
webhooks conservatively extend the window. Interest requires a completed call
with a seller response and a saved positive interest result, or a strict affirmative
reply directly after the receipt-backed selling-interest SMS. A YES to ownership,
voicemail, queued message or STOP never counts as interested. Counts describe
unique properties, not dial attempts. Costs include unsuccessful and overlapping
research as well as bound owner lookup, call, text and email operations. Only
settled customer charges count; unresolved operations or missing required charge
receipts prevent that audience's learned allocation. No budgets or rates change.

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

The follow-up migration `adaptive_outbound_feedback` is additive: apply it before
deploying the new service. No flag change, cursor reset or outcome backfill is
needed. The additive `outbound_feedback_receipt_clock` correction supplies the SMS
receipt clock without rewriting queued messages or charges. Old applications retain the original delayed-feedback RPCs; rolling back
the application restores their allocation policy without discarding claimed work.

`icash_discovery_filter_feedback(account_id, zip)` returns private live aggregate
evidence, including pending attempts and recent unproductive pages.
`icash_discovery_filter_state_v2(account_id, revision, sequence)` adds the current
cursors and initializes a new revision; it is not a public reporting API.
The tables and functions are service-role only. Use the pages table to inspect
empty, unavailable, claimed and completed outcomes. Compare confirmed interested
properties and actual settled cost over comparable periods. Keep unique-property
attempts separate from dial counts and human-answer rates. New allocations do not
prove an improvement; measured production results must establish that.

Rollback: disable row 1 to stop choosing new experimental plans. Already claimed
plans retain their recorded input and are saved with the filtered receipt RPC.
Do not delete claims, reset cursors, or release unknown charges to force a retry.
Legacy baseline discovery resumes using the global operation sequence, so rollback
may skip baseline pages; re-enabling uses the saved per-filter cursors.

Local verification uses synthetic provider responses and isolated PGlite. It
checks owner selection, early/established allocation, bounded cooling/recovery,
budget delegation, cursor scope, immutable claims, deduplication, free empty results,
immediate SMS/call evidence, delayed negatives, missing/settled costs, account/ZIP
isolation and opt-outs without spending provider credits.
