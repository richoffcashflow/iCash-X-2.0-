# Voice issuance cooldown polling

The worker previously treated every missing voice ticket as idle and waited five,
ten, then fifteen seconds. One cause was the existing global one-second issuance
cooldown. The original issuer also prepared the queue before checking that
cooldown. With several voice worker slots, a recent successful issuance could
therefore put the remaining slots into the same long idle schedule.

The separate `icash_poll_voice_ticket()` RPC checks only that known short wait.
It first wins the existing global advisory lock and checks the existing enabled
dispatch policy, then reads the scheduler singleton. A last issuance between
transaction `now() - 1 second` and `now()` returns exactly
`{"status":"voice_cooldown","retryAfterMs":...}` with an integer delay from
100 through 1,100 milliseconds. The remaining interval includes a 25-millisecond
margin for the original strict one-second comparison. There is no token,
provider request, candidate scan, queue preparation, reservation or completion.

Lock contention, disabled dispatch, a missing scheduler row and future timestamp
return ordinary `null`. An expired or never-used timestamp delegates to the
unchanged original voice lane and issuer, including queue preparation, account
fairness, recipient hours/permissions, available funds, provider capacity,
unknown-operation holds and exact one-use ticket creation. A genuinely empty or
held original result remains `null`; this wrapper does not claim a backlog is
eligible. The original three primitives keep their exact OIDs and every
`pg_proc` field during installation.

The worker accepts the marker only from its voice RPC and rejects extra fields,
a token, another status, a noninteger delay or an out-of-range delay. A valid
marker schedules a pool-wide lower-bound wait; it never wakes another slot
before that slot's idle/error deadline. It preserves the current slot's idle
history and the fifteen-minute recurring-failure history. Like an ordinary
successful null read, it can clear consecutive transport failures. Both the RPC
client and scheduler monitoring operation allowlists include the new endpoint.
The marker is never counted as completed customer work. Other pools, the global
250-millisecond start stagger, round-robin selection, concurrency limits,
shutdown draining, ordinary 5/10/15-second idle waits and error backoff remain.
An uncertain RPC or automation HTTP outcome never triggers another request with
the same ticket, a fallback issuer call or a repeated provider operation.

## Evidence and load

Read-only production observation confirmed eligible backlog with free slots;
cooldown attribution remains unproven. Detailed activity observations stay in
the private investigation artifact.
Database contention, scans, original controls and provider/handler latency also
matter. The issuer saves transaction `now()` before queue work, so a slow queue
can consume the entire cooldown before its response and leave no hint to use.

The focused worker test uses the actual scheduler with zero-latency fictional
requests and a continuously eligible one-ticket-per-second database gate.
Legacy mode returns false for cooldown; new mode returns the tokenless hint.

| Configured worker slots | Legacy/new tickets per minute | Legacy/new full issuer entries | New cheap cooldown reads | Legacy/new largest ticket gap |
| --- | ---: | ---: | ---: | ---: |
| 8 (two voice) | 13 / 55 | 32 / 55 | 55 | 5.50 / 1.70 seconds |
| 16 (four voice) | 24 / 50 | 55 / 50 | 50 | 5.75 / 2.00 seconds |

In the separate five-minute empty/overnight simulation, the old and new
schedules are identical: 42 full entries with eight worker slots or 84 with
sixteen, and zero cooldown hints. Busy work can increase useful issuer work;
this is not a promise of lower database load or production throughput. The
global worker start bound still permits at most four automation starts per
second across every pool, and the database's original issuance gate remains.

## Verification and rollout

`tests/voice-cooldown-worker.test.mjs` covers the protocol, one-use transport,
malformed hints, both monitoring paths, faults interleaved with hints, preserved
idle/error deadlines, concurrent shared waits, empty load, bounded busy load,
fairness and shutdown. It is included in the worker Docker test stage and local
release verification. Existing worker recovery, recurring-failure, transport,
diagnostic-cleanup, heartbeat, watchdog and parallelism suites remain required.

`tests/voice-cooldown-database.test.mjs` loads the exact saved original function
definitions and actual migration in a runner-owned transaction. It rejects
source/ACL/volatility drift and duplicate installation, verifies all primitive
metadata unchanged, tests cooldown boundaries without queue work, and exercises
the actual original issuer/lane with fictional existing dependencies. Only
queue preparation is instrumented after the migration's preservation check.
Pause, funding, hours, phone/capacity refusal and unknown spend evidence remain
effective. With `ICASH_PG_MODULE` set, it requires an empty fixed localhost
`icash_voice_cooldown` database on port 55443, verifies real advisory contention,
and races 24 service-role clients using both old and new endpoints for exactly
one original ticket. The native CI step creates that isolated database.

1. Apply `20261117151457_voice_cooldown_poll.sql` once using the release runner's
   atomic migration/history transaction. Its config mirror is byte-identical.
   The Supabase CLI generated the migration filename. A changed source, owner,
   ACL or function metadata aborts installation; never bypass these guards.
2. Verify the new function and grants through read-only catalogs, plus the
   unchanged original primitive hashes. Do not invoke a production issuer as a
   development probe. Installing this unused additive RPC changes no existing
   worker behavior and requires no activation flag.
3. Deploy the tested exact worker release only after installation is verified.
   Old workers continue using the original endpoint during a rolling release;
   both endpoints share the same global lock and original one-second gate.
   A missing new endpoint fails closed with ordinary error backoff. There is no
   catch-and-fallback after an ambiguous request.
4. Observe ordinary worker heartbeat, recurring failures, actual original
   dispatch/carrier receipts and occupancy. A rollback to the old worker keeps
   using its unchanged RPC; leave the additive function installed. No paid
   development calls, provider changes, historical replay or throughput claim
   is part of this verification.
