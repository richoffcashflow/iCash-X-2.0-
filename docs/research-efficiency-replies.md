# Research efficiency and reply corrections — October 28, 2026

## Duplicate-request follow-up — October 29

The 03:00 UTC read-only sample contained 11,265 returned properties and 5,270 duplicates over 24 hours. These are inventory counts, not charged-credit attribution. A separate read-only sample found 110 repeated owner requests within the same account across batches. Current batch ID deduplication does not imply organization-wide reuse of purchased contacts.

`config/research-duplicate-efficiency.sql` shares validated, non-contact free estimates for the same exact JSON query and exclusion-list generation, with the original five-minute age. The existing global admission lock and durable lease coalesce concurrent requests. A matching failed estimate retains its two-minute backoff. Every requester still passes its own current scope, membership, funding, Pause, quota and unknown-operation checks. Only the two validated estimate values are shared, never owner contact data. `estimates.shared_hits` records actual shared cache hits; no projected savings are booked as revenue.

The exact version/ZIP/strategy/page/size duplicate check now runs before estimates and again under final purchase locks. This closes the race where another worker finishes assigning a page while the caller awaits its estimate. Partially assigned pages remain available; changed versions, page sizes and mutable exclusion-list queries cannot borrow a static receipt. Historical receipts, current customer rates, provider cost observations and duplicate-page coverage are unchanged. This does not eliminate overlapping audiences or provide a cache of purchased owners across different properties.

Active exports now check enabled state, the organization slot and capacity for preview/export/original recovery before making a free preview request. Atomic final admission remains authoritative if capacity changes during that request. An HTTP error without an export ID reports `export_receipt_held`, never ordinary recovery-idle success. The original production HTTP 500 from 02:46:38 UTC still has no export ID or credit receipt; its cost is unreported. New active exports remain disabled pending original-operation reconciliation. The documented export/history APIs do not provide a request-ID-to-export-ID lookup that resolves this receipt safely.

Migration `20261029030852_research_duplicate_efficiency` was applied through Supabase MCP; its provider-generated history version names the identical repository SQL. Readback verified service-only access, the new index/final guard and unchanged original-export receipt hash, held slot and disabled flag.

Validation uses synthetic PostgreSQL fixtures and mocked provider transport: cross-account identical estimates, in-flight leases, failed-request backoff, cache age, changed page, account funding/Pause, final duplicate-page refusal before financial admission, partial inventory, export preflight and saved-500 no-retry behavior. PGlite serializes test connections; this is not a claim of a real multi-session contention test. No paid development traffic, new customer charges or provider billing changes are used to validate the release.

This release applies to normal account processing. It does not change wallets, provider billing, automatic-recharge settings, the owner's demonstration setup, or paid development-test permissions.

## Requests and duplicate property pages

Free cost estimates still consume provider requests. Before one runs, the database now checks the saved configuration, account admission, filter cursor and unresolved global query claims. Blocked filter arms cannot starve other eligible arms. A private one-minute lease prevents concurrent workers from requesting the same estimate; a valid result is reused for five minutes only with the same operation, exact query and exclusion-list generation. Failed free requests back off for two minutes. Disposable estimate metadata is pruned in bounded batches after one day. Paid admission still runs separately with every original financial and one-use claim check.

The existing fully-assigned-page cache now handles research query versions 1 and 2. It requires the same ZIP, strategy, provider page, page size and query policy, a receipt under seven days old, and an existing assignment for every property. Pages with mutable exclusion lists or any unassigned property cannot be skipped. Provider exclusion-list queries remain disabled after earlier timeouts; the unused list is no longer synchronized. Pending exclusion IDs and unknown original claims remain saved.

Provider rate-limit headers are retained as request observations. A 429 response imposes a shared Retry-After hold; an exhausted minute with a plausible documented reset timestamp pauses admission until that time. Older observations cannot replace newer metadata or shorten a hold. The existing 50/minute and 4,900/rolling-day ceilings and recorded counters are unchanged. The documentation does not establish a daily reset timestamp, so this release does not invent one or claim increased provider entitlement. Request reuse reduces pressure but cannot guarantee relief from every daily quota wait.

## Owner batches and replies

If the first property's preview has no usable owners, remaining eligible properties from that same preview can still form one paid batch. The first surviving property becomes the admission primary. The original empty property gets no owner purchase; all saved contacts retain their exact source property, account and original receipt. The five-property limit, owner-only selector, phone-availability checks, DNC/source controls and actual aggregate credit allocation remain enforced.

The signed text webhook now accepts the provider's documented `imessage.incoming` and `communications.incoming.*` names. It normalizes them for the existing incoming-message path and retains the original event in the saved payload. Signature freshness, destination registration, account routing, opt-outs, attachments and duplicate-event handling remain intact. Rejected or failed processing emits only fixed diagnostic reasons/stages, never message bodies, phone numbers, secrets or provider errors. This repairs an unsupported-event gap; it does not prove why every historical recipient failed to reply or reconstruct missing provider events.

## Seller-interest evidence

When provider analysis omits interest extraction, a narrow source predicate can recognize a direct first-person statement about selling or an affirmative reply immediately after an unambiguous selling/cash-offer question. The exact original quote is retained. Ownership confirmations, permission to talk, conditional answers, reported quotes, refusals, opt-outs and automated audio do not qualify. Buyer classification is unchanged.

The same predicate feeds derived opportunity outcomes, learning and ranker labels. The owner outreach report also includes receipt-bound SMS interest within the requested time period, aggregated only for threads with an actual interest question rather than queried again for every property. Original transcripts, provider results, payments and contact permissions remain untouched. Existing bounded refreshes recalculate derived history. No model is activated without its original qualification checks, and no improvement in conversion is claimed before it is observed.

## Release and verification

Apply `20261028221222_research_request_reuse`, `20261028221416_research_provider_feedback` and `20261028221449_seller_interest_evidence` before deploying the matching service code. These are additive or backward-compatible changes; each function patch checks its prerequisite definition. Do not roll back by deleting original receipts, releasing holds or resetting quotas. Code rollback can retain the compatible database changes.

Offline PostgreSQL and service fixtures cover leases/cache expiry, changed scopes, funding/pause controls, unchanged unknown claims, exact duplicate-page reuse, provider backoff, missing-credit observations, owner-batch allocation, signed aliases and SQL/TypeScript interest parity. Full release checks run without paid provider traffic. Observe ordinary production request categories, duplicate yields, saved inbound events and qualified interest after deployment; do not use volume alone as success evidence.

Active-phone export filtering is outside this release and remains unverified. No diagnostic export approval is renewed or reused.

Provider references: [DealMachine rate limits](https://api.docs.dealmachine.com/rate-limits), [Contiguity v2 events](https://docs.contiguity.com/api-reference/webhook/example-v2), [Contiguity webhook overview](https://docs.contiguity.com/api-reference/webhook/overview).
