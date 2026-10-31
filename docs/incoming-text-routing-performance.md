# Incoming seller text timeout repair

On October 31, 2026, a rollback-only production probe of the existing lifecycle,
legacy-reply and property-ingestion path exceeded its 15-second deadline in
`icash_sms_resolve_explicit_property`. The ingestion query called the VOLATILE
property resolver in a predicate against every text thread. Recent conversations
near the end of the table therefore repeatedly scanned unrelated conversations.

`config/incoming-text-routing-performance.sql` evaluates the original resolver
once under the original transaction locks, then reads the chosen thread by its
primary key. A partial `(sender, recipient)` index accelerates the existing active
conversation lookup. It does not change the resolver, account ownership, property
ambiguity, STOP suppression, event/provider deduplication, AI queues or billing.

Verification: the saved production receiver executes the resolver 256 times in
the offline baseline and once after the repair. Existing isolated property-routing
checks pass, including ambiguous and cross-account replies, retired threads,
stale decisions, STOP and delivery order. The same rollback-only production path
completed in 47.515 ms after the repair; no synthetic messages persisted and no
provider sends were made. The SQL was then installed and read back successfully.

This fixes application ingestion, but does not establish that the provider
delivered every missing event. Recovery must use the original provider evidence,
retain timestamps, and avoid duplicate or historical automatic sends.
