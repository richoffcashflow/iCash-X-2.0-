# Original text delivery recovery

Production inspection on November 2 Central / November 3 UTC found 395 outgoing property texts with original accepted provider IDs, no terminal delivery timestamp, and already settled transport charges. The existing app consumed signed delivery callbacks but never fetched those known messages when a callback was absent. This is delivery uncertainty, not missing outgoing-send or billing evidence.

The authenticated maintenance route now claims at most three original messages per minute across concurrent invocations. It performs one current leased-number inventory read per batch using the same configured Contiguity account key, then a GET with `?tracking=true` for each exact original message ID. Reads are independent of customer Pause and outbound-send flags. Per-message observations back off from fifteen minutes to twenty-four hours and stop after eight attempts; a lost read cannot restart the send.

The private attempt record retains its immutable original message/thread/account/provider/operation snapshot and exact raw provider responses. Application and SQL checks require the explicit canonical source marker, original ID, leased sender, recipient, body and attachments, a compatible original send timestamp, and an actual terminal tracking timestamp. Missing, conflicting, oversized, malformed or unavailable evidence stays held. A carrier failure or cancellation becomes delivery review; neither is proof that the message was never sent. The original operation, rate, charge, contact rules, customer controls and provider receipts are unchanged.

A verified completion locks budget, provider identity and message in the same order as the actual callback. A callback that wins first prevents the canonical result from overwriting it; repeated completion is idempotent. The exact verified canonical receipt permanently fences only that original message from opening a historical seller reminder or initializing a new Meta follow-up window, including if a duplicate real webhook arrives later. Existing delivery/learning observations remain active, and new messages retain ordinary follow-up behavior. There is no incoming-history import or historical automatic reply.

The first live recovery batch exposed an omitted query parameter: all three exact-ID responses reported delivered but omitted `tracking`, which defaults to false. The follow-up requests `?tracking=true` and binds that exact URL in SQL. It preserves those original held receipts, retry times, attempt counts and global quota; missing timelines still stay held, and the send timestamp never substitutes for delivery time.

Offline verification loads all nine production message triggers that can run on a state update, including their original definitions. The provider mock omits tracking unless explicitly requested and reproduces the original hold before applying the fix. It checks source changes, late callbacks, partial and contradictory evidence, sender-account mismatch, immutable receipts, no financial changes, no new incoming messages, and no historical seller/Meta follow-up. The native PostgreSQL CI test uses twenty-four competing claimers and finishers plus the original callback function and actual triggers to verify one transition and the late-callback race. Local execution of the native test requires the existing fixed disposable PostgreSQL fixture on port 55443; it never contacts a provider.

Official references verified November 2 Central:
- https://docs.contiguity.com/api-reference/product/text/fetch — original-ID GET and status/tracking schema.
- https://docs.contiguity.com/api-reference/product/text/history — conversation history contains only provider-stored messages/events, not a carrier query.
- https://docs.contiguity.com/api-reference/webhook/events — failed delivery may mean no carrier confirmation; cancellation is not proof of unsending.

This repair does not prove incoming seller texts work. The active 720 line still has no new observed customer replies; its separate reliability warning remains open. Resolving that requires actual original inbound provider evidence or a genuine received message, not outgoing delivery counts.

The November 3 follow-up found a queue fairness gap: `next_check_at NULLS FIRST`
put every never-checked message ahead of due retries. Sustained fresh backlog
could therefore delay an expired read even after its existing backoff elapsed.
`text-receipt-queue-fairness.sql` selects at most three candidates from each
class, guarantees one from each nonempty class, then fills the third slot from
the oldest remaining eligible candidate. Ranking covers at most six rows. The due class uses an inner schedule join and
its non-null `attempts < 8` predicate directly, so PostgreSQL can use the partial
due index; the former `coalesce` expression could not prove that predicate.
Load-plan tests compare identical selected sources with 5,000 exhausted checks
and confirm index use with the default planner. The
existing global advisory/control lock, three checks per minute, eight-attempt
ceiling and backoff are unchanged. The final request contains exactly the
original source fields; the canonical tracking finalizer and financial history
are untouched. Skipped locked rows remain eligible on the next batch.

Offline coverage reproduces the old ordering with 200 fresh and 200 due messages,
then sustains arrivals across twelve accounts. The native PostgreSQL CI scenario
adds competing claimers/finishers, an immutable expired original attempt, exact
provider IDs, locked-head revisit, single-class capacity and every retry interval.
Incomplete terminal tracking still stays held. These tests do not demonstrate
provider receipt availability or production recovery; verify the exact deployed
release and real completed receipt attempts separately.
