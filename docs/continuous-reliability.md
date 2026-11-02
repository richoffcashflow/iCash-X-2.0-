# Continuous reliability

Reliability means that supported work advances, waits for a real prerequisite, or reports a specific failure with a recovery path. A running worker and a passing build do not establish that customer work completes. No release can prove every possible scenario or guarantee zero bugs.

## Release contract

1. Read current main, relevant instructions, open changes and production evidence. Preserve newer fixes and user intent.
2. Map each affected journey from entry through persisted state, scheduler selection, provider admission, receipt, settlement and customer-visible outcome. Check both empty queues and mixed active features.
3. Reproduce each material failure with executable tests before fixing it. Keep tests for behavior and invariants, including failure/recovery paths. Do not replace real function bodies with successful stubs when testing that function.
4. Exercise concurrency on native PostgreSQL when locks, leases, uniqueness, generation counters or foreign keys matter. Local single-session PGlite tests complement this; they cannot establish lock behavior.
5. Run the existing exact-commit Reliability checks: every offline suite, production dependency audit, build, bounded concurrency, Chromium and WebKit browser checks, and native PostgreSQL contention tests. Required failures block production admission.
6. Apply compatible, guarded migrations with actual migration-history versions. Never replay provider operations, release unknown money holds or rewrite historical evidence as a recovery shortcut.
7. Verify the exact main-push check run and both production deployments. Observe ordinary scheduler/receipt progress and fresh integration diagnostics. Record remaining degraded conditions honestly.

## Scenario coverage map

These are existing executable coverage anchors, strengthened by this release. They are not a claim of live paid end-to-end execution.

| Journey | Coverage anchors | Required failure cases |
| --- | --- | --- |
| Signup, paid access and funding | `private-free-signup.test.mjs`, `workspace-subscription-lock.test.mjs`, `support-checkout.test.mjs`, `wallet-funded-prospecting.test.mjs` | Duplicate receipts, missing access, depleted credits, explicit Pause and tenant separation |
| Research and contact admission | `scheduler-reliability.test.mjs`, native owner-preflight and automatic-export tests | Empty inventory, unavailable provider, exact prior-operation evidence, Retry-After, concurrent claims and unknown purchase outcomes |
| Seller calls and texts | `recording-agent-comparison.test.mjs`, `required-call-recording.test.mjs`, `seller-text-offer.test.mjs`, native seller-progress test | Empty/mixed-feature scheduler, duplicate messages, delayed delivery, superseded replies, changed agent identity/configuration, interrupted calls and opt-out |
| Negotiation and agreements | `seller-text-offer.test.mjs`, `automatic-contract-preparation.test.mjs`, `standard-contract-signing.test.mjs`, `original-contracts.test.mjs` | Unsupported prices, missing confirmations, duplicated events, frozen agreement data and actual signer authority |
| Buyer disposition and title | `buyer-coordination-route.test.mjs`, `buyer-purchase-terms.test.mjs`, `title-inbound.test.mjs`, `title-update-service.test.mjs`, `deal-journey-service.test.mjs` | Cross-deal identity, private acquisition data, delayed counterparty responses, stale terms and completion without authoritative evidence |
| Recovery and operation | `worker-recovery.test.mjs`, `runtime-cost-efficiency.test.mjs`, `scripts/test-account-recovery-postgres.py`, browser/health suites | Shared SQL failures, busy-account fairness, foreign-key deadlocks, single claims, stale completion, durable wakeups and no duplicate paid action |

Use `pnpm test` to run every `tests/*.test.mjs`; follow `.github/workflows/reliability.yml` for native PostgreSQL and browser prerequisites. Native fixtures only target disposable localhost port 55443 and never accept a production connection string.

## November 2 incident ledger

| Failure observed | Root cause and change | Evidence required for closure |
| --- | --- | --- |
| Message/general scheduler repeatedly returns SQL 42702 | Buyer recovery used alias `j`, colliding with an existing PL/pgSQL row variable. `text-ai-scheduler-recovery.sql` changes only that alias in the installed issuer. Worker diagnostics recognize the safe SQLSTATE. | Reproduce old failure with the actual shared issuer even with no buyer rows; all four seller/buyer flag combinations and original delivery reconciliation pass; fresh production scheduler logs no longer show this error. |
| Receipt recovery deadlocks with ordinary dispatch (40P01) | Recovery held a followup row while the ticket FK waited for a dispatch-locked account. `account-recovery-parent-lock.sql` acquires a nonblocking parent key-share lock alongside the queue lock. | Native PostgreSQL reproduces the original deadlock; the fixed issuer selects another due account, preserves the skipped wakeup, admits one of 16 concurrent claims and rejects stale/cross-account completion. |
| Approved outgoing and incoming voice configurations reject the same provider version | November 2 read-only evidence shows disabled `user_memory` changed from `accept_unverified_identities: false` to the exact `identity_policy.rules=[{verification_method:'workspace_asserted'}]` representation. Compatibility applies only with memory disabled and the legacy field absent; every other field must still reproduce the saved full hash. | Synthetic incoming/outgoing regression cases reject enabled memory, extra rules/fields, malformed values and unrelated changes. Fresh deployment diagnostics must confirm the actual original approvals match. Private redacted evidence is useful for the diff but cannot itself reproduce the full hash. |

The initial read-only snapshot was degraded, including older unresolved receipt/export evidence. Do not acknowledge, delete or settle those records just to change the health result. A new outage-free observation window does not prove historical customer work succeeded. Paid calls, texts, data purchases and signature submissions are not authorized development tests by this release request.
