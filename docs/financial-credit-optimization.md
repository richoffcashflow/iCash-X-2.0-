# DealMachine financial prequalification

The November 10, 2026 owner request makes paid property acquisition conditional on a verified upstream financial query. The prospective policy is `financial-prefilter-v1`. Installation is disabled; enable it only after the matching web and worker release and fresh account capability verification. Existing prices, wallets, daily budgets, provider limits, customer markets, Run/Pause, contact controls and interface stay intact.

## Before any paid request

1. Use the customer's permitted market and existing market rotation/ranking. Verified current buyer requirements can constrain an immutable buyer-fit experiment. Never invent buyer demand or expand outside the customer's selection.
2. Synchronize the provider exclusion list with all previously acquired properties, including held properties. Check existing Supabase inventory, original operations and unresolved purchases first. The list and exclusion generation are part of query identity.
3. Apply the filters below to the actual property-only request (`anchor: properties`, `contact_audience: none`). The free `estimate_cost: true` request has the same fields, filters, ZIP, page size and exclusions as the purchase.
4. Under the existing budget/account/configuration locks, require a fresh, exact saved free estimate, zero people credits and the unchanged final spend predicates. Consume the original operation once. Preserve timeout/unknown receipts; never repurchase on a transport retry.
5. Calculate using purchased data, hold missing/conflicting information, then admit contact discovery only through existing financial/contact gates. Reuse valid saved contacts and the existing verified owner export path. No new paid tests or billing changes.

## Verified filter contract

