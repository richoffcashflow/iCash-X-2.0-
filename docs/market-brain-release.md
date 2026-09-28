# Acquisition market brain

The customer does not select lists or ZIP codes. The intended live allocator selects reviewed metro/suburban ZIPs according to outcome evidence and available capacity. Funding remains 5x fully loaded buffered cost for every account. No volume discount was introduced.

This release adds a deterministic planning module and a 50-market RESEARCH shortlist. It does not activate those markets or label them the best-performing markets. All candidates are disabled until jurisdiction, data rights, channel eligibility and ZIP inventory have been reviewed. Multi-state metros must be split by actual property jurisdiction. Rural and unknown geography are held.

Market evidence includes attempts, connected calls, unique contacted owners, responses, qualification, signed contracts, funded closings, opt-outs, fully reconciled costs, cohort maturity, tenant count, available owner inventory and capacity. Signed contracts and closings must come from verified document/title records. Existing outcome-learning ingestion stores evidence sources and deduplicates operations.

The ranking uses conservative lower confidence bounds; 70% of the outcome score is funded closings, 25% contracts and 5% qualified sellers, normalized by observed cost per contacted owner. These weights are an initial test policy, not a proven optimum. Answers and responses are diagnostic signals, not success substitutes. Mature cohorts, at least 100 attempts, 5 contracts, 3 closings and 5 contributing tenants are required before a ZIP gets a measured score. This tenant threshold is a minimum aggregation rule, not a formal privacy guarantee.

Allocation limits any market to 10% of requested new accounts, limits new-market trials to 10%, caps the launch at 50 distinct metros, respects capacity/owner inventory, and waitlists excess demand. A cold start allocates only trial capacity; it does not put the full requested population into markets with no outcomes. Zero eligible capacity produces no assignments. A 100,000-account request does not establish infrastructure capacity or sufficient inventory.

## Still required before live use

This planner is not yet connected to the paid acquisition dispatcher. Build a verified aggregate feed from mature live cohorts, a reviewed ZIP/jurisdiction registry, transactional assignment/lease persistence, shared owner/property contact suppression across tenants, and caller authority/tenant isolation checks. Do not reuse the same owner pool for every customer or share raw seller conversations between tenants. Any shared data reuse must be licensed.

Market registry selection needs verified investor purchasing activity, recent comparable sales, property/repair/debt data, assignment economics, owner reachability and closing capacity. No fabricated ZIP list or investment performance ranking is shipped. Public population data can help identify metros but cannot establish wholesaling profitability.

The customer sees status, strongest opportunity, and actionable requests. Raw geographic rankings, experimentation and infrastructure controls remain administrative. Evidence remains accessible on demand. No fabricated activity, outcome promises or hidden spend acceleration.

Before a scale claim: load-test dispatch, per-provider quotas, credit reservation concurrency, webhook replay protection, tenant isolation and realtime fan-out. Benchmark against a documented human baseline using cost per signed contract and funded closing, time to outcome, complaints and cancellations. No better-than-human claim is established by this release.

Research starting points reviewed September 28, 2026:
- Census metro population estimates: https://www.census.gov/data/datasets/time-series/demo/popest/2020s-total-metro-and-micro-statistical-areas.html
- TREC equitable-interest guidance: https://www.trec.texas.gov/article/sale-equitable-interests-real-estate-clarified
- South Carolina current real estate statute: https://www.scstatehouse.gov/code/t40c057.php
- South Carolina commission guidance index: https://llr.sc.gov/re/news.aspx

Public sources do not substantiate a nationwide best-50 ranking or clear this shortlist for operation.
