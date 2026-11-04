# DealMachine targeting experiments

This release extends reviewed main `96eccd3735859d8652865605103266f2da238c94`, including the PR488/489 active-export fixes, and incorporates subsequent main changes through `f339e397` (PR492/493/495). It does not change prices, budgets, plans, lead ownership, financial screening, lien/tax checks, suppression or unresolved purchase holds. Existing multi-number outreach remains unchanged; best-number ranking and sequential fallback are not implemented.

## Configuration and evidence

The owner-only `/admin` panel has a global pause and individual experiment toggles, with an authenticated same-origin API at `/api/admin/targeting`. Definitions are immutable; a changed range, date or buyer statement requires a new UUID. Each definition has its own cursor and attribution. All new switches ship off.

| Segment | Provider mapping | Interpretation |
| --- | --- | --- |
| Off market | `market_status / contains_any / [6]` | Live catalog confirms option 6 is Off Market; ID and label are rechecked. The documented `is_off_market` boolean is absent, so it is not sent |
| Sale 7–10 years | `last_sale_date / date_range`, fixed snapshot minus 10 through 7 years | Recorded-sale-date proxy, not verified ownership tenure |
| Sale over 10 years | `last_sale_date / is_before`, strictly before snapshot minus 10 years | Disjoint from the inclusive 7–10 boundary |
| Buyer requirements | `range` for explicitly supplied `estimated_value`, `num_bedrooms`, `num_bathrooms`, `living_area_sqft`, `year_built` | Never infer a value range from a buyer's maximum purchase offer |
| Out-of-state absentee | `has_absentee_owners` + `has_out_of_state_owners` | Provider ownership/address signals |
| Vacant absentee | `is_vacant_home` + `has_absentee_owners` | Combined experiment; not a global requirement |
| Mobile export | Existing exact owner export plus `mobile_only: true` | Active/DNC/owner rules remain; eligible landlines remain in the comparison pool |

The bounded metadata script reads `/account` and at most three property-filter pages through the existing shared quota. It never buys data or changes a plan. The October 30 preview reported Pro; the production receipt at November 4, 2026 03:05:54 UTC reports **Scale**, paid, and nonpremium access for all ten used property filters, including the exact off-market option. Catalog snapshots expire after seven days. Missing filters/operators, unknown/premium entitlements, stale snapshots and failed reads fall back to existing audiences. A new deployment refreshes evidence, with a 24-hour cache. Preview checks cannot overwrite production evidence.

