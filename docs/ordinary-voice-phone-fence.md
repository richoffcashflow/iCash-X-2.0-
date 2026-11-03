# Check ordinary phone spacing before capacity

The November 3 ordinary voice timeout remained after the global contact index.
Read-only profiling of the actual fallback SELECT found 159 inexpensive
candidates across 34 accounts. Of these, 150 passed the slot predicate but only
four passed the existing phone-spacing predicate, and none passed both.

The original SELECT took 1,268.820 ms and 195,795 shared buffer hits, including
its real capacity snapshot. A counterfactual with the unchanged phone guard
fenced ahead of the unchanged capacity guard took 359.204 ms and 52,500 hits.
The capacity guard saw four candidates instead of 159. Both returned no rows
and performed no writes. These bounded read-only measurements removed only
`FOR UPDATE` for inspection; production retains the exact original row locks.
The measurements are not a guarantee for future data or overall dispatcher
latency. The full general fallback can invoke the ready voice issuer twice.

The hash-guarded migration changes only the ordinary query's evaluation order.
An additional `OFFSET 0` subquery boundary prevents capacity work for a phone
already rejected by the original guard. It introduces no early candidate limit,
cache, refreshed contact evidence or admission exception. The original account
fairness and due ordering, row locks, final limit, final job/ticket writes,
urgent branch and individual guard definitions remain unchanged. Capacity and
unknown-contact holds still reject otherwise phone-eligible work.

The offline test uses the captured live issuer and synthetic guard boundaries
that raise if capacity is reached for a rejected ordinary phone. It verifies
large rejected prefixes, later eligible work, unchanged account fairness,
urgent priority, Pause/funds/hours/source rejection, ACLs and financial records.
The native script exercises custom/generic prepared queries, 24 competing
issuers and a capacity hold committed
while an issuer waits on the original scheduler lock. Native execution and the
exact release remain required; no paid calls or provider tests are involved.
