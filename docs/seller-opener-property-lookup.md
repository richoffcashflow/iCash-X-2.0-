# Seller property-control lookup

The November 17 timeout investigation found unnecessary work inside the
bounded seller-opener selector's candidate query. PostgreSQL transformed its
manual property-control exclusion into an anti-join that scanned controls by
account, repeatedly filtering them against the screening snapshot property.
The existing primary key already supports the exact account/property lookup.

`seller-opener-property-lookup.sql` adds `OFFSET 0` inside the two existing
`NOT EXISTS` property-control subqueries, preserving their correlation so the
planner can use both primary-key columns. The candidate query and final thread
reread retain every original predicate, including SQL NULL semantics. There
is no new index, cached eligibility, early limit, account restriction or change
to the queue, source helpers, locks, 32-row cursor, ordering or issuance pace.

Read-only live `EXPLAIN (ANALYZE, BUFFERS)` samples of the pure candidate query
showed 63,006 shared-block hits in the old control lookup, versus 1,372 with
the exact lookup. Total query hits were 172,709 and 110,803 respectively. These
were separate observations under changing traffic: wall times were about
121 ms and 206 ms. They establish avoidable scanning, not a latency gain,
the complete timeout cause or restored end-to-end throughput. No live selector,
queue or provider operation was invoked by the investigation.

The PGlite fixture compares complete ordered old/new candidate pages over
six cursor positions in both plan modes, plus eight changed-control, balance,
pause, practice and screening cases. It covers absent, false, NULL and true
manual flags, missing/numeric property IDs, cross-account controls, cursor
advance, metadata/source rejection and transaction rollback. The final queue
definition is byte-for-byte unchanged.

The native PostgreSQL fixture uses 8,192 threads across 32 accounts. It checks
prepared generic/custom candidate equivalence, both exact index keys, fresh
committed controls between reader statements, migration lock timeout and
ledger-failure rollback, and twelve competing calls issuing one original.
Synthetic source and queue helpers isolate the selector; these tests do not
claim to reverify paid provider admission. Native baseline plans can already
use the exact lookup, so their timing is diagnostic rather than a performance
assertion. Existing final-admission coverage remains required.

Run:

```sh
node tests/seller-opener-property-lookup.test.mjs
ICASH_PG_MODULE=/path/to/pg node scripts/test-seller-opener-property-lookup-postgres.mjs
```

The native script connects only to the guarded disposable loopback fixture
`127.0.0.1:55443/icash_reliability`. CI runs it serially after the collector
plan checks, with the existing fixed database driver.

The forward migration was generated with Supabase CLI 2.95.3 and is byte-for-byte
identical to the config file. Its runner must apply SQL and migration history
in one transaction. It takes the existing scheduler advisory lock with a
two-second lock timeout and eight-second statement timeout, requiring source
MD5 `e6f81c009c46713083f8dc882e6b7d1f`, exact owner/security metadata and private
ACL. The only accepted result is MD5 `3b84ca1902ff715d3882b8dd6ebba935` with the
same metadata. Reapplication or drift aborts; no additional activation is needed.
Verify exact-head tests before installation, then verify the installed source
and observe ordinary timeout/progress/receipt evidence across accounts.

## November 17 production installation

The hosted migration runner recorded `20261117184814_seller_opener_property_lookup`
after all seven Reliability jobs passed on source `b78728434a452ae2322c43b85d08e88dc8ba37c2`
in run `44148584989`. At 18:48 UTC the original definition and permissions matched
the pinned baseline. Readback confirmed one ledger statement with SQL MD5
`a99ab9791f4572c0aa9ac8134c7b08c2` and function MD5
`3b84ca1902ff715d3882b8dd6ebba935`. The function retains its service-role
access, empty search path, Postgres ownership and invoker security. The config
and hosted migration file have SHA256
`8290faf1378dda710f9a6ceb53da4b93dcc93a0a9023baeaba68e37f021a32a2`.