Official contracts reviewed: [property filters](https://api.docs.dealmachine.com/reference/property-filters), [live filter discovery](https://api.docs.dealmachine.com/api-reference/filters/list-filters), [people export](https://api.docs.dealmachine.com/api-reference/people/export-people). Documentation alone never enables an unverified paid export option.

Buyer-fit definitions require actual dated requirements, an existing buyer ID and account ID, permitted ZIPs, an expiry no later than 30 days from observation, and at least one explicit range. No buyer ranges are seeded. The inspected production account had no current approved unexpired buyer qualification. The configuration API accepts `set_experiment` with a strict `TargetingDefinition`; operators must retain the real statement in `buyerEvidence.sourceReference`. The API cannot change financial filters, export verification, budgets or holds.

Mobile remains disabled until a separately authorized bounded export check supplies original request, CSV type and billing evidence. Its private verification flag requires an evidence reference. This release does not consume old test approvals. Empty mobile results finish against the original receipt; they never trigger a second purchase. Active and mobile cohorts cannot mix in a paid batch. Saved mobile attribution survives rollback.

## Supply and duplicate purchases

Experiments begin with balanced exploration, with half of available slots retaining the existing audiences and every fourth slot retaining baseline when available. The prospective learning policy may direct at most three of five experimental slots to an evidence-supported candidate: at most 30% of all slots while legacy supply exists. The other experimental slots exclude that winner when another safe experiment exists; otherwise they return to safe ordinary supply. If only one safe audience remains overall, exploration can use it without claiming a percentage cap on that audience. Exhausted, unsupported or empty experiments yield to the existing allocator. If legacy audiences are exhausted and a verified experiment still has supply, it can continue. Missing experimental measurements do not become matches; baseline remains available. Safety and financial conditions are never relaxed.

Before any experimental purchase, the original globally locked admission checks the exact definition, account/ZIP evidence, provider capability, existing money/permission gates, and complete acknowledged exclusion coverage. A separate private acquisition ledger includes every returned property ID, including unassigned or rejected records. It does not create or transfer lead assignments. The existing free list-sync process can acknowledge these IDs using its original quota, lease and receipt checks. The original disabled exclusions switch is preserved.

An unresolved experimental purchase or completed unsynchronized receipt also prevents an overlapping baseline purchase, across accounts and after rollback. Disjoint ZIPs retain ordinary supply. No unknown purchase is replayed or financially resolved by this change.

Initial production blockers: exclusions were disabled after earlier query timeouts, with 10,702 assigned IDs pending; acquired-but-unassigned coverage also needs synchronization. Do not toggle the old exclusion-query policy or rotate a held search simply to activate these experiments. Original uncertain ZIP/operation fences remain authoritative.

## Measurement

The owner report compares account + ZIP + immutable audience over a 90-day window. It shows acquired/attributed properties, attempted and pending properties, valid-contact properties, qualified seller conversations, saved offers, signed contracts, 30-day sample sizes, research cost, total attributed provider cost and customer usage charges. It displays qualified and signed outcomes per $100 of each cost basis. Actual zero credits remain zero; missing cost receipts hide rate comparisons.

Valid contacts are distinct properties with a saved active, non-DNC likely-owner number, not verified ownership or consent. Qualification starts prospectively at the existing authenticated, conversation-bound live seller qualification gate and requires financial eligibility. Offers currently measure saved price quotes returned to seller calls, not delivery, acceptance or all possible manual/SMS offers. Contracts use the existing fully signed live-envelope verifier. Reports do not alter outreach decisions.

The historical report's 100 properties aged 30 days, 20 qualified properties and five signed contracts still mark a cohort for review only. Its `winnerDeclared:false` is not the prospective allocator's decision. Historical report rates are never fed into allocation.

## Prospective allocation policy

`seller-targeting-learning-v1` starts a new evidence window on first enablement of the global policy and each immutable experiment. Pause/resume retains that original start. Each candidate is compared with baseline pages from the same account, ZIP, page size, exact exclusion query policy and concurrent date window (at most 180 days). A new definition cannot inherit another definition's outcomes. Source measurements and historical plans are never rewritten.

Interest uses a complete 72-hour window after the first original `operation_spend.dispatched_at` bound to an actual provider call or accepted/delivered text. Later message updates and delivery webhooks cannot move that clock. Only an authenticated qualifying call result or the existing exact selling-interest SMS helper supplies a positive timestamp; ownership confirmation is not interest. Missing dispatch time is not a mature negative. Purchase and closing outcomes use the existing verified-envelope/closing helper and complete 30-day/60-day windows from acquisition. Pending outcomes never inflate expected reward.

Both control and candidate require at least 100 mature observations and actual outreach to at least 100 properties; a candidate needs ten interest positives or five verified contracts/closings. The most mature shared objective takes priority: closings, contracts, then interest. A mature cohort with no closings cannot fall back to early replies to claim a win. The candidate's two-sided 95% Wilson lower bound, multiplied by its **mature** trial count, must exceed the control's upper-bound yield per dollar by at least 5% on **both** settled customer charges and actual provider costs. Research, owner acquisition and subsequent calls/texts/emails all count, including unsuccessful paid research; incomplete, missing, unsettled or contradictory required costs prevent promotion. This supports a bounded allocation decision, not a claim of causal lift or improved closings.

After 100 attempted properties, an experiment above 5% opt-outs receives neither learned nor exploratory slots. A candidate cannot be promoted if its opt-out rate is more than one percentage point above control or control itself exceeds 5%. Missing or stale comparison evidence remains exploratory. Existing recipient suppression, active-phone/DNC checks, customer Pause, funds and unresolved-operation admission remain unchanged.

## November 4 activation scope

Read-only production verification at 05:30 UTC found five capable property experiments, all still disabled:

| Segment | Immutable experiment ID |
| --- | --- |
| Off market | `28bfd173-8c3b-4ae8-92be-32530368be75` |
| Sale 7–10 years | `c1e48df4-741f-471e-ad4a-b66c70023c94` |
| Sale over 10 years | `dc6b625d-6467-4415-aff0-3a1ae5803c9b` |
| Out-of-state absentee | `4bd27851-c4a3-4682-9dc3-f38c3abb092f` |
| Vacant absentee | `4d64a5ea-51df-46c3-bb33-583896edf799` |

All definitions retain snapshot `2026-10-30`. Mobile `cf1eed7d-711a-460c-993f-a1cfb35e8675` is **not capable**: its catalog evidence explicitly says `documented_not_paid_tested`. Buyer fit has no seeded real scoped statement. Neither is in the activation scope.

The real exclusion switch is off, not an obsolete readiness read. Of 233 enabled sourcing configurations, 207 v2 configurations and 25 v0 configurations lack an exclusion list; only one has a list. The last original list acknowledgment is October 28 04:38 UTC, and 27,139 unique IDs awaited acknowledgment at the snapshot. These counts may change with ordinary production work.

Do not enable the old `exclusions_enabled` query-policy switch to activate this feature: it also changes ordinary configurations and could disturb the earlier timeout-bound query policy. The independent sync-only switch drains the existing list through free maintenance. `targeting-verified-query-binding.sql` then provides a separately disabled, exact-list query capability; `activate-targeting-verified-query.sql` is its guarded operator activation plan after matching releases, complete original acknowledgments and native race checks. Neither changes ordinary configuration revisions or their saved list fields.

Before the first experimental paid page in a ZIP, ordinary baseline queries retain their existing policy, including while list synchronization is pending. Each experimental page must first obtain a successful free estimate with the exact verified list. Final admission checks the same list, definition, scope and current controls under the original financial locks; a private transaction-bound proof prevents direct/legacy APIs from bypassing this path. Failed estimates never fall through into a paid list-free retry. After any experimental paid or uncertain page, every new overlapping query across accounts must use the same verified list, even if experiments pause. Pending IDs and unknown purchases hold that ZIP; disjoint ZIPs retain ordinary supply. Historical list-free controls are excluded from the new exact-policy comparison.

The existing targeting-state response advertises the new context additively, so a new application can operate against the pre-migration database. After activation, final database gates hold an old worker that cannot supply the exact query policy. The five property definitions above are the supported activation scope, **not proof of active sourcing**.

`syncResearchExclusions` drains at most 1,000 IDs per batch through existing quota, token, exact-ID and original provider-acknowledgment checks. Never mark IDs acknowledged manually, clear a held query or rotate its source to start an experiment. Confirm dedup-ready accounts and newly attributed ordinary pages before claiming active targeting. A metadata build check proves filter entitlement, not exclusion-query health or a successful paid page.

## Release and rollback

1. Run targeting, admin, existing owner-export, discovery and release suites; run the desktop/mobile browser targeting scenario against the built application. Provider traffic is mocked in tests.
2. Existing installations retain `20261030185129_dealmachine_targeting_experiments.sql`; apply the additive `supabase/migrations/20261104052232_dealmachine_targeting_learning.sql`. It enables no switches and retains historical evidence. Apply independent sync control `20261104053431` and verified query binding `20261104060526` afterward; the latter adds exact-policy proof to original final admission without removing its existing predicates.
3. Merge only after the PR reliability workflow succeeds. Confirm the exact merged main push passed the production release gate, then confirm matching Vercel and Railway deployments and read-only production checks.
4. Read `/api/admin/targeting` as the owner or `icash_targeting_report` through the trusted service. Confirm switches, capability evidence, exclusion coverage and the actual absence/presence of experiment receipts. A successful build is not a live outcome test.

Rollback uses the owner panel's **Pause experiments**, or service-only `icash_configure_targeting(owner_uuid,'set_enabled',null,false)`. Individual toggles can stop one cohort. Existing baseline audiences continue, subject to preserved overlapping-acquisition fences. Do not delete cursors, attribution, acquired IDs, qualifications, receipts or holds. Already purchased mobile work retains its request and free receipt recovery. If an application rollback is necessary, pause first; retain the additive schema so original receipt recovery and measurements remain available. No schema-down migration or paid replay is needed.

Local verification covers mappings/date boundaries, unsupported and missing data, buyer scope/expiry, baseline fallback, zero estimates, exact query identity, dedup before reservation, unknown and unsynchronized purchase fences, raw export credits, empty/partial mobile CSVs, immutable receipts, account isolation, authenticated controls and rollback. The learning tests additionally execute prospective SQL cohorts, fixed outcome windows, original dispatch clocks, full-cost refusal, scope mismatches, opt-out holds, confidence comparisons and allocation limits. Learning alone leaves final admission unchanged; query-binding tests execute the captured original admission with its additive proof guard, preserve every original scope/financial predicate, and race competing controls on native PostgreSQL. They do not prove live conversion improvement; production admission retains the existing global database lock.
