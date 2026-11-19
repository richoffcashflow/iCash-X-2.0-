# Failed renewal and recharge recovery

The November 19 owner request authorizes shipping stronger failed-payment recovery. The former recharge worker disabled a customer's saved auto recharge after the first decline. The new worker records the original terminal PaymentIntent before scheduling another attempt. Temporary issuer/processing/insufficient-funds failures may retry after 1, 1, 2 and 3 additional days, for five total failed attempts. Each new attempt still requires the original approved amount/card, the existing once-per-24-hour limit, active membership, a balance below $5, no Pause, no financial review and no conflicting daily plan. Unknown/hard declines and authentication requests require a customer payment update. No old disabled approval is automatically re-enabled.

Membership and private VIP renewal failures are registered from fresh Stripe invoice/subscription reads in signed webhooks and regular reconciliation. Stripe continues to own invoice retries; the application never calls `invoice.pay` or starts another subscription. Open, eligible renewal invoices receive a hosted invoice link. Recharge notices use Add money and require a fresh paid opt-in to change the saved card/approval. Original customer/amount/source bindings are checked before dispatch.

Email reminders are due at days 0, 3, 7 and 13 from the failure/invoice. One SMS is eligible after day 1 with the customer's existing SMS consent, current ownership, local 09:00–19:59 window, global phone suppressions, shared lifecycle frequency lock and sender capacity. Delayed jobs send only the latest due email step. Each channel is capped at one recovery notice per recipient per rolling day, with 250 total recovery notices/day. Messages stop on verified success, cancellation, a review hold, manual recharge off, changed approval, new funding or the 14-day boundary. Email bounce/complaint/suppression receipts stop subsequent recovery emails to that address. Accepted delivery is recorded separately from verified financial recovery.

The maintenance lane claims four cases with leases. Email retries reuse the immutable payload and Resend idempotency key within 23 hours; uncertain SMS is never automatically replayed. Preview deployments cannot send. Tests use only fictional accounts and mocked providers.

## Rollout

1. Run the focused recovery suites, TypeScript, existing affected route suites and canonical Reliability checks. The PostgreSQL concurrency job also runs the recovery suite with `ICASH_PAYMENT_RECOVERY_NATIVE=1` against its own disposable local database.
2. Apply `supabase/migrations/20261119220000_failed_payment_recovery.sql` using the migration runner. Its source-pinned patches and history entry must share the runner transaction. It installs disabled and is compatible with the old application. Verify the installed functions, RLS/permissions and disabled setting before merge.
3. Release through the normal exact-head PR and exact-main production gate. Confirm the Git-triggered Vercel production SHA, READY state and live aliases. No worker runtime/configuration change is required: the existing maintenance scheduler invokes the web route.
4. Enable `icash_payment_recovery_settings.enabled` only after that application is verified live and its existing Resend/Contiguity configuration is present. Observe actual maintenance results and original delivery records; never send paid development demonstrations or test charges.
5. Separately configure Stripe Billing's native Smart Retries for up to eight attempts over two weeks in the connected live account. The connector does not expose this Dashboard setting; a signed-in Dashboard session is required. Do not claim the setting changed without reading it back. Do not reactivate canceled subscriptions or alter prices.

Existing eligible, open renewal invoices are found by normal reconciliation. Historical disabled recharges remain disabled; no retrospective blast or reenrollment is part of this deployment. Their customers can resume through the existing paid Add money/auto-recharge consent flow.

## Stop and verify

Set `icash_payment_recovery_settings.enabled=false` to stop recovery messaging claims and further retry attempts. Preserve all original attempts, receipts, consent and payment records. Successful original payments still settle exactly once. Inspect cases grouped by kind/state, delivery outcomes, and matched `recovered_cents`; attempted invoice amounts are not recovered revenue. A rollback requires checking the additive migration compatibility and the exact restored production deployment.

Local commands: `node --experimental-strip-types tests/payment-recovery.test.mjs`, `node --experimental-strip-types tests/payment-recovery-database.test.mjs`, and `pnpm exec tsc --noEmit --incremental false`.
