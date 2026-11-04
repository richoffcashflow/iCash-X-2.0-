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
new batch. Local promotion requires at least 100 resolved attempted properties
for every compared productive audience, ten confirmed interests for the winner,
and complete positive settled costs throughout the comparison. The winner's
95% Wilson lower bound, expressed as interests per settled customer cent and
penalized by half its opt-out count, must exceed every competitor's upper bound
by more than 5%. A qualifying winner receives three of five slots; otherwise
ordinary balanced exploration continues. Missing costs, sparse positives and
overlapping comparisons never earn extra allocation.

Shared promotion uses the same `evidence-v2` decision helper as other learning
policies, with its additional multi-account and mature-outcome requirements.
Pending attempts are excluded from both the resolved success-rate denominator
and the matching reward multiplier. They remain unknown rather than failures.
An audience with at least 20 attempts, three opt-outs and an opt-out rate over 5%
is excluded from both learned and exploratory allocation while that evidence
holds. Local and shared evidence cannot bypass each other's safety exclusions.

These observational confidence bounds are not a causal significance test on
adaptive samples or an answer-rate guarantee. Costs are settled customer charges,
not net profit. Raw replies, ownership confirmations and call volume do not earn
promotion; contracts and closings take priority only with sufficient mature,
verified shared evidence.

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
with a seller response and a source-verified selling-interest quote, or a strict affirmative
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
checks owner selection, evidence-gated allocation, pending-yield consistency, bounded cooling/recovery,
budget delegation, cursor scope, immutable claims, deduplication, free empty results,
immediate SMS/call evidence, delayed negatives, missing/settled costs, account/ZIP
isolation and opt-outs without spending provider credits.
