# Reduce duplicate-only data pulls

Overlapping audiences can return already-assigned properties even while the exact-page cache prevents identical repeat queries. A new account or revision previously had to discover an audience's duplicate-only supply independently. Duplicate rows do not imply another billed data credit; DealMachine reports billing-period deduplication separately. The platform already covers confirmed wholly duplicate pages rather than charging the customer for them.

## Behavior

Use the latest three original property-search attempts in the same ZIP and legacy audience, within 24 hours. Only three complete pages with settled known costs, positive returned rows, zero newly queued properties, and all rows confirmed duplicates qualify. Every receipt must match its original account and operation, the current page size, and the exact static research-query policy. Limit original attempts before joining receipts so a newer unfinished, uncertain, differently shaped or incomplete request breaks the streak.

The existing allocator receives this as `recentUnproductivePages: 3`. Productive audiences receive ordinary exploration; cooled audiences share the existing one-in-five probe slots. New accounts/revisions honor the same aggregate supply evidence, including when their local cursor has zero pages. A productive probe ends the shared streak immediately. Evidence expires after 24 hours, and all-cooled or only-cooled inventory remains searchable. This is temporary supply feedback, not a conversion winner, seller rejection or training label.

No property IDs, contacts or assignments move between customers. Exact-page caching, local no-owner evidence, eligibility, active/DNC owner exports, immutable targeting definitions, financial holds, buyer/seller ownership and final admission remain authoritative. New targeting experiments retain their separate paused state and exclusion-readiness requirements. The change does not synchronize or enable the disabled provider exclusion list.

Standard 3× / VIP 2.1× data pricing, recorded credit-cost allocations and actual-used settlement remain unchanged. The application retains its existing 50/minute and 4,900/day limits until the provider increase is verified and separately configured. More request capacity is not evidence of better conversions.

## Release and verification

1. Deploy the matching application change after Reliability checks pass. Its allocator change is compatible with the old database.
2. Apply `20261030200310_research_market_duplicate_cooling.sql`. The migration adds an indexed, bounded aggregate reader and wraps the existing filter-state reader; it does not mutate purchase history or admit paid work.
3. Confirm matching production web/worker releases, private RPC permissions, the query plan and read-only sample results. Compare future duplicate-only page rate, fresh financially eligible/contactable supply, qualified conversations and verified contracts per dollar. No live lift is established by offline checks.

Offline tests cover fewer than three pages, cross-account aggregate evidence, original account binding, pending/unknown requests, missing cost fields, actual zero costs, mismatched query shapes, other ZIPs/audiences, expiry, productive recovery, cold-cursor probes, all-cooled fallback, unchanged holds, and denied public/customer execution. PGlite fixtures do not establish real multi-session concurrency behavior; final admissions retain their original locks.

To disable shared cooling without deleting data or changing the application, replace the wrapper body of `icash_discovery_filter_state_v2(uuid,uuid,integer)` with a call to the preserved `icash_filter_state_before_supply_cooling(uuid,uuid,integer)`, retaining the existing function signature and service-only grants. The allocator continues to respect original local feedback. No paid retry, quota reset or hold release is part of rollback.
