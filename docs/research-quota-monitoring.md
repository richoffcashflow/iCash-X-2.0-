# Research request exhaustion

At 2026-11-03 16:02 UTC, the shared local request limiter had consumed all
9,800 requests in its existing 24-hour window. The window began at
00:12:49.883914 UTC; normal admission can open the next window at
2026-11-04 00:12:49.883914 UTC. The last admitted research request was at
10:10:35.815302 UTC. This blocked five otherwise due research candidates among
six stalled funded accounts, including a newly funded account with no prior
research ticket. The sixth account also had independent contact-check holds.

Worker uptime did not explain this stop. The reliability snapshot now includes
an operator-only `researchQuota` observation with effective local day/minute
usage, limits, remaining requests, and the next local admission time. Day
exhaustion and provider retry holds contribute one workflow warning; ordinary
minute pacing remains visible without an outage warning. Existing funded
account failures retain their own critical classification.

The read does not update counters, move window starts, raise limits, claim
requests, or change account controls, purchases, receipts or spending. A failed
read preserves the previous observation as stale while independent workflow
monitoring continues. Missing limiter configuration is unavailable, not healthy.
The new RPC is service-only, and no technical warning is added to the customer
workspace.

The latest saved provider observation reported 9,917 remaining requests at
10:10 UTC, but that was not a reliable basis for resetting the local limiter.
The saved `dayRemaining` value jumped back to 9,999 twenty-three times between
07:20 and 09:57 UTC. The official [rate-limit documentation](https://api.docs.dealmachine.com/rate-limits)
defines `X-RateLimit-Reset` as the **minute** reset and provides no daily reset
timestamp. Historical provider observations are displayed separately and never
grant local capacity. There were no saved provider 429 responses in the reviewed
November 3 observations.

In the consumed window, the instrumented ledger recorded 6,931 free owner
requests, 717 paid owner export requests, 480 search estimates and 473 property
searches. Those 8,601 admitted ledger rows are only part of the shared limiter's
9,800 calls; legacy paths also use the common limiter. Request counts are not
data credits, customer charges, successful contacts or completed deals.

The isolated PostgreSQL test installs the actual prior incoming-text monitor,
then covers exhaustion with healthy worker reports, unchanged counters, the
elapsed-window calculation, bounded minute pacing, provider holds, repeated
refreshes, independent incident preservation, read failures and private RPC
access. This change diagnoses exhausted capacity; it does not promise to restore
research before a valid window opens.
