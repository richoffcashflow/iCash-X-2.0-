# Owner evidence query performance

After automatic export recovery released the November 2 global hold, production scheduler calls timed out in `icash_owner_enrichment_unstarted`, through preflight sibling selection. The cost evidence table had approximately 47,000 rows and no leading event-key or source-reference index. A read-only sample took 247 ms for one absence check, 367 ms for one cohort, and 730 ms for a sibling check. Repeated validation could hold the scheduler until its statement timeout.

The migration adds C-collation indexes for event keys and source references. It replaces only the original cost-evidence predicate with four independent indexed existence checks. Exact evidence still blocks, as does every colon suffix. In byte ordering, the range from `operation + ':'` inclusive to `operation + ';'` exclusive covers precisely the original colon prefix, including Unicode, punctuation and empty suffixes. It does not depend on a custom query plan or a constant LIKE expression.

Every other source, account and financial evidence check is unchanged. The migration checks the complete prior function definition, retains its volatility and permissions, and changes no receipts, reservations, balances, scheduler rows, timeouts or provider settings. Index creation is bounded by lock and statement timeouts and rolls back atomically on a conflicting prerequisite.

Offline verification compares results against the original function across prefix boundaries, exercises every original evidence table and malformed identity, checks private permissions, and requires indexed generic plans with 50,000 unrelated receipts. Native PostgreSQL verifies concurrent reads before and after a committed original receipt and checks that all evidence remains unchanged. Existing preflight contention tests remain required.

Rollout is backward compatible with the current application: apply the guarded migration after its checks, verify the live query plans/timings, and observe ordinary scheduled work. Do not replay a failed purchase or manually advance a waiting list. A SQL rollback can restore the original predicate; the additional indexes can safely remain.

PostgreSQL contracts: https://www.postgresql.org/docs/17/indexes-collations.html and https://www.postgresql.org/docs/17/collation.html.
