# Stable seller recipient openers

## Prepared change

`config/seller-recipient-variants.sql` is an unapplied, one-time SQL change. Apply it only after the current `sms-property-routing` migration and the natural seller opener migration. It performs no provider calls, creates no contact threads or consent, and changes no funding, reservations, launch flags, sender numbers, or previously queued messages.

The current production consented-intake opener loses the buyer/AI identity. This change replaces only that branch's body expression, using the existing verified intake first name, actual customer identity principal, and the same property's complete address. It includes AI disclosure in each first message. The October 9 footer update removes the appended opt-out sentence; STOP replies still suppress further contact.

The three messages for a synthetic lead are:

1. Hi Jordan, AI for Bright Homes here about a possible cash offer. Are you the owner of 123 Main Street?
2. Hi Jordan, AI for Bright Homes asking about a possible cash offer. Do you own 123 Main Street?
3. Hi Jordan, AI for Bright Homes reaching out about a possible cash offer. Is 123 Main Street your property?

All three disclose the same buying purpose, a possible cash offer, and ask the same ownership question. None claims a ready offer, verified funds, ownership confirmation, a prior conversation, or a booked call. The account's actual principal is used even when it is an individual person's name. No bot name is invented. This change does not modify later conversation responses.

## Stable allocation

The private `icash_seller_recipient_ordinals` ledger records a slot for each lead/account pair. Existing matches are snapshotted once in assignment-time order with account ID breaking ties. Later match inserts allocate the next slot under a per-lead advisory transaction lock. Updates or deletion of ledger entries are rejected. Deleting or recreating a source match cannot renumber another recipient or reuse a slot.

Only a current match joining the exact thread account, lead and property's screening can use the saved ordinal. Slots 1, 2 and 3 select the three phrases. A fourth slot is held, not wrapped to duplicate earlier copy. The existing three-buyer matching cap remains authoritative and is not changed here. The ledger does not reconstruct matches deleted before this migration.

No historical assignment, queued message or delivery record is rewritten. An opener remains limited to one per thread by the original queue implementation. The older experiment's assignment labels are not a measure of which of these three phrases was chosen; the new immutable ordinal and stored outgoing body are the relevant evidence.

## Routing, identity and consent safeguards

- The migration requires the actual unique index on `(account_id, deal_id, sender, recipient)` for non-retired threads and rejects the old global active-number index. It never creates a global-number uniqueness constraint.
- The existing sender/recipient route still belongs to one account. This change does not authorize different buyers to share that pair. Three distinct phrases do not imply that three sends will be eligible.
- All original campaign, consent, thread, account, prior-message, property-stage, practice and queue checks remain byte-for-byte unchanged outside the targeted body expression. The existing sender and downstream route checks are untouched.
- Long identities or addresses, unsupported characters, missing identity/address, absent ordinal and ordinals above three return no opener. The existing 160-character one-segment cap is preserved; identity/address are never truncated and AI disclosure is never removed to fit.
- Table RLS is enabled. Public, anonymous and authenticated access is revoked. The service role has only SELECT/INSERT on the new ledger. New functions use invoker security and an empty search path, with execution available only to the service role. The existing opener function's privileges are preserved.
- The migration takes a brief match-table lock and aborts atomically if busy or if its current-opener/routing prerequisites differ. A failed prerequisite requires reviewing source drift, not broadening the patch automatically.

## Verification

Run the standalone isolated test with an existing official PGlite installation:

```sh
node tests/seller-recipient-variants.test.mjs
node scripts/test-seller-recipient-variants-pglite.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js
```

The test loads only the narrow current opener fixture, minimal synthetic tables and explicit permission/queue stubs. It does not load or inspect protected funding, reservation or nested provisioning implementations. It exercises the actual new SQL and the actual captured queue body with those isolated dependencies.

Coverage includes all three exact messages, chronological one-time backfill, persistent/non-reused ordinals after match deletion and recreation, a new lead's independent first slot, fourth-recipient hold, duplicate opener prevention, tenant/property binding, paused/manual/retired/revoked-permission/closed/practice holds, invalid and oversized inputs, actual individual principal, safe first-name handling, immutable old messages, unchanged legacy copy, routing prerequisites, broad-default-ACL revocation, RLS and invoker-only permissions. It also compares the full opener definition before and after to ensure only the intended expression changed.

Limitations: the local PGlite test does not establish production-chain integration, provider deliverability or multi-connection PostgreSQL lock behavior. No live database changes, real SMS/calls, paid tests, push or deployment were performed.
