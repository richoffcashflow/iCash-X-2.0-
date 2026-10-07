# Customer funding and inbound intake audit

Audit basis: repository ca22b8c plus launch workspace changes; read-only production receipts on 2026-10-07 at 18:54–18:58 UTC. No customer enrollment, charge, message, call, credit grant, hold release, or live reconciliation was performed.

## P1 fixed locally: membership webhook recovery

Previously the billing cron recovered legacy daily invoices and membership cancellation only. Membership GET reconciled pending/unpaid memberships, but not a previously paid active membership with a missed renewal event. A successfully paid renewal could leave paid_through stale and lock the customer indefinitely after webhook retries were exhausted.

Added a bounded membership recovery queue to the existing five-minute billing reconciliation route. It checks canonical subscriptions and the most recent paid invoice using the existing strict verification and idempotent invoice settlement. Pending checkout recovery remains bound to its recorded session. Failure rotates updated_at so one broken row does not indefinitely starve later rows. No schema change, Stripe write, credit grant, or relaxation of cancellation/review gates. Latest paid membership coverage is recovered; this is not a full historical invoice backfill.

Files: lib/membership-reconciliation.ts; app/api/billing/reconcile/route.ts; tests/membership-reconciliation.test.mjs; the route dependency mock in tests/daily-invoice-recovery.test.mjs.

## Production evidence and remaining gates

- Membership offer is enabled at 5,000 USD cents/month, revision 1. One live active membership is paid through 2026-11-07 02:50:47 UTC; five other live membership rows are pending.
- Funding has two paid live orders, one pending live order, and paid/pending test orders. These receipts do not prove future renewal, retention or cancellation behavior.
- No auto-recharge enrollment exists. Opt-in charging, off-session bank authentication, cancellation races, retry identity and mismatched receipts have fixture tests; a real opt-in/charge cycle remains unverified and was not authorized for this audit.
- Membership terms explicitly include $0 work credit. The historical request for $5 included credit remains a business decision; this audit did not change either financial terms or credits.
- One intake has an assigned lead with a persisted 12-cent allocation receipt and screening identity. Its response records SMS accepted, voice outcome unknown/no retry, and stopped/human control. Do not redial or release the unknown provider hold based on this audit.
- An older intake remains review: lookup outcome unknown, do not repeat automatically. This is intentionally fail-closed, but needs verified provider receipt resolution before its reservation can change.
- A new intake arrived at 18:54:41 UTC during this audit and reached numbers_review without an audit submission. This demonstrates new intake processing, not successful allocation or financial eligibility.

## Coverage boundaries

Signup uses verified email sessions and account-scoped funding claim; the account read refreshes sessions. Checkout binds current offer revision/price, mode, stored customer/session and consent. Cancellation persists workspace lock before provider cancellation; retry preserves the lock. Retention checks the exact 50%-for-six-months coupon and canonical invoice amount. These paths were inspected and existing fixture suites run; no new-account email, browser login, real membership cancellation, retention application or paid test was initiated.

Seller research reserves before bounded address lookup, persists a provider receipt on decoding/qualification failure, avoids ambiguous retries, and has cron fallback. Allocation/contact receipts were read; no protected funded provisioning or reservation function definition was inspected or modified. End-to-end live customer operation, successful buyer agreement, closing and payout remain outside this evidence.

## Validation

Passed: membership-reconciliation, membership-billing, daily-invoice-recovery, early-access-funding, funding-checkout-copy, funding-status, and new-customer-readiness suites. TypeScript noEmit passed after recovery changes. Four pre-existing test failures were repaired by supplying missing policy/query fixtures and aligning assertions with the existing separately authorized auto-recharge UI and renamed discovery result. Monetary guards were not weakened. Aggregate test/build/release verification belongs to the launch integration; these focused passes do not certify deployment.

The new 18:54 UTC intake's provider match is true. Its financial check holds because estimated equity is below the 70% acquisition minimum; no repeat lookup or forced allocation is warranted from that receipt.
