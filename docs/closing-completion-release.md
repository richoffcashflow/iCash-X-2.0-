# Closing completion — October 11, 2026

Buyer packages now put buy/view actions ahead of the photos. Each action composes an address-specific SMS to the deal's enabled business sender; the buyer must send it. The existing reply workflow supplies the private next-step page. Desktop users see texting instructions. These buttons do not sign, reserve, send a message on page load or accept a payment.

The private buyer page shows progress, links back to the photos and accepts viewing, price, timing, repairs, funding or human-help requests. Each obstacle creates a specific account-scoped task. A human request uses the existing property hold. Resuming requires the owner to record a versioned outcome; it never revises signed terms or retries an uncertain delivery. Seller availability and both-party visit confirmation remain separate.

Users can reuse a previously verified closing-office contact as a preference. The new property still requires the existing coverage, agreement and independent contact-verification checks. After verified title disbursement, the owner can record actual receipt. Title saying money was sent does not count as receipt.

Workspace requests are grouped by property, with related requests behind a disclosure. Filters distinguish needed user action, work in progress, waiting on others and history. Closed deals without a receipt remain in waiting. Admin adds confirmed closings, confirmed customer receipts, current stages and unresolved delivery/buyer issues; customer proceeds are separate from platform usage earnings.

Actual VIP members can see up to 12 ZIP markets with at least three fresh, opted-in network buyers. Counts exclude paused, expired, suppressed and unconfirmed buyers. These are self-reported buying preferences, not proof of funds or automatic property sourcing. Appearance preview grants no access.

Apply `supabase/migrations/20261011165415_closing_completion.sql` before releasing the app. It wraps installed journey functions, adds service-only RLS tables and extends the existing one-source handoff constraint. It does not backfill contacts, launch paid simulations or dispatch test messages. Roll back app code independently; do not drop recorded buyer requests or receipts.

Validation uses the exact migration in local PostgreSQL (PGlite): eight scenario groups cover buyer/seller roles, idempotency, access requests, blocker holds, human handoff, stale submissions, account isolation, uncertain delivery, title reuse, receipts, VIP demand and privileges. Targeted UI/API regressions, TypeScript and the production build are also required. No development call, SMS, email, AI simulation or payment is sent. Live customer closing outcomes still depend on signatures, verified deposit receipt, title and owner confirmation.

Run the database scenarios with an installed PGlite entrypoint:

```sh
node --experimental-strip-types tests/closing-completion-database.mjs /path/to/@electric-sql/pglite/dist/index.js
node --experimental-strip-types tests/closing-completion.test.mjs
pnpm build
```