Sources: [V2 filter catalog](https://api.docs.dealmachine.com/api-reference/filters/list-filters), [property search and free estimates](https://api.docs.dealmachine.com/api-reference/properties/search-properties), and the account's GET-only `/account` and `/filters` receipts. Catalog version 4 records the relevant financial, property and ownership capabilities. Every required filter's type/operator and explicit nonpremium entitlement must match; option 6 must still be labeled Off Market. Unknown, stale or premium-only metadata holds new purchases.

| Criterion | Upstream implementation | Limit |
| --- | --- | --- |
| Single-family | `property_type contains_any [1]` | Other property types require separate underwriting |
| Estimated equity | `estimated_equity_percentage >= 70` always | Provider estimate, never verified title equity |
| Off market | `market_status contains_any [6]` always | `is_off_market` is absent from observed catalog and is not sent |
| Minimum viable value | `estimated_value > 14285.72` | Necessary positive-offer floor at zero repairs and $10,000 fee; not sufficient proof of profit |
| Repair-heavy audience | `estimated_repair_cost >= 25000`, value `> 50000` | Necessary floor under the same formula; actual repairs still require calculation |
| Repair availability | `estimated_repair_cost >= 0` | Missing/invalid scalar estimates must remain held |
| Known active liens/taxes | `has_active_lien=false`, `has_hoa_lien=false`, `is_tax_delinquent=false`, `num_total_active_liens <= 0` | False flags do not prove clean title |
| Preferred ownership | `last_sale_date is_before` a fixed seven-/ten-year cutoff | Last sale is an ownership-tenure proxy, not proof of continuous ownership |
| Motivation proxies | Supported absentee/vacancy/out-of-state filters in reviewed arms | Proxies do not establish seller motivation |
| Buyer fit | Explicit supported value/bed/bath/area/year ranges from current buyer evidence | Never turn a buyer's purchase budget into a market-value band |
| Already purchased | Exact `exclude_lists.property_list_ids` plus database dedup/locks | Unknown purchases remain held until receipt reconciliation |

The API documents a flat AND filter list, not nested OR or field-to-field arithmetic. No verified upstream ARV/repair/fee formula, net investor profit, payoff verification or seller-response probability filter exists. Available numeric equity-amount, loan-balance, open-lien count and lien-amount fields are retained for downstream verification; no arbitrary fixed debt ceiling is justified across all values. The catalog does not document numeric `is_null`/`is_known` alternatives that would preserve missing values while excluding positive open liens.

This matters in the November 10 audit: all 8,250 recently eligible samples had a null open-lien count, while 6,938 of 7,641 held samples had a known count. Forcing open-lien-count `=0` without verified missing-value semantics could discard the eligible inventory. Missing lien amounts are not zero. Continue the existing hold when any purchased record reports an open lien or tax issue; never buy its contacts or sum overlapping mortgage/lien totals as if they were independent debts.

## Bounded preference widening

All tiers keep the mandatory 70% equity, single-family, off-market, viable-value, repair and active-lien/tax filters. Tier 0 adds 90% equity, last sale over ten years ago and absentee ownership. Tier 1 adds 80% equity and last sale over seven years ago. Tier 2 retains the mandatory financial filters.

Widen only one tier after the exact saved baseline free estimate proves both zero total properties and zero total results, with zero property/people credits. Zero credits alone is insufficient. Require the same account/revision/query/exclusion generation, a five-minute receipt, current admission and no paid or uncertain operation. A timeout, unsupported filter, positive result or low balance cannot widen the query. Two concurrent workers can record only one transition. A wider tier is tried on a later scheduler pass; it cannot create a paid retry loop. Only earlier arms proved free-empty under this exact policy can be reopened.

## Financial results and recovery

Use **Maximum Cash Offer = ARV × 70% − repairs − wholesale fee**, with integer cents and the existing $10,000/$20,000 fee policy. Those fees are within the requested $10,000–$30,000 target; a $30,000 fee is not assumed without supporting economics. `estimated_value` remains an unreviewed ARV proxy. Estimated buyer acquisition, repairs, fee, gross spread and gross margin are now explicit. Closing, holding, financing, resale and unexpected repairs are excluded from that gross margin; it is not net profit.

New results classify genuine financial rejection, missing financial information and inconsistent calculations separately. Invalid reported debt cannot silently fall back to a favorable derived estimate. Technical errors remain errors, not financial rejection. Queue-only stale-data diagnosis preserves the original fetch timestamp, marks a verification hold and authorizes neither an offer nor outreach. The fresh-data entry point retains its 24-hour expiry.

Recoverable local `SCREENING_FAILED` jobs get at most three total attempts, with bounded delay, original data and immutable per-attempt receipts. No provider operation is retried. Invalid snapshots require reviewed recovery. `icash_retry_saved_screening` requires the owner actor, exact snapshot hash, original error, terminal job, fewer than three attempts and a one-use recovery receipt. It preserves the entire original job and never resets the attempt count.

The pre-release audit found one failed job: old data produced `INVALID_SNAPSHOT`; local replay diagnosed stale research and conflicting estimates. After the new worker is verified, replay that exact saved job through the one-use recovery RPC. Expected result is a verification hold, not approval. Existing completed holds are not automatically rewritten or used to trigger historical outreach.

## Allocation and measurement

Preserve the existing adaptive engine: half of slots retain existing audiences, every fourth retains baseline, and a qualified experimental winner receives at most three of five experimental slots. Use the exact account, ZIP, page size, immutable definition and full query policy (including tier/date). Do not inherit a legacy winner after changing the financial filters. Keep opt-out/wrong-number holds and duplicate cooling while collecting new evidence.

Existing promotion requires 100 mature samples per arm, 72-hour interest/30-day contract/60-day closing windows, complete provider and customer costs, minimum positive outcomes and 95% confidence bounds with at least 5% conservative cost-adjusted superiority. Prefer contracts/closings as those outcomes mature. Unanswered carrier calls now contribute attempts and costs even when no AI conversation exists. No arbitrary model prediction can override financial or spend admission.

Owner-only `icash_financial_credit_report(owner_actor, account_id, days)` reports up to 180 days by exact query cohort. It counts all purchased page credits, including duplicate-only or rejected pages, and contact credits using exact total receipts; receipt subtotals are never added again. It reports credits per financially qualified property, contactable owner, seller conversation, qualified seller, offer opportunity, signed contract and closed deal. Zero denominators and incomplete costs produce null ratios. A qualified seller is a source-bound completed qualification, not independently proven motivation. Saved contactability never substitutes for current outreach permission.

Potential fee totals are unweighted estimates, not a revenue forecast. Received proceeds require original verified deal outcomes, title-backed closing/disbursement and a matching confirmed receipt. Revenue per credit is distinct from net profit; missing closing/overhead costs prevent a net-ROI claim. This report is observational and cannot itself promote a strategy. Historical unclassified holds remain explicit instead of being relabeled as technical faults or financial failures.

## Release, verification and rollback

Apply the three guarded migrations in order: financial prequalification (disabled), local screening recovery, credit outcome reporting. Exact predecessor hashes prevent an unreviewed replacement. Verify private-table ACLs and service-only functions. Canonical Reliability checks must include both new offline suites and `test-financial-prequalification-postgres.py` on its fixed disposable PostgreSQL instance; no test contacts providers or spends credits.

Publish through the existing automatic-release process. Require exact-main CI, production web READY/aliases, the affected worker's matching release, and fresh production catalog version 4 before activation. Under the operating-budget lock, enable the singleton `financial_settings` row with the verified release SHA, the current fixed `as_of` date and activation timestamp, only if `financial_capable()` is true. Preserve the original in-flight operations. Read back ordinary production query claims/estimates and category metrics; never issue a paid demonstration.

If verification fails, leave the new policy disabled or hold affected new queries; do not weaken a required filter automatically. An explicit rollback sets only `financial_settings.enabled=false` under the same lock. Preserve all historical policies, widening receipts, paid claims, screening attempts and recovery evidence. Old receipts must continue settling under their original policy.
