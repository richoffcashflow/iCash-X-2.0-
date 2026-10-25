# Returning-customer introductory checkout — gated release candidate

Offer: software access at $0 for two calendar months, then USD $50 per month until cancellation. Paid AI work credits are separate. Payment method collected in Stripe; no automatic work-credit funding. Shareable candidate path `/legacy-offer` is not a functioning production offer until released.

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
6. Run real browser interaction checks. Chromium execution was blocked by sandbox restrictions, so interaction assertions were not run. Production HTML render passed independently; this is not interaction coverage.

The implementation does not alter existing Stripe subscriptions/prices, grant work credits, unpause bots, or send marketing. Synthetic provider checks must use test mode, unique example.invalid identities, no real customer/account reuse, and disabled mail transport. Shared Auth/account rows are not physically mode-partitioned; production entitlement and notification gates still require live mode. Existing legacy acquisition conversion logic remains paid-invoice-backed, so suppress trial customers before any acquisition campaign sends.
