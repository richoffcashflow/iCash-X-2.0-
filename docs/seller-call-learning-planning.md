# Seller-call learning query planning

The account learning job can spend its statement budget repeatedly reading an
account's entire screening history for each seller-call exposure. Its contact
cost helper also scans unrelated accounts' eligible voice jobs on every property.
Both costs occur inside the existing optional learning refresh; a canceled
refresh does not prove that customer acquisition or outreach has stopped.

The migration makes two planning changes:

- Inline the pure, account-scoped `properties` CTE with `NOT MATERIALIZED`, so
  property restrictions can reach the existing screening property index.
- Add `icash_learning_voice_cost_sources`, an account-leading covering partial
  index with the helper's exact eligibility predicate. Provider-only jobs,
  empty but non-null provider SIDs, and dispatching/dispatched jobs stay eligible.

The migration pins both observed function bodies before doing any work. It
recreates the seller-call function from its complete catalog definition with
one exact planning-clause replacement; it leaves the cost helper unchanged.
All source selection, duplicate-property handling, practice exclusions, tenant
boundaries, pending/maturity windows, positive/negative labels, unknown costs,
financial evidence, and policy gates retain their original expressions.
Notification, queue generation and completion locking functions are unchanged.

The migration runner owns the transaction and schema-history write. The script
has no transaction terminator, grants, policy activation, data update or refresh
invocation. Its local lock and statement ceilings are five and eight seconds.
Index construction uses ordinary transactional DDL: if it cannot acquire the
lock or finish within that bound, the complete migration must roll back.
There is no application or database runtime timeout increase.

## Evidence and verification

Bounded production read-only plans on November 16 showed 305 first exposures
from an account with 2,816 screenings. The original complete aggregate SELECT
exceeded eight seconds. Changing only the CTE plan completed the complete
SELECT in 7,597 ms; the same SELECT without the contact-cost diagnostic branch
took 1,939 ms. Those observations isolated the second cost rather than proving
the paired fix's production latency. A representative unchanged contact-cost
source query spent 25 ms scanning 32,989 voice jobs, rejecting 32,483 belonging
to other accounts. Production was not changed to collect this evidence.

`tests/seller-call-learning-planning.test.mjs` composes the exact observed SQL
from repository sources and runs it over wholly fictional data: 305 assignments,
2,816 screenings and 32,989 voice jobs. In one frozen-time transaction it compares
every complete rollup field before and after, preserves unrelated account/domain
rollups and snapshots every original source table. Cases include property history,
practice/missing IDs, foreign-tenant history, the exact 72-hour/30-day/60-day
boundaries, verified signatures/closings, unknown and zero costs, prior contact,
late suppression, disabled cost policy, null accounts and absent accounts.

The native mode uses the same fixture and a generic prepared plan copied from
the real helper's voice source branch. It asserts the new account index is used
and no voice-job sequential scan remains. The test checks catalog preservation,
both source-drift rejection paths, and caller-transaction rollback for migration
failures. These are fixture assertions, not production recovery measurements.
The final PostgreSQL 17.11 native run completed the full original refresh in
1,738 ms and the optimized refresh in 490 ms with identical results. Its generic
voice-source plan used the new index with 27 shared buffer hits and 0.447 ms
execution time over 32,989 fictional jobs. The PGlite run
completed in 3,130 ms and 1,143 ms respectively; environment-specific timings
are diagnostic observations rather than pass/fail thresholds.

Run the offline test with:

```sh
node tests/seller-call-learning-planning.test.mjs
```

Native CI owns an empty PostgreSQL 17 service at `127.0.0.1:55543` with fictional
database `icash_learning_perf_c46`. The test refuses other connection parameters,
socket destinations, roles, application names and nonempty databases. It does
not reset an existing fixture or accept production credentials.

```sh
ICASH_LEARNING_PLANNING_NATIVE=1 ICASH_PG_MODULE=/path/to/pg \
  node tests/seller-call-learning-planning.test.mjs
```

Before any production application, require the exact reviewed commit's complete
checks and fresh matching source hashes, coordinate the existing rollout owner,
and retain the migration ledger's atomic transaction. Verify ordinary learning
queue completions afterward without invoking paid providers, rewriting source
receipts or manually forcing an aggregate refresh. A local pass alone does not
establish production installation or recovery.

PostgreSQL documents the relevant planner behavior in
[WITH query folding](https://www.postgresql.org/docs/17/queries-with.html#QUERIES-WITH-CTE-MATERIALIZATION)
and [partial-index predicate matching](https://www.postgresql.org/docs/17/indexes-partial.html).
The properties projection has no volatile expression; using it more than once
does not introduce a source graph or cost-helper call into that CTE.
