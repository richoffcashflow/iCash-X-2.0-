# Preserve progress when learning refresh is canceled

The November 14 production investigation found 120 failed learning cron runs in
30 minutes, 674 due accounts and no completed refresh after 19:46:46 UTC. Each
run had the existing 12-second statement limit. PostgreSQL excludes
`query_canceled` from `OTHERS`, so one slow account rolled back earlier successful
accounts and their queue/error receipts. Repeated runs selected the same old work.

`config/learning-timeout-isolation.sql` checks the exact installed predecessor
hash `1c6fe3654c98d458dea08ffc8ec6b038` for
`icash_refresh_shared_learning(integer)` and the health predecessor
`e50ce3a4ab3fa14eb48cf8e5ce52ec72`. A canceled account rolls back its own
aggregation, records SQLSTATE `57014` and retains any newer source generation.
Earlier successful accounts persist. The batch ends before another account or
review runs, and the result includes `canceled: true` with a generic warning.
PostgreSQL uses the same code for statement timeouts and operator cancellation;
the implementation records cancellation without claiming its cause.

Canceled accounts and conversion-cache attempts receive a bounded five-minute
retry delay. A new source generation remains due without bypassing that delay.
Other accounts continue on the next scheduled run. Conversion errors remain
visible while independent account work succeeds. A review cancellation likewise
preserves earlier output and records failed refresh/review health. No query limit,
cron cadence, training label, policy allocation, account funds, customer control,
contact authority or acquisition scheduler changes.

Health now treats current refresh/conversion errors as a warning even when the
last successful cache remains recent. Each category still contributes one warning.
The existing one-second cron lock timeout bounds checkpoint contention after
statement cancellation. If checkpoint persistence itself fails, the run remains
an explicit failure; it cannot claim saved progress or recovery.

Validation covers the actual forward function in PGlite and native PostgreSQL:
the original lost-batch failure, real 250ms statement timeouts, explicit operator
cancellation, concurrent generation changes, cache retry fairness, late review
cancellation, private permissions and the exact predecessor guard. The native
check runs in the existing Reliability checks database-contention job. Local
native validation used existing PostgreSQL 18.6 binaries; canonical CI uses the
repository's PostgreSQL 17.6 service. No providers or production fixtures run.

The migration was installed through the supported atomic runner at
**2026-11-14 20:57:32 UTC**, ledger version `20261114205732`. The runner supplied
the transaction; only the file's outer `begin`/`commit` were omitted. Readback at
20:57:41 UTC verified refresh hash `62d7625004e807cd463088b173dbba5d`, health hash
`257d67bee60c936f98bea0713a513033`, denied execution for `anon`/`authenticated` and
retained execution for `service_role` on both functions. Do not reapply it.

Read-only observation at **20:58:02 UTC** found two naturally scheduled post-install
receipts. The 20:57:36 run reached its original 12-second limit and persisted one
completed account plus one canceled-account failure. The next 20:57:51 run
completed five accounts in about one second. Six accounts had successful refresh
timestamps after installation, one retained cancellation evidence and the due
queue fell from the earlier 674 to 667. No manual refresh was invoked. These are
learning-aggregation results, not seller calls, text deliveries or account recovery.

This is an immediate database behavior repair with no separate activation policy.
Repository publication and fresh canonical exact-head/exact-main release checks
remain separate. Verify naturally scheduled refresh receipts, account progression
and remaining timeout errors. Installation alone does not establish recovery. This isolates a
demonstrated learning failure; it does not prove seller outreach or zero account
stalls, and it does not make an individually expensive aggregation faster.
