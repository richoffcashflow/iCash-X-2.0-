# Daily search pacing and VIP savings

Owner policy, October 20, 2026: preserve the initial burst, then limit new-opportunity work to 25% of the verified-funding balance in any rolling 24 hours. The existing 50% total search allowance and protected remainder for replies and active deals remain. This is a search limit, not a guarantee that all wallet activity lasts four days: customer work and active conversations retain their existing credit admission.

The immediate and hourly allowance is `min(floor(balance/4), max(500, ceil(floor(balance/2)/10)))` cents. Examples: $100 / $500 / $1,000 unlock $5 / $25 / $50 immediately. A $10 wallet is capped at $2.50. The cumulative 50% search allowance releases over 24 hours, but the independent rolling daily and hourly limits always apply. Midnight does not reset them. Actual charges and unresolved prospecting holds carry across top-ups. No snapshots, historical charges, controls or unresolved work are reset.

VIP receives 30% off newly admitted usage and newly assigned leads. Standard remains 3× for the DealMachine category and 2× for other usage; VIP uses 2.1× and 1.4× respectively. Flat SMS and lead rounding retain their existing precision/order. Ask AI snapshots 1.4×. Existing reservations and historical receipts keep their original rates. Recorded reception settlement accepts either the original 20% or new 30% frozen discount against the same approved provider cost policy.

Savings are derived only from settled, validated price snapshots. Historical 20% discounts remain counted accurately; prospective examples are clearly separated from actual saved dollars. Subscription charges are unchanged.

Deploy through full PR and exact merged-main checks. Apply the exact committed migration before promoting the matching app so the new advertised benefit is already effective. The forward migration validates captured function hashes under the existing admission lock and commits atomically. Do not replay it or edit old migrations. No worker runtime changes or restart are required. Verify function hashes, private ACLs, budget invariants, preserved controls/holds and ordinary health after deployment. No paid test calls or messages.
