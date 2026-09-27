# Property data provider benchmark — September 27, 2026

Use iCash X's own accounts. Keep each provider behind the `DataTask` interface in `lib/data-router.ts`. No account has been opened and no live data has been queried. Published prices are indicative, not contracted rates or proof of quality.

| Candidate | Best initial test | Public pricing / billing observation | Gap to verify |
| --- | --- | --- | --- |
| RentCast | Property discovery, owner fields, valuation, comps | Developer 50 requests/month free; Foundation $74/month for 1,000, Growth $199/5,000, Scale $449/25,000. Overage $0.20/$0.06/$0.03/$0.015 by tier. Successful 200 responses count; search can return multiple records per request. | Ownership/equity and land coverage in target markets; licensing, bulk search, freshness. |
| BatchData | Selective contact enrichment and DNC flags after ranking | Public skip tracing Growth lists $2,000/month for up to 100,000 traces; property plans and custom terms differ. | Actual matched-contact yield, API contract, DNC accuracy, minimum commitment. |
| Regrid | Land parcel, boundaries, ownership and zoning checks | Bills by parcel records returned; self-serve overage examples $0.10 standard or $0.15 premium per record. Caching up to 30 days is documented. | Exact plan, enhanced ownership add-on, commercial reuse, parcel coverage. |
| ATTOM | Deeper mortgage, sale, and property data | Contract quote rather than a reliable public per-call price. | Quote, fields, title/mortgage freshness, rights, hit rate. |
| DealMachine | Existing integrated property and people data | API docs exist; account-specific pricing/credits and reuse rights are not yet provided. | User's contract, API credentials, docs, rate limits, caching/reuse, true cost. |

Sources: [RentCast API pricing](https://www.rentcast.io/api), [RentCast billing](https://developers.rentcast.io/reference/billing-and-pricing), [BatchData pricing](https://batchdata.io/pricing), [Regrid API billing and caching](https://support.regrid.com/docs/getting-started-api), [ATTOM API](https://www.attomdata.com/solutions/delivery/property-data-api/), [DealMachine API docs](https://api.docs.dealmachine.com/introduction).

## Decision rule

Benchmark the same blinded sample of Houses and Land in the first target markets. Record usable property hit, owner match, reachable contact, current sale/mortgage fields, comp relevance, latency, and effective cost per **qualified contact**. Use one cheap source for broad screening, pay for enrichment only after ranking, and cross-check high-value fields before offers. `chooseDataProvider` filters unlicensed/unavailable/out-of-market sources and uses observed useful-result and freshness rates to estimate cost per usable record. Version the routing decisions and monitor actual invoices. Never reuse, cache, or resell data outside each provider's terms.
