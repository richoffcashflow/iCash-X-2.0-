# Outbound stall recovery and owner notification reset

The owner asked to prevent outbound stalls and reset the recurring critical
priority email. The fixes address observed shared causes and preserve actual
outcome evidence. They do not promise that a telephone outage is the only
possible interruption.

## Observed failures

At approximately 1:09 PM Central on November 13, the monitor reported 88 accounts
without recent completed work and 10 with pending work. All 88 stalled accounts
had contact export capacity `quota_wait`; 80 had contact candidates, five had due
discovery and three had neither. Shared request pacing was active with positive
remaining daily capacity. Reconciliation activity alone was not completed contact
research, a call, or a delivered message.

| Failure | Repair | Limits retained |
| --- | --- | --- |
| Quota-delayed contact jobs lose their original aging while the scheduler advances their next run. | Preserve the existing export-wait age for a definite `quota_wait`, as already done for `export_busy`. | Original candidate checks, bounded polling, provider request limits, final claims, Pause, money and unknown outcomes. |
| The same reviewed voice configuration adds `workflow.version: 1`, blocking maintenance and call recovery. | Retain the independently merged PR #721: reconstruct only the observed inert single-start representation and require the entire original approval fingerprint. | Different versions, executable workflow changes, prompts, tools, agent identity and every independent approval gate. No provider write or approval replacement. |
| A continuing incident sends unchanged hourly reminders despite the owner's request to reset them. | Record one fresh, exact private notification baseline and cancel only its not-yet-claimed detected notices. | New component outages/escalations, changed account impact, genuine recovery window, accepted/claimed/uncertain delivery receipts and all health records. |
| Owner emails mix raw UTC times, workflow flags and service failures. | Use 12-hour Central timestamps, explain monitor counts, include fresh quota status and describe automatic recovery accurately. | Severity thresholds, verified recipient, deterministic send key and original receipt-only retry behavior. |

The saved before/after voice snapshots differ only at `workflow.version`. PR #721
independently shipped this same correction; its stricter exact-shape comparison
and regression suites are retained unchanged, replacing the duplicate patch. The
comparison is deliberately narrow: one inert start node, empty edges/frames/
subgraphs, disabled subagent looping, version exactly 1 and no unknown workflow
keys. The full original hash is still the authority. Tests also exercise the
actual bounded voice-recovery service with the unchanged approval.

The preceding independent PR #720 supplies dual-channel selection for new seller
conversations and bounded recovery of never-admitted number holds. This change
builds on it without rotating established conversations or enabling a disabled
number. Unanswered calls, rejected contact evidence and unknown supplier outcomes
are not erased to change the monitor count.

## Notification reset semantics

The database-only operator function requires an active incident with a previously
accepted detected notice, an exact fresh
snapshot, a unique request key and the verified release SHA. It serializes with
the existing observer and claimer. Repeating the exact request is idempotent;
changing its identity is rejected. The audit records canceled pending notices.
Normal service, authenticated and anonymous roles cannot invoke the reset or
write its private RLS-protected history.
The first unconfirmed alert cannot be reset; accepted history is required so
future changed-impact reminders retain their original hourly scheduling basis.

The baseline includes current component health, issue summary/count, aggregate
account progress, the full account/reason/since set and research quota state.
Volatile observation timestamps and sampled account lists are excluded. A stale
snapshot cannot be acknowledged. A matching baseline suppresses only the hourly
reminder clause. A different affected account, changed impact or new outage can
still alert. Canceled notices are excluded from latest-notice selection so an
unsent canceled reminder cannot suppress future changed-impact notices.

Nothing marks an incident recovered, alters its severity, rewrites a provider
receipt, releases funds, restarts a customer Pause or retries a send. A real
15-minute observed recovery window remains necessary for recovery notification.

## Verification and rollout

Targeted regression tests reproduce the failures before applying the fixes.
PGlite exercises the captured production acquisition selector and incident
observer, including current funds, reservations, original unknown operations,
new outages, equal-count account changes and role restrictions. Native Postgres
tests run eight competing acquisition claims and sixteen idempotent reset calls,
then race reset against notification claim. Only localhost disposable databases
are used. No paid calls, texts, exports or emails are development tests.

Run the full test runner, local release checks, TypeScript and production build.
Require all six canonical Reliability jobs on the exact PR head. Install the two
CLI-created, separately reviewed migrations only after their exact prerequisite
definition checks pass; never push the whole migration directory. Verify the
exact main-push checks and production web, worker and independent monitor
deployments before executing the one requested notification reset.

After rollout, verify fresh ordinary maintenance/voice comparisons, retained
quota-wait ages and receipt-backed production activity. Record the exact release,
migration receipts and reset result in the PR. An active stalled-account count
remains unresolved until actual work changes it; provider quota waits and
original uncertain outcomes are not repaired by acknowledging an email.
