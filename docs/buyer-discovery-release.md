# Buyer discovery release

The post-contract preparation worker now supports bounded DealMachine candidate discovery through `POST /v1/properties/search`: people anchor, owner audience, and address-only output. It filters recent corporate-owned properties with zero recorded mortgages. This identifies potential buyers; it does not establish that the purchase was cash, that an owner wants another property, that funds exist, or that outreach is permitted.

Each page is estimated before a paid request. It requires an enabled `buyer_discovery` rate covering the full cost ledger, account-specific licensed data rights, available customer credits, operating reserves, a verified signed purchase, no account pause or manual property takeover, and a one-use operation claim. Pages are capped at ten records, five pages per deal/configuration revision. The UI displays potential buyers separately from verified matches. Unknown paid outcomes require reconciliation; there is no automatic paid retry. Provider credit overruns or unexpected property charges disable the buyer-search configuration.

Configure service-only `icash_buyer_search_configs` with account, reviewed rate, actual cost per credit, rights expiry, ZIP, since date and page bounds. No enabled configuration or cost rate was invented. Discovery can run only after those values are supplied. Contacts retain provider DNC flags; discovery does not grant AI-call or messaging consent. New profiles have empty buying criteria and cannot pass the existing confirmed-buyer matcher. Existing confirmed criteria are preserved on rediscovery.

The stored candidate link is per deal/account and expires from customer access with data rights. Profiles deduplicate by DealMachine person ID, not an unverified corporate-entity identity. Actual criteria, funds, authority and contact permission must be recorded through a verified qualification process before buyer outreach/acceptance.

Build verification uses the same query with `estimate_cost:true` only. It saves a private readiness check without fetching contacts. Normal deployment no longer invokes scripts that send test signing emails or mutate templates. DocuSeal test and live connectivity are checked separately; no template or signature request is created by the build.

Production signing still requires the platform live `DOCUSEAL_API_KEY`, approved production templates and an enabled contract-signing cost rate. A test credential or draft template is never silently promoted. Title execution and complete billing-source ingestion remain separate launch blockers.

Verified: mocked buyer discovery tests, existing fulfillment tests, transactional database checks with ROLLBACK, and Next.js production build. No paid test records, calls, messages or signatures were requested.

Sources reviewed 2026-09-29:
- https://api.docs.dealmachine.com/concepts/credit-efficient-queries
- https://api.docs.dealmachine.com/concepts/credits
- https://api.docs.dealmachine.com/api-reference/properties/search-properties
- https://api.docs.dealmachine.com/llms-full.txt (owner/mortgage/date filter catalog)
