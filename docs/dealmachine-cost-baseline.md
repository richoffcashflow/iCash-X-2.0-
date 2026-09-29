# DealMachine data baseline

Approved planning assumption: $0.01 per DealMachine vendor credit. This is not a verified marginal invoice rate. A 30,000-credit allowance is a quantity, not a dollar balance; at this baseline it represents $300 of allocated data cost. Replace the unit allocation with actual plan/invoice economics when available.

The API documents one credit per unique property and one per unique returned person/contact. Counts and estimate-only requests are free. Requested contacts can make a property lookup consume multiple credits; $0.02 is a two-credit example, not a universal skip-trace price. Buyer discovery already uses a people anchor and address-only property context to avoid unnecessary property credits. Returned people are potential buyers, not verified interested buyers.

| Scenario | Vendor credits | Estimated data cost | Data portion at 5x |
|---|---:|---:|---:|
| One new property | 1 | $0.01 | $0.05 |
| Two new contacts | 2 | $0.02 | $0.10 |
| 30 new buyer contacts | 30 | $0.30 | $1.50 |
| 50 new buyer contacts | 50 | $0.50 | $2.50 |

The data-cost settings and quote RPC are server-only and database-configurable. Production reservation rate versions additionally allocate $0.04/job for infrastructure, payment costs, support, acquisition and refunds, then reserve a 20% buffer. At the initial baseline and 5x multiplier, a ten-credit search page reserves $0.84 of customer credits; a 25-credit enrichment allowance reserves $1.74. These are reservation ceilings, not a claim that every request consumes all reserved credits. No flat 25-contact price should be represented as a two-cent skip trace.

Actual cost reconciliation remains separate. No invoice cost is invented, no 30,000-credit provider balance is asserted, and no customer account's campaign, data rights, phone permissions or company funding mode is changed by this migration. Account discovery and buyer configurations still need a market, valid rights and these rate IDs before dispatch.

Sources: https://api.docs.dealmachine.com/concepts/credits and https://api.docs.dealmachine.com/concepts/credit-efficient-queries
