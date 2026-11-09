# Standard 70% offer formula

The owner selected `ARV × 70% − repairs − wholesale fee` on November 7, 2026 and confirmed shipping on November 9. This replaces `(ARV − repairs) × 70% − fee` for new calculations. The entire repair estimate is subtracted after applying 70% to ARV.

For $300,000 ARV, $50,000 repairs and the existing $20,000 target fee, the new seller ceiling is $140,000. The buyer budget before the assignment fee is $160,000. These remain research-based ceilings, not promised profit, accepted prices or authority to contact/sign.

## Shared calculation

`cash-offer-math.ts` uses integer-cent arithmetic, rounds down the percentage result and subtracts the full repairs and fee. Nonpositive seller ceilings remain unavailable. Fee targets remain $10,000 below $300,000 ARV and $20,000 at or above it. Explicit reviewed fees and lower percentages keep their existing validations. New seller proposals still round down to whole $1,000 prices.

Version `arv_70_less_repairs_v3` distinguishes new results. The property breakdown, practice calculator, support explanations and workspace assistant use the same expression. Older saved results retain their original value with the existing Needs update warning. Merely displaying an old record does not recompute it or make its research fresh. Explicit saved-screening recalculation retains original dates/history and keeps outreach and offer authority disabled until current checks pass.

## Existing agreements and buyer prices

No migration rewrites rows, accepted prices, issued/signed agreements, original research or published buyer terms. A supported accepted price stays exact. An accepted amount above the new supported ceiling is held for reconciliation, never silently replaced. An issued agreement keeps its frozen terms, and a signed purchase does not start another offer sequence. Existing buyer package prices, fees and deposits remain unchanged.

The append-only `20261109155321_seventy_percent_offer_formula.sql` changes the automatic voice price calculator and both buyer-assignment-pricing overloads. It retains current validation, permissions, source/account checks and the property-specific approved minimum-fee path. New publications describe the new budget; old evidence remains intact. Unexpected predecessor functions abort the transaction.

## Release and verification

Before release, run arithmetic, screening, automatic offer/acceptance, seller text, agreement, property summary, support, practice and tiered buyer-pricing regressions, plus all canonical Reliability checks. Inspect current database predecessors before applying the reviewed migration. The conservative new database price check can hold an old application amount during rollout; never weaken that final check or replay an attempted contact.

Use the normal release path: independently review the final diff, verify exact PR-head Reliability checks, merge with the expected head, apply the exact approved migration before the new application is live, and retain exact-main production checks. Verify matching READY Vercel production aliases and Railway worker commit because screening imports the shared calculation. Read the live SQL results for fictional inputs without creating offers or calling providers. Do not report the formula live until database, web and worker all agree. No paid development tests or historical outreach are part of this change.
