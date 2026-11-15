# Original text receipt acknowledgment recovery

The canonical delivery worker fetched an original provider receipt, then made a
single database call to journal it. A transient write failure or a lost response
after commit left the worker unable to confirm that observation. An unexpected
empty or malformed RPC response was also counted as an ordinary held receipt,
even though persistence had not been acknowledged.

Retry only that exact database finalizer once, retaining the same attempt ID and
the same collected receipt. Both calls share the original six-second deadline.
The SQL finalizer already locks and journals each original attempt once and
returns its immutable saved outcome on repetition. Accept only its four explicit
outcomes: `delivered`, `needs_review`, `changed` and `held`. Continued failure or
an unknown response remains `receipt_write_unavailable`.

This does not repeat a provider GET or send, claim a new attempt, reset backoff,
change the three-message batch or eight-attempt ceiling, renew an expired source,
alter sender identity, or settle money. The existing SQL authority, source,
terminal tracking and original-operation checks stay intact. A callback that
arrives before the database retry still wins. Disabled historical senders and
missing terminal tracking remain explicit holds.

The existing SQL journey suite now interrupts the worker before persistence and
after commit, returns malformed acknowledgments, and races a real callback
between attempts. It checks one immutable journal entry, unchanged original IDs,
financial history, sender and retry counters, and no historical follow-up.
Persistent failures remain visible. A separate deadline fixture verifies no new
save starts after the shared deadline. All providers are simulated; these tests
do not establish delivery or production recovery.

Release through the existing controller with exact-head full CI and review, then
verify the production application version. No SQL migration or activation is
required. Rollback is an application revert; retain all collected observations,
original holds and retry schedules. Observe naturally occurring acknowledgment
recovery and terminal receipt outcomes rather than sending a test message.
