# Funded accounts stalled behind unavailable sellers

Research priority previously treated every unsent introduction as actionable.
A seller phone already assigned to another account, a recent call to the same
phone for another property, or a future contact window could therefore block all
new research even with an available prospecting allowance. Inventory rejection
also left an unstarted call issued, repeatedly returning a misleading credit wait.

`outreach-research-liveness.sql` checks the existing property and seller-phone
assignments without changing them. Only due outreach that passes its hours,
repeat-call and inventory checks can take priority over fresh research. Final
dispatch still makes the locked inventory claim and enforces all contact,
membership, Pause, spending and provider-receipt rules. A proven unstarted call
whose claim fails is held with `seller_inventory_unavailable`; reservations and
uncertain provider outcomes retain their original reconciliation path.

Customer accounts continue sharing the configured business sending numbers.
Those numbers are not seller identity or account ownership. This change does not
rotate numbers, reassign properties, reuse another customer's conversations, or
permit an overlapping seller call. It preserves the first-call credit floor,
fixed 50% prospecting allowance, pacing, actual-cost settlement and ledger history.

The seller-recovery wrapper also uses the existing private timezone-name cache
instead of enumerating `pg_timezone_names` twice per scheduler poll. UTC offsets
and daylight-saving calculations still come from PostgreSQL at execution time.

Apply the migration before deploying the dispatch status correction. Verification
uses local PGlite scenarios and mocked provider traffic; no paid test calls run.
After release, check account-bound research and provider receipts separately.
New researched properties are not proof of seller interest or a signed contract.
