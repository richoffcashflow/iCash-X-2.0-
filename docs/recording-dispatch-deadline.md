# Outgoing recording setup deadline

After the November 5 scheduler and voice-recovery fixes, three production calls
at 16:18 UTC still stopped at `dial_claim` with `deadline_exceeded`. The database
saved their one-use dial claims roughly seven to nine seconds after recording
creation. The caller's shared 12-second recording-server budget also included
sequential provider review and recording creation, so it could expire during a
database request that was still within its existing 15-second request limit.
The original calls and money remain held; they are never redialed by this repair.

Ordinary outgoing dispatch now explicitly selects a 45-second total setup budget.
The default callback budget remains 12 seconds. Provider requests still have
their existing eight-second cap, database requests retain their 15-second cap,
and independent receipt writes remain capped at eight seconds. The total dispatch
budget stays within the existing 115-second voice worker request. This permits a
slow successful claim to finish; it does not introduce a sleep or minimum delay.

The same caller cancellation, live release/configuration checks, fresh SQL
admission, one-use claim, maximum call duration and no-retry behavior apply. A
claim or provider result that remains uncertain still retains its hold. Confirmed
provider responses can still be persisted after cancellation through the bounded
receipt writer. No callback timing, customer credit, provider limits or previous
operation evidence is changed.

The actual production server/service fixture reproduces a 16-second sequence
with a nine-second database claim: the old budget strands the claim without a
provider call; the dispatch budget places exactly one synthetic call and binds
its receipt. Both deadline modes also run expiration, disconnect, lost claim,
provider timeout, receipt-write failure and late confirmed-result scenarios.
All provider traffic is simulated; no paid development calls are made.
