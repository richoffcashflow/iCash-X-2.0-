# Due contact retries and export capacity

The November 3 follow-up identified three due contact retries with current
source, funds and membership, but no new provider request. Their attempted
renewals overlapped another account's single active export. The service checks
that shared slot before admitting a request, so these deferrals correctly made
no provider call. Export-slot contention previously shared the rate-limit error
family, making the actual wait hard to distinguish. The operator diagnostic
change names export capacity separately while preserving the original durable
`owner_preview_rate_limited` outcome and bounded renewal rules.

The latest saved lists for these retries were deleted, expired or empty. Thus
the existing saved-preflight priority returned no date. At 06:42 UTC, the
accounts ranked 48, 97 and 105 among 117 outer acquisition scan candidates,
behind the unchanged five-account selection bound. A later snapshot proved one
ticket had been renewed and deferred again at 06:40; missing provider activity
does not establish that the scheduler never selected it.

`owner-retry-fair-priority.sql` adds only ordering hints. Existing saved-list
priority stays first, and ordinary accounts overdue by ten minutes still lead
both retry families. Due held retries then precede the ordinary spend ratio.
The property ordering uses the already joined, fully checked unique ticket;
it adds no source or financial queries. Original candidate predicates, account
locks, capacity checks, five-account bound and capability renewal remain exact.

The account hint first reads one due ticket from a partial index on the existing
finite retry family. An explicit early return prevents membership or budget
checks for accounts with no due retry. It then checks the current account,
configuration, rate, membership and available funds. This is a cheap priority
hint, not proof that a task may run: current source hash, original provider
evidence, immutable approval caps, same-property holds and all final admission
checks remain in the original candidate. A stale hint can use one existing scan
slot and receive the existing cooldown; it cannot authorize a retry or charge.
Omitting full source scans from the hint also lets the original candidate find
a valid later retry behind many stale hinted tickets.

The new index is distinct from the issued/consumed active-ticket index. A
read-only production plan before this index took 7.9 ms and 259 buffer hits,
including a 12,681-row contact-kind bitmap, to find one due ticket. There were
11 held retry tickets among 212,783 total tickets in that snapshot. Native CI
measures the new lookup with reused generic plans and large synthetic histories.

Offline coverage exercises exact function inverse-patch equality, large stale
prefixes, saved-list priority, ordinary aging, concurrent issuers, late Pause,
reserved funds, approval caps, deadlines and unchanged original evidence. No
fixture calls providers. Production recovery still requires the migrations,
matching deployments, completed useful work and settled receipts; a successful
scheduler poll or a renewed ticket alone is insufficient.
