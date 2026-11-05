# Configuration recovery capacity scans

On November 5, after PR #586 restored the approved outgoing voice configuration,
ordinary calls obtained carrier IDs and started AI conversations across accounts.
The configuration recovery maintenance still timed out while holding the shared
admission lock. Its candidate filter and each selected job's queue check repeatedly
rebuilt the same global voice holds. One read-only production EXPLAIN measured
127.75 ms, 37,322 shared-buffer hits and about 5,800 original-operation probes for
one holds scan; repeating it throughout a recovery batch delays other admissions.

`config/voice-recovery-capacity-snapshot.sql` captures the existing private capacity
snapshot once, after the unchanged global admission lock and provider/template
checks. Both recovery selection and its queue check use the existing private
snapshot helpers. There is no new cache table, lifetime beyond this invocation,
worker concurrency change or provider limit change. The 20-job limit, account
ordering, exact original ticket/source binding, fresh screening, membership,
funds, recipient hours, customer Pause, same-batch recipient exclusion and
immutable recovery audit remain unchanged. Making a job ready does not start a
call or consume a paid operation.

Final dispatch, call recording and provider admission retain their existing fresh
capacity checks. The patch does not alter public capacity functions, original
unknown calls, quarantine rules, tickets, operation reservations or wallet data.
Six exact function-definition guards fail closed if the reviewed recovery or its
capacity helpers have changed; function identity, privileges and security mode
are preserved. No historical call replay or paid development test is performed.

Validation uses the current saved production recovery and capacity helpers over
the existing disposable source UNION fixture. It compares complete recovered
state, immutable audit, original tickets and money evidence; counts actual holds
scans; covers blocked recipient/capacity cases, occupied incoming slots,
quarantine with a late carrier identity and fresh final admission. The native
PostgreSQL suite additionally exercises 24 competing recovery transactions,
cross-source duplicate recipients, committed Pause, SKIP LOCKED and an occupied
recipient committed while the original admission lock is held. Its invocation is
part of the canonical Reliability workflow. No production mutation is required
for any test.

Deploy only after exact-candidate canonical checks pass. Install the byte-identical
function-only migration through the production migration ledger, verify its body
and unchanged helper hashes/ACL, then observe ordinary recovery and outreach.
Completed configuration recovery is a queue result; carrier call IDs and actual AI
start receipts remain the evidence for calling. Provider text acceptance remains
separate from confirmed delivery.
