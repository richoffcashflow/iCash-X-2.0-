# DealMachine targeting experiments

This release extends reviewed main `96eccd3735859d8652865605103266f2da238c94`, including the PR488/489 active-export fixes, and incorporates the subsequently shipped support changes through `3611e6fa` (PR492/493). It does not change prices, budgets, plans, lead ownership, financial screening, lien/tax checks, suppression or unresolved purchase holds. Existing multi-number outreach remains unchanged; best-number ranking and sequential fallback are not implemented.

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

The bounded metadata script reads `/account` and at most three property-filter pages through the existing shared quota. It never buys data or changes a plan. The October 30 preview reads reported **Pro**, paid, and nonpremium access for the ten used targeting filters, including the exact off-market option; Scale is not verified active. Catalog snapshots expire after seven days. Missing filters/operators, unknown/premium entitlements, stale snapshots and failed reads fall back to existing audiences. A new deployment refreshes evidence, with a 24-hour cache. Preview checks cannot overwrite production evidence.

Official contracts reviewed: [property filters](https://api.docs.dealmachine.com/reference/property-filters), [live filter discovery](https://api.docs.dealmachine.com/api-reference/filters/list-filters), [people export](https://api.docs.dealmachine.com/api-reference/people/export-people). Documentation alone never enables an unverified paid export option.

Buyer-fit definitions require actual dated requirements, an existing buyer ID and account ID, permitted ZIPs, an expiry no later than 30 days from observation, and at least one explicit range. No buyer ranges are seeded. The inspected production account had no current approved unexpired buyer qualification. The configuration API accepts `set_experiment` with a strict `TargetingDefinition`; operators must retain the real statement in `buyerEvidence.sourceReference`. The API cannot change financial filters, export verification, budgets or holds.

Mobile remains disabled until a separately authorized bounded export check supplies original request, CSV type and billing evidence. Its private verification flag requires an evidence reference. This release does not consume old test approvals. Empty mobile results finish against the original receipt; they never trigger a second purchase. Active and mobile cohorts cannot mix in a paid batch. Saved mobile attribution survives rollback.

## Supply and duplicate purchases

New experiments use fixed exploration, with half of available slots retaining the existing audiences and every fourth slot retaining baseline when available. Exhausted, unsupported or empty experiments yield to the existing allocator. If legacy audiences are exhausted and a verified experiment still has supply, it can continue. Missing experimental measurements do not become matches; baseline remains available. Safety and financial conditions are never relaxed.

Before any experimental purchase, the original globally locked admission checks the exact definition, account/ZIP evidence, provider capability, existing money/permission gates, and complete acknowledged exclusion coverage. A separate private acquisition ledger includes every returned property ID, including unassigned or rejected records. It does not create or transfer lead assignments. The existing free list-sync process can acknowledge these IDs using its original quota, lease and receipt checks. The original disabled exclusions switch is preserved.

An unresolved experimental purchase or completed unsynchronized receipt also prevents an overlapping baseline purchase, across accounts and after rollback. Disjoint ZIPs retain ordinary supply. No unknown purchase is replayed or financially resolved by this change.

Initial production blockers: exclusions were disabled after earlier query timeouts, with 10,702 assigned IDs pending; acquired-but-unassigned coverage also needs synchronization. Do not toggle the old exclusion-query policy or rotate a held search simply to activate these experiments. Original uncertain ZIP/operation fences remain authoritative.

## Measurement

The owner report compares account + ZIP + immutable audience over a 90-day window. It shows acquired/attributed properties, attempted and pending properties, valid-contact properties, qualified seller conversations, saved offers, signed contracts, 30-day sample sizes, research cost, total attributed provider cost and customer usage charges. It displays qualified and signed outcomes per $100 of each cost basis. Actual zero credits remain zero; missing cost receipts hide rate comparisons.

Valid contacts are distinct properties with a saved active, non-DNC likely-owner number, not verified ownership or consent. Qualification starts prospectively at the existing authenticated, conversation-bound live seller qualification gate and requires financial eligibility. Offers currently measure saved price quotes returned to seller calls, not delivery, acceptance or all possible manual/SMS offers. Contracts use the existing fully signed live-envelope verifier. Reports do not alter outreach decisions.

No automatic winner is selected. At least 100 properties aged 30 days, 20 qualified properties and five signed contracts merely mark a cohort for review. These counts are not a significance test. Compare similar markets, observation windows, costs, coverage and uncertainty before changing allocation; historical and prospective qualification counts are not interchangeable.

## Release and rollback

1. Run targeting, admin, existing owner-export, discovery and release suites; run the desktop/mobile browser targeting scenario against the built application. Provider traffic is mocked in tests.
2. Apply `supabase/migrations/20261030185129_dealmachine_targeting_experiments.sql` using the migration service. Guarded function patches abort if the reviewed production prerequisites changed. The migration is inactive and additive; it preserves every receipt and hold.
3. Merge only after the PR reliability workflow succeeds. Confirm the exact merged main push passed the production release gate, then confirm matching Vercel and Railway deployments and read-only production checks.
4. Read `/api/admin/targeting` as the owner or `icash_targeting_report` through the trusted service. Confirm switches, capability evidence, exclusion coverage and the actual absence/presence of experiment receipts. A successful build is not a live outcome test.

Rollback uses the owner panel's **Pause experiments**, or service-only `icash_configure_targeting(owner_uuid,'set_enabled',null,false)`. Individual toggles can stop one cohort. Existing baseline audiences continue, subject to preserved overlapping-acquisition fences. Do not delete cursors, attribution, acquired IDs, qualifications, receipts or holds. Already purchased mobile work retains its request and free receipt recovery. If an application rollback is necessary, pause first; retain the additive schema so original receipt recovery and measurements remain available. No schema-down migration or paid replay is needed.

Local verification covers mappings/date boundaries, unsupported and missing data, buyer scope/expiry, baseline fallback, zero estimates, exact query identity, dedup before reservation, unknown and unsynchronized purchase fences, raw export credits, empty/partial mobile CSVs, immutable receipts, account isolation, authenticated controls and rollback. It cannot prove higher live conversion or exercise real concurrent Postgres sessions; production admission retains the existing global database lock.
