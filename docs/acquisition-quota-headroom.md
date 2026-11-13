# Contact work under paced research demand

During November 13 recovery, ordinary capacity repeatedly reached two available
requests. Property discovery could start, while contact export admission needed
three. Selecting the contact account at two also moved its next scheduled time
forward after finding no admissible contact job. Continuous smaller searches
could therefore prevent contact work from starting indefinitely.

The offline mixed-demand reproduction uses the actual database pacing and
capacity functions and a deterministic model of the acquisition selector. Over
ten simulated minutes the original behavior completed 30 searches and no
contact batches. With scheduling headroom, 12 contact batches and 11 searches
progressed within the same released allowance (58 of 60 requests). This is an
offline scheduling result, not evidence of delivered contacts or outreach.

The separately disabled policy adds a capacity prefilter only to the acquisition
selector and resumable prospecting-ticket selector. When ordinary pacing has
exactly two available requests and at least three remain in its daily allocation,
these selectors wait for the next paced token so their existing oldest-due
ordering can consider contact work at its existing three-request minimum.
The shared availability function is byte-for-byte unchanged: estimates,
already-started discovery, three-request export checks and the final atomic
one-request limiter continue through their original admission rules.
Protected starter allowance remains available under its existing eligibility;
the final two ordinary requests in a day remain usable. Minute/day/provider
limits, one-hour pacing burst, counters, maintenance reserve, customer funds,
Pause, source/recipient authority and unknown request receipts are unchanged.

The policy does not guarantee instant work for every account. Existing jobs can
still wait for provider responses, quota, eligible contacts, permitted hours or
sufficient credit. One-request cleanup and already-started workflows continue
through their original final admission; no purchase or call is replayed.

## Verification and release

`tests/acquisition-headroom.test.mjs` verifies the starvation reproduction and
mixed-demand progress, disabled installation, guarded/idempotent activation,
current and terminal-day capacity, starter eligibility, hard limits, provider
holds, private privileges and original-request replay prevention. Captured
production selectors are compiled and checked for exactly one call replacement
each, preserving every other predicate and ordering; the bounded mixed-demand
model exercises the actual capacity functions without executing paid jobs. Native
PostgreSQL races cover concurrent activation, final request admission, exact
quota counters and nonmutating availability reads. All use disposable fixtures
without provider requests. Existing pacing/reserve and acquisition tests remain
required, along with the canonical exact-head and exact-main release checks.

Install `config/acquisition-quota-headroom.sql`, then
`config/acquisition-headroom-scheduler-scope.sql` through the migration ledger,
keeping the private policy disabled throughout. The second migration requires
the pristine disabled predecessor, restores the original shared capacity
definition, and wires only the two queue selectors. Activation verifies the
exact wrapper, both selectors, original shared capacity and pacing definitions.
Verify the exact production web and worker release,
then call the operator-only
`icash_research_private.activate_acquisition_headroom(<exact-main-SHA>)`.
Read back its receipt and unchanged limit/window state. Verify ordinary contact
work starts through the existing scheduler and retain original uncertain work.
The activation cannot be invoked by application/service or customer roles.
An explicit operator rollback can set only the private policy's `enabled` to
false, immediately restoring the prior queue-selection behavior without resetting
any counter or request. Re-enabling a rolled-back policy needs a new review.
