# Workflow stall isolation

The November 9 owner request is to recover stalled work automatically while
unrelated accounts and workflows continue efficiently. Production read-only
evidence showed repeated `57014` scheduler timeouts in `warm_seller_due` through
global voice capacity and in the text operating-hours helper through conversation
history. Dedicated research, voice, message and recovery dispatch is already
enabled; a slow general selector still holds their shared admission lock.

The warm-work predicate previously evaluated global call capacity even for an
account without a due callback. An empty-account production read took 169 ms and
73,226 shared buffer hits. It now finishes the original text predicate first,
then requires an otherwise eligible callback before inspecting global capacity.
The daytime SMS predicate now checks the existing operating window before
evaluating the historical-conversation exception. Overnight work retains the
same original exception. These are short-circuit boundaries, not cached or
weakened admission decisions.

Both helpers retain their source/account checks, customer controls, suppressions,
hours, original-call exclusions, signatures, volatility, privileges and final
call/text gates. No job, provider request, wallet, receipt or existing hold is
changed. Existing scheduler retries remain bounded with backoff; uncertainty is
reconciled against original provider evidence rather than replayed.

The owner panel now explains whether background services are failing or individual
workflows need recovery. It keeps stalled-account counts separate from accounts
awaiting earlier work. Severity thresholds and unresolved alerts are retained.

## Verification and rollout

`workflow-stall-isolation.test.mjs` executes both production predecessors and the
guarded migration with synthetic data. It covers skipped scans, callback/text
equivalence, Pause, suppression, stale sources, unknown calls, operating windows,
account boundaries, private privileges and atomic prerequisite rejection.
`test-workflow-stall-postgres.py` reproduces both predecessor failures with locked
dependencies and verifies concurrent generic/custom-plan reads can finish after
the repair. Real callbacks still require capacity; overnight texts still require
their original conversation evidence. No paid test actions are used.

The single migration verifies both exact deployed function hashes before either
change and needs no new index or activation switch. Apply only this reviewed
migration, verify the migration ledger and function readback, and release the
tested main commit through normal Reliability checks. Do not apply unrelated
staged migrations. Verify ordinary production completions and scheduler errors
afterward; a helper benchmark is not proof every account has recovered.

Rollback restores only the two definitions in
`tests/fixtures/workflow-stall-before.json`. It never resets jobs, retries paid
operations or changes financial evidence.
