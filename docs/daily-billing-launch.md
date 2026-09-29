# Daily billing

Implemented: $10–$1,000 configurable daily budgets, explicit recurring consent, Stripe daily subscription Checkout, no separate processing fee or tax, invoice/payment verification, exactly-once credit grants, guest checkout followed by verified email claim, budget changes on the next renewal, and Stop cancellation with a durable retry queue. A failed renewal cancels the subscription and pauses work. Already-paid unused credits remain.

The displayed budget is the customer's service allowance, not raw vendor costs. Database minimum margin is 8334 basis points (roughly 6× buffered all-in cost). $300 consumed permits at most about $49.98 in buffered costs under this guard. This is a spending policy, not a guarantee of realized profit.

## Gates still required before charging

- Live acquisition must actually work; existing work-readiness/payment gates remain off.
- Enable intended credit packs only after operation rates and service capacity are ready.
- Configure CRON_SECRET in Vercel (never commit its value). The protected reconciliation job runs every five minutes, 100 plans per batch, oldest reconciliation first.
- Stripe webhook must send checkout.session.completed, checkout.session.async_payment_succeeded, invoice.paid, invoice.payment_failed, invoice.payment_action_required, customer.subscription.updated, customer.subscription.deleted, charge.refunded, charge.dispute.created to the existing signed webhook endpoint.
- Verify a daily subscription renewal, next-renewal budget change, cancellation, and email claim in Stripe test mode before setting ICASH_DAILY_BILLING_READY=true. No real cards or voice minutes are required for these tests.
- Review business tax obligations separately. Checkout adds no tax; that does not determine tax liability.

## Verified without external charges

Type checking, production build, mocked Stripe stop/retry/payment validation tests, rolled-back database invoice idempotency and stop-race checks. These do not replace an end-to-end Stripe sandbox renewal.

Budget changes deliberately use no prorations and take effect at the next billing renewal. The UI explicitly states this; it does not promise an immediate budget upgrade.

## Recovery

Never mark a plan stopped until Stripe cancellation and unpaid-invoice cleanup succeed. Stop requests persist before provider calls. Cron retries stop_requested plans. A payment already in progress may complete; verified paid invoices still grant the corresponding credits without resuming a stopped bot. Payment failures and billing disputes pause operations.
