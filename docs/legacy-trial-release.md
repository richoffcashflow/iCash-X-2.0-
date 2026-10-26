# Returning-customer introductory checkout — gated release candidate

Offer: software access at $0 for two calendar months, then USD $50 per month until cancellation. Paid AI work credits are separate. Payment method collected in Stripe; no automatic work-credit funding. Shareable candidate path `/legacy-offer` is not a functioning production offer until released.

## Verification update — October 26, 2026

- Exact candidate `661fba1fcbacf22fc3548fcba52c163df7d94f02` passed GitHub Actions run `40247028722`: all-tests, dependency audit, verified build, bounded concurrency, and browser tests.
- Hosted Stripe sandbox checkout completed from the preview using only a synthetic `example.invalid` email and Stripe's test card. Checkout displayed $0 now, a payment method requirement, and $50/month after the two-calendar-month period. The browser returned through confirmation to `/access`, without webinar or VIP handoff.
- The matching test-mode membership became active with initial price 0, recurring price 5000, and identical trial-end/access-until timestamps. No live customer or live payment was used.
- The welcome-back page has its own scoped styles and no-index metadata. Public standalone separate-credit copy was removed; the saved offer terms are unchanged. Reminder clock times use explicit AM/PM in UTC.
- Hosted paid-renewal, failed-renewal, cancellation and cross-device authenticated sandbox checks are still pending. The connected Stripe account exposes live mode only, and the sandbox dashboard requires sign-in. Keep production activation disabled until the remaining provider checks pass. Synthetic lifecycle tests do not replace those checks.

## Isolation

- `ICASH_LEGACY_TRIAL_ENABLED=true` enables only the new route; absent/false is closed.
- Owner-distributed link, existing-customer terms; no imported-contact eligibility prerequisite. Anyone with the link can attempt the offer. One trial per normalized email/mode; not a strong one-person/legacy-purchase identity proof.
- Existing 2.0 membership and email/account duplicate protections remain. Existing prices/subscriptions/global offer unchanged.
- New membership stores immutable offer marker, initial $0 and UTC calendar deadline. Deadline starts on checkout preparation, not completion; Stripe displays exact first charge date. An independently confirmed expired session can restart with a fresh two-month deadline and idempotency generation. Unknown provider outcomes are not retried under a new key.
- Canonical Stripe checkout, subscription, customer, price, mode, and original $0 invoice checks grant access through the deadline. No fake payment receipt or credit ledger entry. Paid renewals keep the existing full paid-invoice/payment-intent verification.
- Existing `paid_through` field means access-until for trial memberships. Refund/review/cancellation locks remain durable. No bot unpause or free work credits.
- Success confirms the browser-bound checkout, then opens `/access` for verified-email claim, not paid signup/VIP upsell. Access copy is neutral checkout language. Free trials do not currently qualify for the paid-invoice welcome-email queue; do not promise an email was sent.

## Required before publication

1. Publication and additive database migrations are approved. Production offer activation remains gated on verification; deployment does not by itself open the offer.
2. Initial `20261025231000_legacy_two_month_trial.sql` was applied separately. Apply the additive `20261025234000_legacy_trial_pending_signin.sql`, `20261025234100_legacy_trial_subscription_consumption.sql`, and `20261025234206_legacy_trial_ending_reminders.sql`, then deploy matching code with production flag disabled until verification. Never edit an already-applied migration.
3. Validate in a separate Stripe sandbox: $0 checkout, access claim, missed/duplicate/out-of-order webhooks, exact date display, required payment method, paid renewal, failed renewal, cancellation, and timezone/month-end boundaries. No sandbox connector was available; mocks are not this test.
4. Enable `customer.subscription.trial_will_end` on the existing endpoint only after the reminder migration and matching code are deployed. The transactional reminder uses canonical live Stripe state, exact end date/$50/cancellation instructions, and a private deduplicated outbox; preview never sends. Verify actual hosted checkout cancellation disclosures. No marketing is sent by this feature.
5. Verify cross-device recovery in sandbox: a verified-email owner can recover completed checkout, or expire an open checkout and replace only after canonical expiry. The old row and immutable acceptance remain preserved; a fresh member/acceptance belongs to the new browser. Unknown/null-session provider outcomes remain held for guarded support investigation. No anonymous email-only takeover.
6. Real browser interaction checks passed in GitHub Actions run `40247028722` on candidate `661fba1`; rerun them after changes. The hosted sandbox checkout and access handoff also passed as recorded above.

The implementation does not alter existing Stripe subscriptions/prices, grant work credits, unpause bots, or send marketing. Synthetic provider checks must use test mode, unique example.invalid identities, no real customer/account reuse, and disabled mail transport. Shared Auth/account rows are not physically mode-partitioned; production entitlement and notification gates still require live mode. Existing legacy acquisition conversion logic remains paid-invoice-backed, so suppress trial customers before any acquisition campaign sends.
