# Property discovery bridge

The authenticated, same-origin POST `/api/work/discovery` resolves the account server-side. It accepts no customer-supplied market, pricing or policy. It uses service-only `icash_discovery_configs` containing an approved ZIP, rate version, per-property dollar allocation, data-rights expiry and seller cost reserve. Default disabled; no production configurations or verified operation rates were fabricated.

A bounded page (default 5, maximum 10) requests Single Family properties with `contact_audience=none`. The current release does not underwrite land. It sends the identical query first with `estimate_cost=true`, checks no people credits and sufficient DealMachine cost allocation, then reserves customer/company funds and claims the operation once before the billable search. Operation identity includes tenant, revision and page. Uncertain paid requests are held for reconciliation, never automatically replayed. Both requests pass a shared database request budget (50/minute, 4,500 per rolling reset day); other legacy/private provider paths are not yet wired to that same budget, so this leaves headroom, not a universal account-wide limit.

The response is validated; only allowlisted property fields are retained. Actual provider credit usage, result snapshots, queue entries and the cursor are committed in one database transaction. An over-estimate receipt disables this account's discovery config. Cost observations are not dollar invoices: full operation settlement still requires verified complete costs through the existing settlement RPC. This release deliberately does not charge/release funds using a partial receipt.

The existing Railway worker processes the saved snapshots. Qualified preliminary numbers permit the *next permission and cost check*, not automatic outreach or an approved offer. Missing data, unsuitable numbers and land remain held. Contact enrichment, seller dispatch, contract and title integrations are not enabled by this bridge.

## Rollout requirements

- Verified `property_search` rate with all cost categories, company cash allocation and enabled operating budget.
- Approved tenant market/data rights and conservative seller closing reserve.
- API key already configured on Vercel. Real provider schema/field support still needs verification before activation; unit/database tests used fixtures and spent no vendor credits.
- The Railway unattended scheduler is now wired through one-use database tickets; see automation-release.md. It requires enabled account configuration and operating budget. Customer UI result wiring is still pending and `workReady` remains false.
- Configure a new revision when changing search criteria; avoid modifying a configuration while it has unreconciled dispatches.

## Verification

Production build; mock-provider tests proving estimate-before-reserve-before-fetch, no contact requests, no timeout retries, cost holds and overrun handling; rollback-only SQL tests proving receipt/queue/cursor atomic persistence, duplicate protection, request limit and service-only access. No paid provider request was made.

Sources: https://api.docs.dealmachine.com/concepts/searching ; https://api.docs.dealmachine.com/concepts/credits ; https://api.docs.dealmachine.com/concepts/response-format . Official llms-full snapshot reviewed for endpoint request and receipt schemas.

## High-equity acquisition policy

Search now uses documented `equity_percent`, `greater_than_or_equal`, 70 and requests `estimated_equity_percentage`. Estimate and paid requests use the same filter. All returned property receipts are retained for billing even if a record later fails screening. Screening and owner-enrichment rechecks use the lowest available equity estimate from provider percentage, equity/value, or (value-debt)/value. Unknown, invalid and below-70% estimates hold further enrichment/call eligibility. Exactly 70% passes this filter only; repairs, assignment fee, seller reserve, liens, permissions and cost gates still apply. This is separate from the 70%-of-ARV offer formula. Before enabling an existing discovery configuration, start a fresh revision/page cursor for the changed filter. No paid queries were used for verification.
