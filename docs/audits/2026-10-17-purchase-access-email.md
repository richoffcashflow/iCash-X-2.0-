# Purchase-to-account access

The production sign-in eligibility query omitted software subscriptions. A first-time paid software buyer without a credit purchase or existing account could see the generic code-sent response without an OTP request. The sign-in migration adds the same active, paid, unclaimed membership gate used by verified-email account claiming. Existing accounts, mode separation and non-enumerating responses remain intact.

`/access` is a shareable setup/sign-in page for existing buyers. It asks for the checkout email and reuses the existing passwordless code verification. It never starts another checkout or grants access from a URL. Purchase-specific links resolve only under the verified user's account. Wrong-account visitors can sign out and use their payment email. VIP destinations resolve from the purchased membership and still require active access.

New live first payments queue one transactional access email in the settlement transaction. The signed Stripe webhook and same-browser verified payment return wake delivery immediately; the existing minute maintenance worker recovers missed wake-ups and temporary failures. Closing the page does not lose the email. Renewals, free invitations, test payments and historical purchases do not create welcome emails.

The private outbox uses a unique membership, an atomic lease, a stored message, and one provider idempotency key. Retries reuse the exact payload, stop after six attempts or before the 24-hour provider window expires, and retain failures for review. Payment, recipient and suppression checks run again before sending. Verified provider events record delivery, delay, bounce and complaint status; out-of-order delivery cannot erase a suppression. No marketing preferences are changed and no login session or one-time code is embedded in the email.

Database migrations applied and read back:

- `20261017145924_purchase_access_email`: private RLS table, first-payment trigger, service-only queue/delivery RPCs; no historical backfill.
- `20261017150110_purchase_email_signin_eligibility`: first software buyers qualify for a requested code. Production readback confirmed five active unclaimed purchases qualify; no code or customer email was sent by development checks.

Validation includes real in-memory PostgreSQL settlement/queue tests, first-buyer OTP route fixtures, duplicate webhook and renewal handling, response loss, lost database receipts, concurrent leases, retry expiry, bounce and billing gates, wrong-account access, published VIP selection, preview exclusion and private permissions. Browser fixtures exercise the actual account page and code form using intercepted requests, never real OTPs. Standard release and GitHub Reliability gates remain required for deployment. This change is independent of the held webinar-reminder migration in PR #303.
