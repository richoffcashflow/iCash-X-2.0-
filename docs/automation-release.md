# Scheduled discovery and owner enrichment

Railway now checks for due work through the shared database, without another credential or a browser session. The worker still performs deterministic screening locally. Every 15 seconds it can request one automation ticket; per-account default spacing is 15 minutes and administrator configurable (5 minutes to 24 hours). Database locking coordinates replicas. All automatic paid work remains disabled until the operating budget and account discovery configuration are explicitly enabled with verified rates and funding.

The database mints an expiring 256-bit random bearer capability. Railway sends it in an Authorization header to the fixed production Vercel endpoint. Vercel atomically consumes it once and resolves the tenant and operation from the database. No key, caller-selected account, arbitrary URL, or financial policy is accepted from the request. Tickets and contacts are service-only tables; tokens are not logged. An uncertain HTTP outcome is never automatically resent. Issued tickets expire; consumed failed jobs stay held for reconciliation. No new environment secret is required.

Eligible owner enrichment is prioritized over another discovery page. Enrichment re-runs the same deterministic underwriting using the stored snapshot and current time; stale or failing data blocks the lookup. Its separate `owner_enrichment` rate must cover the configured vendor-credit allowance plus the existing all-in cost categories. The shared `property_credit_micros` used for this check must be conservatively verified to cover both property and people units on the account's plan; differing unit rates require using the higher rate or a separate rate model before enabling.

The documented single-property GET with `contact_audience=owners` returns actual owners/associated contacts and a credit receipt. It does not document an estimate mode or a hard maximum-contact parameter. Therefore `contact_credit_cap` is a reservation allowance, NOT a provider-enforced maximum. A response over that allowance is persisted, flagged for reconciliation and disables further contact enrichment. This cannot guarantee no one-request overrun; enabling the route requires an operator-reviewed quote and acceptance of that bounded operational policy. No fabricated API parameters or price guarantees were added.

Only allowlisted names, person IDs, phone metadata, email addresses and ownership indicators are saved. DNC true/false/unknown is preserved. Every phone is permission-unverified; every result has outreachAuthorized=false. Contacts are not proof of ownership or consent. Raw owner data is not sent to the customer activity feed in this release.

Paid operation reservations remain held until the full provider and allocated costs are reconciled through the existing settlement RPC. This is intentional: a receipt in vendor credits is not a verified all-in dollar invoice. Missing rates, zero company funding or disabled account configs prevent live requests. No account settings or enabled rate cards were invented during release.

## What is complete in this release

- Automatic due-work selection and short-lived one-use dispatch tickets.
- Vercel dispatch using its existing DealMachine key; Railway needs no DealMachine key.
- Financial-screened owner enrichment, cost reservations, receipt persistence and overrun hold.
- Pause/balance checks, per-account pacing, replay protection and isolation.
- Mock-provider checks, database rollback tests and production build.

## Remaining product work

Verified cost/rate activation and company cash funding; account market onboarding/configuration; full dollar-cost reconciliation; customer UI wiring for these persisted results; channel authorization and live seller/buyer dialing; production callback execution; e-signature and title-provider execution. SMS remains disabled. None of these were represented as live or complete.
