# Funded account progress and provider waits

The November 3 follow-up starts from production PRs #538 and #539, and preserves
the independently prepared #540 empty-preview credit-shape repair. Scheduler
statement timeouts were absent from the bounded 05:00–05:41 UTC log window;
the investigation does not rebuild that optimization or infer progress from a
healthy worker heartbeat.

The initial account snapshot at 05:43:25 UTC had 21 `no_completed_work` and 60
`pending_work` observations. These monitor reasons are mutually exclusive, but
their underlying pending operations overlap: a stalled account can still have
older reserved or dispatched work. Positive wallet balance alone is not enough
to establish available spend authority. Customer Pause, membership, contact
hours, current source evidence and uncertain provider costs remain separate.

The financial baseline at 05:43:57 UTC was $53.81 net settled customer usage
across 50 accounts in the preceding hour: $54.53 gross usage postings less $0.72
of coverage/correction credits. A separate $10 credit top-up is not usage.
There were 394 positive-cost or positive-charge settled operations. Contacts
were saved by 91 tickets across 43 accounts and property screening was queued
by 47 tickets across 35 accounts. These are research results, not qualified
seller conversations or closed deals. Rolling-window changes and concurrent
deployments are not controlled evidence of this patch's effect.

## Confirmed failure paths

- A free list-create response can carry the original list identity but report
  `idle` and zero people. The current recorder immediately holds it and the
  handler deletes it. Delayed baseline indexing can likewise produce zero even
  though the original requested owner IDs are nonempty. These are not evidence
  that a paid owner export was made or that all owners have no eligible phone.
- Local quota admission can refuse a request after a preflight is claimed.
  The old handler records a missing-provider-response hold even though the
  durable request ledger proves that no transport was admitted. A missing list
  then prevents normal cleanup-based renewal. This is distinct from the one
  historical null response whose request was admitted and timed out.
- Active-owner exceptions reach the automation route without the legacy
  enrichment logger and are recorded as `unclassified`. Exact allowlisted
  operator diagnostics preserve the original held outcome and never authorize
  retries.
- The customer opportunity panel receives a verified `settling` status but
  displays generic search copy. A plain waiting explanation uses that existing
  status, preserves Run/Pause and completed metrics, and does not ask customers
  to add money or repair a provider issue.

## Financial and delivery boundaries

HTTP 500/504 exports without a terminal correlated cost receipt keep their
original purchase, recipient and money holds. Organization-capacity recovery
is independent of settlement and is already implemented. Do not replay those
exports, infer zero charges from an empty inventory read, or confuse free
preflight failures with unknown paid purchases. The snapshot also contained
older call, browser-call and property-search receipts needing reconciliation.

The fixes do not raise provider limits, alter customer prices or budgets,
purchase test data, send development calls/texts, renew recipient consent,
unpause accounts, or rewrite historical evidence. New retries need exact
original non-admission or bounded free-read evidence and current eligibility.

## Release verification

Reproduce the observed response and local-denial paths with actual service and
database fixtures. Verify competing workers, late receipts, customer Pause,
expired source checks, reserved balances, large due backlogs, finite attempts
and progress by unrelated eligible accounts. Native PostgreSQL checks must run
in the existing isolated Reliability workflow; a single-connection simulator is
not native contention evidence.

Require the exact PR and main Reliability checks, compatible migration
readback, matching production web/worker commits and ordinary completed work.
Compare the saved before cohort with fresh account, receipt and ledger data.
Report code, deployment, resumed accounts and remaining provider blockers
separately. No claim of complete recovery follows from CI or process health.
