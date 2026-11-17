# Seller qualification from saved message receipts

The legacy return-call qualification reader runs outside the separately
activated shared-memory cohort. It previously read accepted and delivered texts
without selecting their receipt state or provider identity. Every outgoing row
became a question. An incoming `Yes` after an accepted, unconfirmed ownership
question could therefore fill ownership and make a later partially qualified
call eligible for a price discussion. The regression executes the actual bound
qualification function and fails on the previous implementation.

The reader now uses only delivered outgoing messages with an original provider
identity and original delivery time as questions, and received incoming messages
with a provider or event identity as answers. An ambiguous answer binds only
when its original authenticated incoming event time is strictly after delivery;
a delayed delivery webhook or delayed incoming ingestion cannot manufacture
that order. Missing original event time leaves the question unknown. Unconfirmed outgoing messages remain boundaries: simply
removing them could attach a later answer to an older question. Unverified
incoming rows also clear that question. Independent explicit seller statements
and completed bound call history retain their existing interpretation.

The old query silently selected the oldest 200 messages. A later correction or
refusal could be omitted. The bounded read now requests one extra row and treats
an overflow as incomplete evidence, using the existing reconciliation hold
instead of borrowing older positive facts. It includes unsent boundaries in
that bound. A complete 200-row history remains supported. A current explicit
refusal retains its existing precedence, and no incomplete decision is cached.

Rows have a stable timestamp/ID query order. An ID tie-break is not evidence of
speech order: a same-time outgoing message cannot establish which question an
incoming answer addresses, and multiple same-time incoming answers require
reconciliation before a correction can be overridden. Invalid timestamps also
remain incomplete. Only exact event IDs from the scoped incoming rows are read, projecting ID,
type, and timestamp in parallel batches of 25 (at most eight); no raw payload
or unrelated event is read. Original event times order received statements.
Without an original timestamp, ingestion time can retain a standalone source
statement but cannot bind an ambiguous reply to a question.

The focused seller qualification suite verifies unconfirmed delivery states,
missing identities, event-only incoming receipts, intervening messages, latest
ownership corrections, same-phone account/thread isolation, timestamp ties,
delayed incoming/delivery webhooks, missing/invalid original event times,
retained completed-call evidence, and both sides of the 200-row bound. All data
is fictional and all provider/database dependencies are offline fixtures.

This application-only repair changes no stored messages, contact or financial
authority, customer controls, claims, provider sends, paid operations or activation settings.
The shared-memory implementation and its reviewed cohort remain unchanged. A second regression covers the legacy shortcut that returned immediately when
the supplied current call was fully qualified. With real call-start metadata
and per-answer offsets, a refusal sent after the last qualifying answer was
never read and the helper returned ready. The shortcut now runs only after the
same bounded thread/source check. Multiple active threads, capped histories,
or unavailable reads remain unknown instead of silently bypassing a refusal.

When a saved text actually conflicts with the call, the helper reuses the
route's existing single current-conversation callback. The route's injected
live history omits timing, so the provider response must name the exact bound
conversation, supply a valid call start and ordered user offsets, and contain
the supplied agent/user prefix. If supplied metadata includes a start, it must
match. The helper orders actual spoken answers against original SMS event
times, not merely against call start. A later explicit correction of ownership,
interest or listing can supersede the old fact; a later filler cannot. Hard
contact stops, review requests and unstructured withdrawals stay stopped.
Missing original SMS time, missing/stale/wrong-call/future/reversed speech
order, and millisecond ties cannot establish a reversal. Only the validated
`time_in_call_secs` fields enter chronological projection; alternate `at` or
`seconds` fields cannot move an earlier answer past a newer text. Tenant/family
speaker corrections use the existing parser predicate and invalidate prior
ownership and interest until the current speaker explicitly resolves them;
unrelated incomplete informational texts do not create that hold. Already-read
completed-call answers remain available when their completion precedes both
the current call and every timed SMS source. Missing or overlapping prior-call
completion time cannot establish that order. Bounded message and
thread reads are repeated after current-history retrieval; changed sources
hold instead of using the old snapshot. A complete current call without a
conflicting SMS needs no provider reread and no older-call lookup.

The focused tests prove the before/after shortcut failure, later factual
corrections, old SMS before the actual qualifying answer, filler, contact
stops, malformed chronology, unavailable reads and concurrent source changes.
The scenario, shared-memory, shared-memory routing, text-offer and actual
live-agreement route suites cover connected behavior. All use offline fixtures.

Practical limits: this is a bounded legacy reader, not a full-history rollout.
Histories over 200 rows and ambiguous ordering remain explicit reconciliation
holds. Millisecond resolution conservatively treats finer timestamp ties as
unknown. A final reread detects changes during retrieval; it is not a database
transaction with a later offer write. Existing final contact, financial,
acceptance and signing admission checks remain authoritative. The separately
activated shared-memory SQL has its own receipt-time behavior and was not
expanded or rewritten here. No production/provider observation is claimed.
Release still requires normal exact-head/main checks and matching web/worker
verification.
