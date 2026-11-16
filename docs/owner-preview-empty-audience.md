# Empty owner audience retention

The November 16 stalled-account investigation found a saved five-property free
owner preview containing four found properties with `contacts: []` and explicit
numeric zero `availability.owners` and `availability.phones`. The fifth property
had an identified owner with zero available phones. Only that fifth property was
retained by the existing empty-preview recorder. Three of the four already-known
empty owner audiences subsequently became contact-ticket primaries and completed
empty again over roughly three hours. Later request summaries do not preserve
their full raw bodies, so they do not prove exact repeated batch membership.

The service now submits the existing immutable recorder when a validated preview
contains either its original zero-phone-owner case or this explicit empty-owner
audience. The source-pinned database change adds exactly the same narrow case to
`icash_research_private.owner_preview_has_no_phones(jsonb)`. Its existing name is
retained for compatibility; an empty owner audience does not establish anything
about unreturned people or authorize contacting another person.

The full preview still requires matching submitted/found/not-found counts,
property IDs, the exact original zero-credit request, account and snapshot, a
current completed financial screen, unchanged unstarted-paid-work checks, current
customer controls and the existing locked admission. The recorder, its private
tables, immutability guards and expiry formula are unchanged. Expiry remains the
earliest of the original request, screening and fetched-data 24-hour bounds.
An acknowledgement never renews it. No historical backfill is performed.

An empty array without explicit numeric zero owners and phones remains unknown.
Missing, null, string, positive or contradictory availability is not empty-owner
proof. Not-found property rows, malformed contacts and ambiguous owner matches
remain outside this extension. Existing zero-phone-owner behavior is preserved.

## Validation and release

The observed four-empty/one-phone-less fixture fails before the service repair
(one retained audience instead of five). The database fixture verifies the exact
helper returns false before its migration and true afterward. Regression cases
exercise mixed and wholly empty previews through both ordinary and active-export
service paths, then prove a second poll does not request those known-empty
candidates. They preserve unknown/malformed/Pause/paid/source/expiry behavior.
The native PostgreSQL fixture races 24 acknowledgements and late Pause, original
unknown-receipt and paid-operation contenders for both old and new empty cases
against the unchanged recorder. A later synthetic migration-history failure
rolls back the helper replacement; function privilege/security metadata stays exact.
These fixtures make no provider requests or customer financial writes.

Apply `20261116210229_owner_preview_empty_audience.sql` only while its exact
predecessor helper hash matches. It changes one immutable private helper, leaving
the public recorder and every selection or admission function intact. Reapplying
or applying after source drift fails. The function keeps its owner, ACL, security
invoker mode, immutability and empty search path through `CREATE OR REPLACE`.
The migration runner owns the transaction and its migration-history write; this
new migration contains no internal `BEGIN` or `COMMIT`.

Use the existing serialized release process with exact-head/main checks and
matching production web/worker source. No separate activation is needed: older
code still submits its original phone-less cases; new code additionally submits
explicit empty-owner audiences. Observe future normal immutable receipts and
ordinary account progress. Do not trigger provider demonstrations, clear holds,
rewrite old receipts or claim all stalled accounts are recovered from this fix.
