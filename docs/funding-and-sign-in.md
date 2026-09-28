# Account access and funding rollout

## Implemented

- Guest demonstration remains available without an account. Inline sign-in keeps the workspace on one page.
- The new funding checkout collects email and phone in Stripe. Phone collection is for account/deal coordination; no marketing SMS consent is implied or recorded.
- A paid guest order is saved before account creation. Email OTP verification claims paid orders into a persistent account. Entering an email at checkout is never sufficient to log into an existing account.
- Supabase Auth supplies access and refresh tokens. They are kept in Secure, HttpOnly, SameSite=Lax cookies; returning browsers refresh their session automatically for up to 30 days, subject to Supabase session policy. No passwords or tokens are stored in localStorage.
- A signed-in workspace has its own balance and paused state and does not render demo activity. It does not manufacture real opportunities. The live work dispatcher is not connected.
- Test funding totals are separate from the live credit wallet. Only validated live purchases are posted to the existing atomic credit ledger. Configurable pack prices are snapshotted into each order.
- Webhooks verify raw-body signatures and mode, re-fetch Checkout Sessions from Stripe, and match amount, currency, status, metadata and payment ID. Return-page reconciliation uses the same settlement function. Duplicate fulfillment is idempotent.
- Refund/dispute events create an administrative review and pause the affected bot. A database trigger prevents resuming accounts with unresolved reviews. **Refund accounting/reversal and dispute resolution are not yet automated; reconciliation is a live-launch gate.**
- Database-backed throttles limit OTP requests/verification and checkout creation. One pending order per guest/mode prevents simultaneous requests from creating multiple payable sessions. Add scheduled pruning of request-limit rows before broad public traffic.

## Current rollout state

The previously verified test checkout remains available as a fallback. Its legacy test orders are isolated and are not migrated into the new account system. Testers must use the new funding flow once email setup is enabled to test account claiming. No existing test purchase has been converted to spendable live credits.

The new flow is disabled until email setup is explicitly marked ready. Live payments also remain disabled until real service delivery is ready. No production Stripe keys were created, changed or printed during implementation. No customer emails/texts or live charges were sent.

## Email setup required

1. Configure a verified sender and custom SMTP in Supabase Auth. Default Supabase mail delivery is not a production mail service.
2. Set both the Magic Link and Confirm Signup email templates to include a code such as:

   `<p>Your iCash X sign-in code is <strong>{{ .Token }}</strong>.</p>`

3. Confirm email verification is enabled. Configure suitable OTP expiry, provider rate limits and bot protection before public acquisition.
4. Set `ICASH_AUTH_EMAIL_READY=true` in the Vercel **Preview** environment and redeploy.
5. Complete a new test payment, verify the emailed code, reload to check remembered sign-in, sign out, and verify returning from a second browser. Also verify a wrong/expired code and another customer's order cannot grant access. These email/browser flows are **not verified yet**.

## Production prerequisites

- Configure `STRIPE_SECRET_KEY` with the live key and `STRIPE_WEBHOOK_SECRET` with the **live endpoint's** signing secret in Production only.
- Endpoint: `https://i-cash-x-2-0.vercel.app/api/webhooks/stripe` (or the verified production custom domain). The existing Preview bypass remains test-only.
- Subscribe to `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `charge.refunded` and `charge.dispute.created`.
- Configure `ICASH_APP_ORIGIN` if using a custom app domain. Requests must match the deployment URL, branch URL, production URL or this explicit HTTPS origin; arbitrary Host headers are not trusted.
- Enable the desired database credit pack only after published operation prices, terms, account recovery/support and actual service delivery are ready.
- Complete refund/reversal reconciliation, webhook retry monitoring and volume testing. Phone verification and SMS consent are separate future steps.
- Only then set `ICASH_AUTH_EMAIL_READY=true`, `ICASH_LIVE_PAYMENTS_ENABLED=true` and `ICASH_LIVE_WORK_READY=true`. These flags are rollout gates, not proof that the live bot implementation exists.

## Verification completed

- TypeScript and Next.js production build.
- Existing policy suite plus funding mode isolation, validation, email normalization and origin checks.
- Transactional database fixtures (all rolled back): duplicate fulfillment/claim, correct live balance, wrong amount/mode/email rejection, unverified and unfunded account rejection, sandbox funds never reaching live wallets, billing hold and resume prevention, rate limits, and denied anon/authenticated table/function access.
- Supabase security advisor reports only intentional INFO entries for RLS-without-policies on service-only tables. See https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy .

## Money model

A dollar balance is a customer service balance, not a promise to pass through vendor cost. Customer action charges and provider actual costs remain separate. No operation prices or gross-margin claims have been invented in this payment work.
