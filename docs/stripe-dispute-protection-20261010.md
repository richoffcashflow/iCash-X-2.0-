# Stripe dispute protection — October 10, 2026

The owner authorized shipping the audited dispute protections. New membership, credit, VIP and daily-plan purchases disclose final sales, subject to mandatory refund rights. Work-credit and daily checkout now require an unchecked acceptance control; existing membership and webinar VIP checkboxes explicitly include the policy. The workspace VIP upgrade also requires acceptance. The policy is shown before payment and carried into Stripe checkout text.

Purchase acceptance receipts bind the actual purchase, price, account/guest, mode, terms and policy version, exact text, server timestamp, trusted Vercel IP when present, and browser information. Receipts are append-only and inaccessible to browser database roles. Old purchases are not backfilled or assigned new terms. Legacy consent records remain available. Auto-recharge authority remains separately optional and versioned.

The existing credit activation and recharge database gates omitted the October 7 UI consent versions. The migration extends the explicit allowlists for those already-deployed versions and the October 10 versions, preserving balance, membership, review and ownership checks. New membership versioning uses an additive RPC so deployment order does not break the old application.

/admin/disputes is owner-only. It reads current dispute state and deadlines directly from Stripe, 50 per page, with pagination. Prepare evidence resolves the exact disputed charge/payment and iCash purchase, then collects accepted terms, delivery, completed account usage, authenticated account-request receipts, support excerpts and cancellation requests. Mode/account binding and private no-store responses prevent tenant exposure. Provider failure is an error, not a zero-dispute result.

Evidence is a review draft, downloadable as PDF or JSON. It identifies missing/truncated records, historical policies and account-level pooled-credit usage. Background account requests are labeled accurately; they are not claimed as a human click or verified cardholder identity. The PDF is capped below attachment size/page limits, uses 12-point body text, and preserves unsupported characters as explicit Unicode codes with original JSON available. It is never automatically submitted. No refunds, Radar plan changes, charge creation or business-branding changes are performed.

Signed, mode-verified dispute webhooks append event history. Existing billing holds remain intact; closed/won events never automatically release a hold. A trusted-main production build task adds dispute created/updated/closed/funds events only to already-enabled live iCash webhook URLs, preserving existing subscriptions and secrets. It reports the existing statement descriptor without changing account branding. Preview builds do not call Stripe. Stripe remains the place to review fraud rules, receipts, communications, cancellation details and submit a response.

Verification:
- PGlite database fixture: new membership version, exact acceptance binding, immutable retries and terms, wrong account/guest/mode/amount rejection, browser-role denial, hourly authenticated access receipts, current/prior version activation and recharge, unknown-version rejection and retained billing-review holds.
- Fixture service/API: owner auth before data access, payment/charge/mode binding, historical-only terms, missing evidence, excerpt limits, pagination, PDF/download routing, trusted request headers.
- Signed-webhook route and setup fixtures: signature/mode gates, expected hold calls, no hold release, canonical endpoint restrictions, idempotent configuration and preservation of prior events.
- Existing local tests for billing, checkout reuse, embedded checkout, early access, exact credit amounts, consent controls, VIP flow, post-purchase setup, account loading, admin and provider-test spending prohibition.
- TypeScript and diff checks. PDF fixture rendered and visually reviewed.

No paid simulations, calls, texts, emails or payment tests were run. A read-only production check is still required after the build is ready. No customer dispute was submitted during development.

Database fixture command:
`node --experimental-strip-types scripts/test-stripe-dispute-database.mjs /path/to/@electric-sql/pglite/dist/index.js`
