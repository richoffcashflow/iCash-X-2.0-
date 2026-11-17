# Acquisition capacity without duplicate reserve calculations

On November 17 UTC, a bounded production-log read found a statement cancellation
at `04:02:05.574Z` in the general selector's acquisition candidate query. Its
stack ended inside `request_reserve_state`, while counting the current reserve
admissions. The `03:40–04:10Z` window contained that one selector cancellation
and a separate usage-context cancellation in opportunity scoring. It did not
establish a recurring outage or identify the total cost of any one nested call.
The reserve table already had a `day_start` index and approximately 3,176 rows.
There is no evidence here for adding another index or increasing timeouts.

The captured source did establish redundant work. The acquisition headroom
wrapper first called the shared two-request capacity function, which calculated
the stable global reserve state. For an eligible account with headroom enabled,
the wrapper immediately calculated that same state again. Instrumenting the
actual reserve function reproduced 200 calculations for 100 eligible synthetic
accounts. The repaired wrapper performs 100. This is a count of avoided
calculations, not a measured production speedup or proof that the entire timeout
is fixed.

The wrapper now incorporates the exact captured shared eligibility body for its
existing constant two-request input and retains the first reserve result in a
local variable. It applies the unchanged headroom predicate afterward. Both
source functions and the reserve function are `STABLE`; the reserve timestamp is
the existing `now()` default, not `clock_timestamp()`. Reusing the value within
that same statement preserves its snapshot and day/minute boundary semantics.
There is no session, transaction, account or persistent cache. A later statement
observes newly committed quota, Pause and policy changes normally.

The shared capacity function, final atomic request limiter, scheduler, ordering,
fairness, all budget limits/counters, original receipts and holds remain
unchanged. Early provider/minute/day failures still avoid the reserve read.
Disabled headroom still performs the original single shared check. Null account
and SQL NULL behavior are preserved, including the prior outer `IF NOT NULL`
continuation semantics. Availability alone never grants a provider request.

## Verification

The focused PGlite test compares the actual old and new functions across 87
cases covering protected first funding, null/old accounts, headroom/reserve/pacing
settings, provider holds, Pause, membership, credits, cancellation, elapsed and
future windows, exhaustion and explicit malformed/NULL reserve states. It
verifies early-return call counts, exact unchanged authority definitions,
private privileges, source/owner/ACL/metadata/result drift refusal, immutable
policy fields and migration-ledger rollback.

Native PostgreSQL 17.11 reproduces the 200-to-100 calculation count. Independent
connections verify a successful bounded wait behind the captured ordinary lane
entry, two-second refusal of a sustained scheduler holder, no budget row lock
while waiting, immediate refusal of busy budget or policy rows, and atomic
rollback when the ledger insert fails after a successful wait. They also verify
fresh committed quota, Pause and disabled-policy observations within one reader
transaction; and final atomic refusal after another caller consumes the quota.
All databases and requests are synthetic local fixtures. No production selector,
provider call, contact, spend, replay or flag reset is performed by verification.

## Release

Apply `20261117040822_acquisition_capacity_single_state.sql` only after source
review and the exact canonical checks. The normal migration runner owns the
transaction and ledger. Ordinary general, recovery, messages, voice and research
polls all acquire transaction lock `726341927`; a separate no-lock observation
does not guarantee it is free when installation starts. The installer joins that
same lock queue for at most the existing two-second `lock_timeout`, before taking
any budget or policy lock. The complete migration DO statement retains its
eight-second `statement_timeout`. Budget and policy row locks remain `NOWAIT`.
Runtime polling, scheduler lock calls and timeout settings are unchanged.

The migration pins four full
definitions, their owner, execution ACLs, volatility, parallel safety, strictness,
leakproof setting and empty search path before and after installation. It verifies
the active headroom manifest against its existing selector definitions. A lock
that exceeds its bound or any drift rejects the transaction without changing
functions or policy. Failed earlier installation attempts remain historical
receipts; they do not authorize an unattended retry loop.

The acquisition wrapper MD5 changes from
`ef2ac533056a6e0be5bc450e191eaed2` to
`c8549a105f353bc11b0dcb904bbd8e71`. Only its existing
`acquisition_headroom_policy.capacity_hash` slot changes. The policy's enabled
state, release/activation receipt and other source hashes are preserved. There
is no new activation, source enrollment or replay step.

Verify exact resulting source/security metadata and the one migration ledger
entry, then the exact web/worker production release. Observe ordinary scheduler
and completion evidence afterward. Passing this narrow repair does not resolve
historical pending work, explain the separate opportunity-score cancellation or
justify clearing any workflow finding.
