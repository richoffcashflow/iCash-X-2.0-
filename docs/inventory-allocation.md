# Inventory allocation

Before a paid owner-enrichment reservation or seller SMS/voice reservation, the database claims the property and, when known, a hash of the destination phone. The sending number is irrelevant. Competing accounts cannot claim the same resource during the 30-day cooldown. Active contracts, pending callbacks and unresolved voice conversations retain their assignments past that cooldown. Opt-outs across SMS and voice are checked when claiming a phone. All normal wallet, permission and dispatch checks remain in effect.

The private tables contain allocation keys, account IDs and screening references, not shared contact records or conversations. Customer roles cannot read them. No cross-tenant vendor data cache is introduced or vendor redistribution rights presumed. Owner-only practice diagnostics remain a distinct non-acquisition path.

Exhausted discovery configurations rotate only into account-specific ZIPs whose eligibility has not expired and whose next-scan date has arrived. Each selected ZIP gets a 30-day rescan cooldown. The existing filters, financial screening, daily limits and data-rights expiry remain unchanged. If no eligible market is configured, discovery stays exhausted and does not keep buying pages. The scheduler can revisit an eligible ZIP after cooldown, allowing fresh records to enter screening; this does not guarantee fresh inventory or authorize recontact after opt-out.

Empty cost-estimate results now mark the current revision/page exhausted. Stale responses cannot exhaust a newer market. No market approvals or customer campaign configurations were fabricated or enabled by this release.

Verification: rollback fixtures exercise property and destination-number conflicts, no partial allocation, tenant ownership, active-contract protection, expired inactive reuse, STOP suppression, eligible market rotation, missing inventory, rescan cooldown, stale responses and restricted privileges. TypeScript validation passes. No paid calls or texts are used by these checks.
