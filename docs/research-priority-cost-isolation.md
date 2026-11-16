# Research priority cost isolation

November 16 production timeout context placed an acquisition selector inside
`icash_daily_work_target`. The selector only reads `priorityRatio`, but that
function also totals every pending operation and evaluates its planning relief.
These other report fields do not affect the rank. Because selection holds the
shared dispatcher and operating-budget locks, unnecessary reporting can delay
other accounts and independent recovery.

The private scalar `icash_work_private.daily_work_priority(uuid)` preserves the
same latest funding baseline, 50% target, settled 24-hour charge total, exact
duplicate-discovery coverage subtraction, numeric division and upper bound.
No budget still returns NULL, and the selector retains its original fallback
of one. The time predicate remains exactly the original strict lower boundary;
this repair does not change the treatment of future-dated historical evidence.
Only the selector's priority expression changes. Its candidate predicates,
continuation turns, overdue-account aging, five-candidate limit, account locks
and final financial/contact admission remain byte-identical.

The full customer target report and pending-planning function are unchanged.
No pending operation is settled, excluded from financial admission, released or
replayed. This does not change price, provider limits, wallet balances, customer
controls, outreach windows or the UI.

## Verification

The PGlite regression executes the captured production target and selector. It
checks exact numeric equality for missing/zero/odd/large baselines, new funding,
covered cost, old/current/future settlements and reserved/dispatched originals.
It exercises actual account ranking and continuation fairness, preserves money
and final control predicates, rejects predecessor/ACL/policy drift and verifies
that an outer migration-ledger failure rolls back the function and all manifests.

The native PostgreSQL test introduces a controlled slow boundary in the pending
report of an account that will not win the rank. The original selector times out
while blocking independent recovery. The repaired selector chooses the same
lowest-spend account under the unchanged timeout while that unrelated reporting
boundary is blocked. It retains the selected account's lock and original money.
The full selector and target are actual SQL; unrelated preparation/admission
services use the existing synthetic fixture boundaries. This is a dependency
and locking reproduction, not proof of production latency or customer recovery.

The first canonical run passed all 1,001 suites but its all-tests job was
cancelled at the twenty-minute job boundary during final cleanup. The full-job
budget is now thirty minutes, and the production verification wait is thirty-five
minutes to cover that budget and workflow startup. Every suite retains its
sixty-second deadline. A simulated-clock regression reproduces the former
premature release timeout, verifies later exact-main success, rejects failed,
cancelled or unrelated late results and stops at the new bounded deadline. No
customer operation timeout or required release check changes.

## Installation and release

Apply `20261116172000_research_priority_cost_isolation.sql` once after exact-head
canonical checks and review, using the normal transactional migration ledger.
It requires target hash `40c0467f3e5d457057a60806df8a29f1` and selector hash
`babca17c5b3e89dac4931c803ba61405`. The resulting selector hash is
`01aa118515bea5525c4fa7f209a6fec0`. It changes only the selector and adds the
service-only private helper, updating the selector slot in three active manifests
under their original locks. All other policy fields are compared exactly.

Verify installed definitions, helper rights, unchanged full target and policy
fields, then complete exact-main production release checks. No separate feature
activation is required. Observe ordinary completed work and timeout recurrence;
a passing check or removed flag does not establish zero stalled accounts.
