# Seller workflow continuity

This release repairs acquisition scheduling and workspace prioritization. Existing voice, SMS, signing, and fulfillment modules retain their existing authorization and provider configuration checks.

- Eligible properties receive enrichment before another property search. Enrichment advances at most once per minute per account rather than waiting the full acquisition interval.
- An expired, unconsumed contact ticket may be reissued up to three times, with a new one-use token. Consumed, uncertain, or already-reserved provider operations are never automatically replayed.
- Owner contacts already fetched for the same property/account within 30 days prevent another enrichment purchase. Manual-control properties are skipped.
- The default unresolved prospect limit is 20, internally configurable per account. Queued screening and eligible unresolved properties from the last seven days count toward this cap. Existing complete seller conversations or deal files remove properties from this initial-acquisition backlog.
- Customer wallet, Pause, data-rights, financial, provider rate, and company reserve controls remain enforced. No launch flags, contact permissions, or rates are invented or enabled by this migration.
- Workspace ordering occurs before pagination: Needs You, active contracts, callbacks, eligible properties, then reviewed properties. Six cards per page remain. Closed/canceled/title/closing states supersede historical signature labels.

Validation: integrated fixture flow covers property discovery, financial screening, enrichment, contact permission, bounded offer decisions, human takeover, and buyer matching only after signed evidence. SQL rollback tests cover ticket recovery, invalidated old capabilities, no replay of uncertain requests, backlog spending limits, Pause, tenant isolation, and priority ordering. No outbound provider calls are sent by tests.

This is not a verified live seller-to-closing transaction. Live voice configuration/permission, seller signing, and closing-provider outcomes must still be verified in their respective production flows before claiming full operational readiness.
