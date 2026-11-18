# Recovery after an interrupted owner export handler

An owner export can lose both the original request's final status and the
automation handler's completion write during a database outage. Its consumed
ticket then remains unchanged after the 240-second request handler has ended.
The earlier recovery path required an explicitly held, completed ticket, so it
never admitted the free inventory checks and the shared export queue stayed busy.

The existing unknown-export policy now also recognizes one exact original
consumed capability whose expiry is at least fifteen minutes old. Both handler
completion fields and both request result fields must still be null. The
original admitted request must fall within that capability and belong to the
same batch and account. Existing unknown/missing-finish switches, first-attempt
restriction, unique handler, original source fingerprint, no active recovery,
no provider artifact and single unresolved export checks remain required.

This only admits the existing three fresh, quota-bound free inventory reads.
Only complete empty pending/processing inventories and the existing inventory
proof can release shared export capacity. Finalization locks and rechecks the
original export, batch, request and handler. A late original receipt still
restores the capacity fence through the existing immutable evidence path.

No ticket, request, original operation, customer balance, supplier reserve,
contact authority or UI is rewritten by this policy. The original owners
remain excluded from repeat purchase. Provider cost stays unknown until a real
receipt resolves it. Independent new work retains every final admission check.

The migration pins the current helper definition, owner, privileges, search
path and source reader. It preserves all unrelated policy fields and updates
only that helper's existing credit-policy hash entry. The runner owns the
transaction and migration history. No application rollout or new activation
flag is required by the SQL change; the already deployed recovery service uses
the same functions and response shapes.

The focused PGlite test reproduces the original indefinite stall, then exercises
the actual claim/probe/finalize path, rejection boundaries, old held originals,
late evidence, immutable original records, idempotency and migration rollback.
The existing native PostgreSQL concurrency suite has a separate
`ICASH_TEST_ABANDONED_EXPORT_HANDLER=1` mode and required CI step for competing
claims, source writers, capacity finalizers and late-receipt admission fences.
Its unrelated provider and budget functions are deterministic local fixtures;
these tests do not contact providers or prove customer outreach.
