# Paid equity lookup verification — September 28, 2026

Owner authorized a one-property test without contact enrichment or calls. After resolving a Vercel deployment limit, the estimate request identified an invalid filter ID in documentation examples. Live account metadata returned `estimated_equity_percentage`, operator `greater_than_or_equal`, and Single Family option ID `1`. Production discovery now uses those verified identifiers.

The paid test returned one property in test ZIP 75216: estimated charge 1 provider credit, actual charge 1 provider credit, people charge 0. Conservative equity check returned 100%. Value, equity percentage, repair-cost and estimated loan-balance fields were present. No customer wallet was charged and no owner lookup or outreach ran. This is request/filter validation, not proof of a profitable deal or a market ranking. Dollar cost depends on the account's actual credit pricing.

The service-only diagnostic ledger is complete and prevents replay. The temporary build hook has been removed. Reports contain aggregate checks, not property addresses or seller identities. Production discovery and outreach still require their operating configuration and authorization gates.
