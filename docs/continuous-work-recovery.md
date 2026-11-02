# Continuous work after an export failure

The November 2 production audit found funded, unpaused customer accounts with available credits and an organization-wide contact-export hold after a completed DealMachine HTTP 500. Property searches continued, but no later contact export could start. Changing a spending percentage would not remove that hold: funded-wallet admission already permits continuous work.

Recent successful provider responses also confirmed a higher organization request entitlement: 70/minute and 10,000/day. The separate `verified-dealmachine-capacity.sql` migration requires fresh matching original observations before moving the application from 50/4,900 to 60/9,800. It preserves counters and window starts, retains provider backoff, and saves the source evidence with the original configuration privately. It does not buy a plan, enable overages or alter customer prices.

The owner requested automatic recovery. `automatic-export-capacity.sql` adds an initially disabled private policy. The existing authenticated maintenance lane can claim a recovery for an exact completed `internal_error` response, with a saved provider request ID but no export ID. Timeouts, missing responses, incomplete request observations and explicit manual reviews retain their original holds.

Each attempt permits at most three free GETs: a nonempty recent unfiltered organization inventory, then separate pending and processing inventories. Both active-status results must be completely empty. All requests consume shared quota, save their original raw receipts privately and have independent one-use claims. This works when historical inventory exceeds 100 exports; it does not mistake a truncated all-status page for a complete inventory. The unfiltered page must include a terminal record at least as recent as the incident, with provider whole-second timestamp precision. No history row is attributed to the failed purchase by time.

Successful verification releases only the organization scheduling slot. The failed owners remain excluded across accounts; their purchase, unknown costs and wallet commitments remain unchanged. Unrelated eligible production work can then proceed through its ordinary final admission. No purchase, call, text, download or development simulation is performed by recovery.

Failed and interrupted free checks create distinct attempts after 2, 4, 8, 16, 32 and then 60 minutes. Prior claims and responses remain immutable. Saving identical evidence or confirming the final result may retry after acknowledgment loss; provider GET claims are never reused. Each attempt records the executing release. The existing export monitoring continues to flag prolonged blockage.

Deploy the migration disabled, publish the matching application, require exact-commit CI including native PostgreSQL contention, then enable the private policy. Rollback disables the policy; it does not erase evidence or revoke a verified historical capacity decision. New releases inherit the policy through the established production release gate rather than requiring an incident-by-incident approval.

Offline checks cover source/HTTP/identity requirements, stale and malformed inventories, more than 100 historical exports, active exports, missing quota, interrupted requests, acknowledgment loss, backoff, private grants, and unchanged owner/financial holds. Native PostgreSQL runs multiple competing claim, save and finalize sessions. These checks establish recovery behavior, not provider reliability or guaranteed customer spending.

Other observed constraints remain real: the 424 sender is disabled, old contact checks expire, and uncertain calls/messages retain their original reconciliation requirements. Continuous operation means selecting eligible work and recovering safe failures; it does not override pauses, recipient controls, available credits or provider limits.

Provider contract: https://api.docs.dealmachine.com/api-reference/exports/list-exports documents `pending`, `processing`, `completed`, `failed`, status filters and pagination totals.

Rate-limit headers and organization scope: https://api.docs.dealmachine.com/rate-limits.
