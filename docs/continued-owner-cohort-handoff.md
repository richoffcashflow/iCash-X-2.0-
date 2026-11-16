# Continued original cohort handoff

The scheduler could verify a journaled original using its saved items while the
actual handler selected a different batch. After cleanup, the ordinary live
cohort helper no longer returned the old list. Fresh competitors could displace
unticketed original siblings, and already-ticketed siblings were correctly
excluded. The handler then passed this reduced batch to the original-source
adapter, which returned `held` before any provider call.

The fifth migration adds a private read of the complete journal-bound cohort.
It validates the original ticket, immutable retry/source deadlines, recovery
receipt, exact items/request, current sources, targeting, quote caps, whole
batch affordability and outreach reserve. It preserves every existing sibling
ticket exclusion. An ambiguous journal, generic hold, unknown cleanup or
incomplete batch cannot fall back to fresh competitors.

Before cleanup, the same WAITING cleanup authority or exact captured/current
CHECKING refusal proof must hold, with no prior cleanup attempt. After cleanup,
the original canonical deletion receipt is required. A parent without a child
must satisfy the existing renewal predicate. A single direct child must retain
the exact original items/request and qualify as the existing live cohort.
Further generations or changed lineage remain held. A child's creation or ready
timestamp cannot extend the original ticket or source deadline.

The real batch RPC keeps the journaled items in their original order. Ordinary
non-journal selection retains its existing ordering and rules. The journal
handoff predicate also runs in both the ranked property selector and its wait
existence counterpart, so blocked originals cannot slip through on an ordinary
turn. Cleaned-original priority uses the same proof. The issued-to-consumed
transition is accepted only for the exact current original ticket with no
outcome and a still-live capability; a historical consumed or generic-held
ticket does not qualify.

The migration does not change the handler API, any preflight/cleanup claim,
provider admission, paid batch claim, financial guard, original proof or
ordinary live-cohort function. Existing budget, source and final paid locks
remain authoritative if conditions change after selection. Already-held
cohorts with ticketed siblings remain held; absence of financial evidence does
not authorize their replay.

Apply `20261115152657_continued_owner_cohort_handoff.sql` after the first four
reviewed migrations in the normal ledger transaction. It pins the exact
predecessor definitions, owners and ACLs, complete function/trigger manifests,
and original activation receipts under the budget lock. Only the four changed
selection functions and two new read helpers are installed. Existing manifest
shapes, enabled flags, activation timestamps, fair-turn counters, requests,
journals and balances are preserved; `continued_cohort_hashes` records the new
helpers and batch definition. Do not reactivate prior policies.

Verification uses actual database selector, consume, batch, source adapter,
renewal and final admission definitions with synthetic sources. Required cases
include two- and three-item originals, displaced siblings, both cleanup phases,
live child continuity, whole-cohort funds/outreach floors, ticketed and late
siblings, Pause, unknown receipts, original expiry, both fair turns, and
selector/existence agreement. Final financial validation must execute the actual
per-item reserve and enrichment claims inside a rolled-back disposable
transaction, including late Pause, funds, sibling and unknown-work guards. The
complete PGlite/native handler and financial rehearsal is a release gate.
Both engines passed cleaned two/three-member and pre-cleanup CHECKING and
WAITING paths through actual final admission, with 58 captured financial
function identities verified. Actual unresolved sibling operations and prior
active exports were rejected without changing their original evidence. Every
synthetic claim rolls back before provider dispatch; no real provider request
or paid provider simulation is performed.

Two pre-existing final-admission behaviors are recorded separately. A
schema-valid isolated `provider_costs` row without an operation or export blocks
the source gate, but the unchanged final claim does not re-read it if it arrives
only after that gate. No current application/database writer or live row was
found for that table; its schema still permits such a row. Also, an already
consumed READY handler retains its existing completion behavior when the retry
deadline crosses, while an expired original cannot authorize a new
continuation. Neither behavior is counted as a passing unknown-work rejection
or changed by this selection-only repair.

The final five-migration PostgreSQL 17.6 wait test includes a valid journaled
original among 200 candidates. The captured old wait callback, using the final
selector, made 200 score calls in 52.1 ms; the final existence path made zero
score calls in 24.9 ms, below the unchanged 3,000 ms bound. Final ranked and
existence eligibility agreed. A budget-lock race preserved a paused three-item
original while an independent two-item original issued, without changing
request or financial evidence. These measurements are synthetic regression
evidence, not production throughput guarantees.

`tests/continued-owner-cohort-handoff.test.mjs` additionally verifies exact
ledger rollback, rejected source/ACL/manifest/trigger drift, ambiguous journal
rejection, unchanged activation/history/financial rows, and byte-identical
claim, payment and ordinary cohort functions. Handler/native results must pass
before release; local fixtures do not establish real provider completion.
