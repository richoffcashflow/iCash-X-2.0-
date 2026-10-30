# VIP upgrades during a verified legacy trial

The original VIP service treated every Stripe status other than `active` as a
pending subscription change. Verified legacy introductory memberships instead
have Stripe status `trialing`, while the application correctly grants Standard
access through the saved trial end.

## Safety and billing contract

- Admit only already-activated, version-bound legacy trials whose original
  zero-dollar offer, consent, Stripe metadata and saved access/trial end match.
  Ordinary unverified trials remain blocked.
- Preserve the existing customer-accepted $50 one-time VIP checkout and exact
  successful-payment verification. Creating checkout never grants VIP.
- Replace the monthly price only after payment, with no proration; do not set
  `trial_end` or reset the billing anchor. Revalidate the returned customer,
  subscription, status, original trial dates and billing anchor before applying
  local VIP access. Renewal remains $100 on the original trial-end date.
- Keep real pending updates, schedules, cancellation, failed subscriptions and
  renewal-race holds. Preserve existing checkout/price/update idempotency keys.
  A paid change that cannot safely reconcile stays held, not payable again.
- Permit paid VIP customers to downgrade/restore the next renewal without a
  second upgrade charge. Do not broaden the free VIP retention offer to trials.
- Replays of the original verified $0 checkout/invoice cannot reactivate access,
  reset the trial or overwrite the paid VIP price.
- Trial-ending reminders quote the verified current $50/$100 renewal. The $100
  database claim additionally requires an applied paid VIP upgrade. Original
  reminder payloads and uncertain delivery receipts remain immutable; a changed
  price never causes the old quote to be resent.

## Release boundary

Prepared locally only. No customer account, Stripe resource, production database,
email, payment, merge or deployment was changed while developing this fix.

An authorized release needs the additive migration
`20261030195000_vip_trial_renewal_reminders.sql` and matching application code.
The migration replaces only the existing reminder claim implementation, retaining
its signature, privileges, RLS, receipt schema and delivery idempotency. Do not
publish application support for $100 reminders against the old $50-only claim.
No data backfill, subscription correction, paid test or checkout retry is required.

Use the offline `vip-billing`, `legacy-trial-billing`, `legacy-trial-reminder` and
`legacy-trial-reminder-webhook` suites; run the aggregate suite and TypeScript
check before release. The build command in package.json invokes provider setup
and preflights, so local verification uses direct `next build`, not those hooks.
No tax configuration is changed: the existing fixed-price checkout tax contract
is preserved; any later tax setup needs separate registration/configuration review.

Stripe references: https://docs.stripe.com/billing/subscriptions/change-price and
https://docs.stripe.com/api/subscriptions/update (same-interval changes, unchanged
billing dates, and `proration_behavior: none`).
