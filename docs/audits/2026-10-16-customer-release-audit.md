# iCash X customer release audit — October 16, 2026

## Release decision

**Conditional approval for a supervised customer launch. This is not approval for an unattended, unlimited-volume launch.** Publish the repairs below only after the exact commit passes the full Reliability checks workflow and the production deployment is healthy. The release's pull request and workflow runs are the final deployment record.

This review starts from production commit `1246f297f9d648c3e0cc9b62856651b207f5910c` (PR #285). It extends the [software and webinar audit](2026-10-16-software-webinar-audit.md) with fresh-customer provisioning, canonical payment-event recovery, current Stripe account restrictions, configuration expiry, and a production dependency-advisory gate. The earlier inventory covers 37 pages and 205 route handlers. That inventory is structural evidence, not a claim that every possible customer/button state was exercised.

## Findings repaired

| Finding | Customer impact | Repair and evidence |
| --- | --- | --- |
| Paid funding deliberately survives a failed provisioning trigger, but nationwide customers had no account-load retry. The existing retry ran only through a requested ZIP. | A customer could pay for credits and remain without property-search or voice configuration. | Authenticated, acknowledged, funded live accounts retry the existing idempotent provisioning RPC once when a configuration is missing, then reread readiness. Failed recovery preserves the wallet and truthful held state. Existing disabled/expired voice configuration, Pause, membership and billing holds remain intact. The new regression failed before the patch and passes afterward. |
| The live Stripe endpoint delivers API version `2020-08-27`, while failed-invoice handling expected the newer invoice `parent` shape. | A failed payment or required payment action could be acknowledged without updating its membership until reconciliation or another subscription event arrived. | Retrieve the canonical invoice through the current SDK, then synchronize the current subscription. Legacy/current event fixtures, changed canonical subscription, retry after transport failure, signatures and live/test separation pass. The regression failed before the patch. |
| The live iCash webhook did not subscribe to `payment_intent.succeeded`. | Successful auto-recharge recovery depended on the reconciliation job alone. | Added this one event to the existing enabled endpoint and independently read it back. Existing events, URL, endpoint API version, unrelated endpoints and payment settings were preserved. The explicit configuration script now retains this subscription. No payment was created, confirmed, replayed or charged. |
| The release workflow did not check current production dependency advisories. | A passing behavior suite could release a dependency with a newly reported high/critical vulnerability. | Added `pnpm audit --prod --audit-level=high` as a required workflow job. Registry failures fail the job rather than being treated as a clean result. The local registry query was unavailable (`fetch failed`), so its result must come from CI. |

The provisioning retry does not call a paid provider, grant credits, create consent, change spending activation, or start/unpause work. Production SQL definitions were inspected: existing configurations are preserved and new configuration requires confirmed credited live funding plus current approved templates/rates. An isolated PGlite execution of the funded-voice SQL scenarios passed, including idempotency, funding/rate/template gates, manual holds, and rollback. This is not a full production database clone.

## Customer journey coverage

All **418 local test suites passed** with provider credentials removed. The production build passed, including TypeScript and route generation. The release workflow additionally requires the production build, desktop Chromium/mobile WebKit journeys, bounded concurrency, and the current production dependency audit.

| Journey | Evidence and boundaries |
| --- | --- |
| Webinar → Standard payment → verified access | Day/night timing, saved offers, returning-viewer rules, skippable contact capture, completion retry, verified purchase routing, signed webhook and canonical checkout/invoice/payment binding. Pending/expired payments do not grant access. |
| New customer → account → funded work | Confirmed-email claim, account creation and tenant binding, required explicit workspace acknowledgment, membership/credit/billing gates, funded setup and missing-configuration recovery. The fast account snapshot does not wait for provisioning. |
| VIP upgrade and repeat visits | Verified paid entitlement, correct post-purchase destination, upgrade review without premature access, retained/downgraded/cancelled membership behavior, VIP question and voice controls. |
| Course and practice workspace | Private paid course assets, owner-only uploads, video/PDF/practice links, customer absence of upload controls, fictional practice without real payment/signing/communications. Both production course assets were already uploaded and verified in the preceding audit. |
| Leads and communications | Immediate consented seller/demo request admission, account/phone/source binding, opt-out and credit checks, browser call controls, audio visibility and protected recordings, address pronunciation, no outbound buyer AI calls. Actual carrier delivery was not purchased for this audit. |
| Agreements and closing | Draft/edit/save, signature-request gates, delivery and cancellation recovery, immutable signed history, buyer visits, deposits, title tasks and payout-readiness holds. External signatures, escrow funds, title performance and legal enforceability are not certified by fixture tests. |
| Support and cancellation | Tenant isolation, bounded requests, saved-draft recovery, interrupted reply recovery, explicit cancellation confirmation, durable pending cancellation and retries. Escalations still require an operator. |
| Payment failure and recovery | Canonical invoice/subscription reads, duplicate/out-of-order state protection, mismatched amounts/customer/mode rejection, refund/dispute holds, cancelled-state preservation, saved auto-recharge attempt recovery. No live paid test was run. |
| Concurrent work | 12 concurrent fixture requests across two accounts: zero duplicate sends, duplicate charges or tenant mismatches; two ambiguous outcomes remained held. PGlite uses one database connection; this is not a production capacity or multi-connection contention benchmark. |

The existing browser suite is rerun for this release in CI. It covers actual navigation/Back/Close behavior, webinar recovery, workspace controls, permission-denied data clearing, request failures, course upload bytes, video and PDF behavior. APIs and providers are intercepted; this does not assert a new real customer purchase or delivery.

## Live configuration observations

- Stripe live charges and payouts are enabled. There are no currently due, past due or pending-verification account requirements, and no account disabled reason.
- The iCash Stripe webhook is enabled at the canonical production URL. Failed-invoice, subscription, checkout, refund, dispute and successful auto-recharge events are subscribed.
- The shared production voice template is enabled, has current standing approval, and has valid full-duration seller/buyer rates. Fifteen default research markets are eligible. Buyer-rate validity does not authorize outbound buyer calls.
- Current property-search, owner-enrichment and buyer-discovery pricing reviews expire **October 29, 2026 at 9:41 AM America/Chicago (2:41 PM UTC)**. Their expiration was not extended without a supported provider/rate review.
- At the initial release check, database/authentication/workflows were healthy, worker and maintenance heartbeats were fresh, and there were no open workflow incidents. Final health and deployment status must be checked after publishing.
- The owner is currently the only live workspace account. It has an allowed membership, is unpaused, and has **$0 available credits**. It cannot begin new paid work until funded. No balance, spending authority, account pause, or membership was changed to manufacture a passing result.
- Existing paid funding and membership records provide historical production evidence. They do not replace a fresh customer acceptance test. Pending checkout rows were not treated as sales or deleted during this audit.

## Remaining launch responsibilities

1. **Perform a bounded real customer acceptance test before a broad rollout.** A new paid customer should be observed through payment, email verification, acknowledgment, credit funding, first eligible work, recorded call, agreement delivery and course access. Current repository instructions prohibit paid development simulations without fresh approval of a concrete spending limit and an enforced cap. This audit therefore used isolated fixtures and read-only provider checks.
2. **Review the property-data rates before October 29.** The current runtime stops work whose pricing/rights evidence expires. The standing calling and contract-messaging approvals do not automatically extend property-data reviews. Existing workflow incident monitoring is not a dedicated advance reminder for this deadline.
3. **Keep an operator for escalations.** Uncertain provider attempts, disputes, support exceptions and title/seller/buyer issues can require review. Automation intentionally preserves holds when the outcome is unconfirmed. Routine monitoring reduces manual checking; it cannot promise that nobody ever needs to intervene.
4. **Increase traffic gradually.** Local concurrency and browser fixtures do not prove high-volume provider quotas, live carrier latency, external signing capacity or a particular daily ROAS.

No independent penetration test or new paid end-to-end provider cycle was performed. No unresolved test was labeled passed. The complete technical verification record is the release workflow on the exact production commit; healthy infrastructure alone is not proof of every customer outcome.
