# Customer self-service support

Local implementation on the published `b0f80322edc583d65adcfb05b6e7e0d9d9b5bd39` baseline. This extends the existing support conversation and cancellation system. No new schema, provider activation, payment/refund execution, or deployment is required by this patch.

## Customer flow

- `/support` and the existing support dialog show a read-only account snapshot before the customer writes a message
- Bot pause, available/held live credit, daily renewal state, and recent funding records explain what is actually recorded
- Service/property/call checks stay under a separate disclosure. Missing, malformed, or unavailable evidence is marked unverified
- Deterministic next steps open the existing workspace, refresh checks, prepare a support question, or open the existing cancellation review. No AI output can supply links or execute an action
- Check-specific help prepares a draft for the customer to review and send. Sending records fresh diagnostics using the existing message RPC; the customer can then escalate that conversation and its saved checks. The existing operator view also refreshes current diagnostics
- An unsent draft is preserved. Failed message requests retain their original request UUID and original thread binding, including when refresh discovers a newly created thread
- Cancellation uses the existing account/user/mode-bound nonce endpoint, an initially unchecked acknowledgement, and an explicit confirmation. A 202 partial provider outcome is shown as unconfirmed. Cancellation history is labeled historical rather than a claim about current settings

## Evidence boundaries

Payment summaries are bounded to 20 most recent funding records, filtered by authenticated account and configured live/test mode. Base price and credit allocation are not presented as a full bank statement, tax-inclusive total, refund history, or current bank balance. Test payments never become live credit. Missing account records do not prove that a bank was not charged. No payment status endpoint that might settle a receipt is called by these diagnostics.

The bot pause flag cannot establish why a bot was paused. The UI says so and separately displays the other available checks. Funding never promises to clear a service-readiness blocker. Unknown billing mode stops both billing and payment reads.

Authentication is still resolved through `workAccount`; the client cannot choose an account. All new reads use explicit field projections and tenant filters. The customer API response remains private/no-store. Unauthentication clears prior messages, evidence, draft, and pending cancellation confirmation. Failed refreshes remove the formerly current snapshot while retaining explicitly historical conversation messages.

## Local verification

- `npm test`: all automatically discovered suites, including `support-self-service.test.mjs` and `support-self-service-ui.test.mjs`
- `node node_modules/typescript/bin/tsc --noEmit --incremental false`
- `CIRCLE_NODE_TOTAL=2 NODE_OPTIONS=--max-old-space-size=640 node node_modules/next/dist/bin/next build --webpack` for a single-worker build in this resource-constrained environment
- `git diff --check`

The UI handler tests exercise read-only initial load, fixed actions, draft preservation, lost-first-response recovery, duplicate clicks, escalation context, confirmation acknowledgement, cancellation dismissal/expiry/partial success, stale snapshot clearing, and authentication recovery. Diagnostics tests cover tenant/mode isolation, missing/malformed data, paused/no-credit state, pending/paid/uncredited receipts and provider-readiness holds. Existing cancellation tests cover nonce replay/races, account/user/mode mismatch, and provider failure.

These are mocked/local checks. They do not confirm the state of a live customer's billing, providers, database migration, or account. Browser visual QA and production smoke tests remain separate release checks.
