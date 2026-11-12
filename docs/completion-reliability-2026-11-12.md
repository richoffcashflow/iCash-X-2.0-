# Completion reliability

The November 12 audit found shared export stalls, repeated request overhead, aged original receipts, sender delays that silently expired, an undersized learning refresh batch, and misleading missing-cost flags. The owner requested shipping the fixes. Preserve the existing interface and all customer controls.

This release makes the following changes:

- After the original inventory receipt is saved, independently admit and read the pending and processing export views together. Every view still consumes its own shared quota admission, keeps the original starter beneficiary, and must pass final source, freshness, pagination and idle checks. Reads have 25-second deadlines, the total transport deadline is 55 seconds, receipt age is capped at 30 seconds and the entire review at 60 seconds. A missing or conflicting receipt holds capacity. There is no export retry or financial release.
- Keep an authenticated, original-dispatch-bound sender delay effective until a send dispatched after that delay is delivered. After the first five minutes, at most one ordinary eligible introduction per sender per five minutes can probe recovery. Existing thread identity, suppression, number limits and final admission remain authoritative. No synthetic message is sent.
- Keep the learning scheduler at 15 seconds, using the existing two-account batch normally and a five-account batch when more than 20 accounts are due or any account is overdue by five minutes. Existing account locks, generation checks, 12-second statement timeout and per-account error isolation remain unchanged. The previous maximum was 480 refreshes/hour for 626 hourly accounts; catch-up raises the configured ceiling to 1,200, not a throughput guarantee.
- Record a private hourly review of original reserved/dispatched operations older than 24 hours. Preserve aggregate provider/account counts, oldest timestamps and held charge caps in immutable review events. A deadline requires reconciliation of the original receipt; it never implies a failed purchase, permits a replay, or releases money.
- Recognize a zero-cost pre-dial abort only when the immutable abort, account, job, original dispatch, settlement and absent provider artifacts all agree. Report it separately as `verifiedNoDispatchCount`; do not manufacture cost manifests or classify arbitrary zero-dollar settlements as verified. Contradictory late evidence restores the missing-evidence classification.

## Release and verification

`config/completion-reliability.sql` and its matching migration are identical. Apply once through the migration tool after reviewing the exact function predecessors and passing the release checks. It is compatible with the previous sequential transport, so it may be installed before the runtime deploy. Do not reinstall to bypass a predecessor mismatch. Keep the existing request-pacing activation time and all quota counters unchanged.

Run the focused completion, owner-cost, starter-export and transport regressions; native starter-export, sender and learning contention tests; TypeScript and the release checks. The canonical PR checks and exact-main checks must pass. Verify the Vercel production aliases and both affected Railway processes on the intended commit. Then confirm the new SQL definitions, learning cron command, actual completed refresh batches, deadline review evidence, cost classifications and production work receipts.

The pre-existing transport hardening is PR #691. The separate independent reliability monitor and fresh-cutover deal supervisor were already deployed. Do not report these as missing or treat deployment/queue activity as a completed customer outcome.

## Remaining evidence dependencies

| Audit item | Software coverage | Evidence still required |
| --- | --- | --- |
| Shared export blockage | Three-read capacity recovery, independent status probes, source-bound original recovery | Successful provider responses; ambiguous original exports keep their owner/money fences |
| Request efficiency | Existing saved-preflight continuation and staged daily pacing; less serial recovery time | Observe the next normal quota window; no counter reset or earlier pacing cutover |
| Aged receipts | Existing fair original-ID recovery plus durable 24-hour review | Canonical missing receipts or an explicitly reviewed per-operation resolution |
| SMS reliability | Persistent sender health and existing eligible-number selection | A separately validated second SMS provider, supported sender identities, delivery receipts and cost/consent configuration; voice-provider credentials alone do not establish SMS readiness |
| End-to-end deals | Existing source-bound seller/signing/buyer/title supervisor; offline scenario coverage | Actual seller/customer signatures, buyer acceptance, title completion and proceeds |
| Outcome learning | Bounded backlog catch-up and existing source-verified label collection | Enough mature positive labels and qualifying validation; never lower qualification to force an active model |
| Actual economics | Canonical manifests, verified/estimated separation and exact no-dispatch classification | Supplier invoices and reconciled actual costs; a code release cannot convert estimates into invoice evidence |

The audit found that the ten zero-cost rows without manifests in the rolling seven-day window were original `voice-predial-abort-v1` settlements. Their reporting classification is addressed here. This is separate from invoice reconciliation and from unresolved charged/unknown operations. Check live evidence after deployment rather than carrying snapshot counts forward as current facts.

Rollback must preserve all original evidence. Disable export-capacity automation if its verification fails; do not clear reviews or unknown purchases. Return the learning cron command to the former two-account function if its bounded catch-up causes database pressure. Retain persistent sender recovery and receipt/money fences. Any runtime rollback uses the normal exact-release checks.
