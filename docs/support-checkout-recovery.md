# Account-aware support and returning-offer recovery

An ordinary $50 checkout left open could block the returning-customer offer. Support had the visitor's email but only checked paid receipt email, so it missed the reservation and replied with unrelated sign-in-code steps.

The offer now recovers an owned ordinary checkout before beginning a trial. Ownership requires its original browser cookie or a verified email session. The exact Stripe session must have matching membership metadata, mode and environment. A completed session is reconciled and reused. Only a canonically expired session with no subscription or payment can release a pending reservation. An atomic database recheck preserves concurrent payment/review holds and records the expiry receipt alongside the original consent. Missing or uncertain results remain held. Existing subscriptions and the once-only trial guard remain unchanged.

Email verification is available to pending ordinary checkouts and does not grant access. Failed offer requests reveal the existing verification form, and the customer still explicitly accepts the offer and continues checkout. Customer prices and the two-calendar-month term are unchanged.

Both support paths preserve a failed-offer conversation through follow-ups and avoid reasking the attached identity. Guest lookup details stay private. Operators see pending checkout, trial, subscription, receipt and account-link findings; guest replies reveal none of those records. A free trial is described as free access, not a paid invoice. New subjects and actual resolution still end the prior issue.

## Verification and rollout

Run the new `support-checkout`, `support-checkout-database`, `legacy-checkout-recovery` and existing `legacy-trial-route` suites, the full test suite, TypeScript and the browser regression. All provider outcomes are fixtures; no live purchases, OTPs or customer contacts are test traffic.

Apply `20261030195801_support_checkout_recovery.sql` before deploying its matching route. The migration is additive and guarded against unexpected existing function definitions. Existing application versions remain compatible. Verify the main-commit reliability checks and production deployment before asking the affected customer to retry the original offer.

Rollback application code if necessary, retaining the audit table, original consent and canonical receipts. Do not undo an expired provider session, reactivate a released reservation or remove a payment/review hold. Ordinary subscription cancellation stays on its existing confirmation path.
