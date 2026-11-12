# Research request pacing and exclusion maintenance

Problem: ordinary requests could consume the entire daily allowance early, then
unacknowledged exclusions could block otherwise-reserved startup research. This
release does not increase provider limits, grant free usage or reset counters.

## Policy

At the next normal 24-hour window, partition the existing 9,800 local request
budget into the unchanged 980 starter requests, 196 maintenance requests, and
8,624 ordinary requests. Ordinary allowance grows with elapsed time, plus a
bounded one-hour burst (359 requests at the start). Unused released capacity may
accumulate. Shared 60/minute and provider retry/remaining checks still apply.
This is pacing, not extra quota or guaranteed throughput for each account.

Maintenance covers only a live, unexpired, accountless exclusion-sync token for
an existing ready list and exact nonempty batch. Each token is admitted once;
immutable proof survives request-history pruning. Create/recover operations,
lookup/export and paid work cannot borrow maintenance. Original completion
requires exact list/batch acknowledgment before either pending source clears.

## Release

1. Pass offline and native disposable PostgreSQL tests. Never test with paid APIs.
2. Install the matching migration, which leaves the policy disabled and counters
   unchanged. Deploy the application carrying the token-scoped runtime and the
   `paced_wait` monitoring state. Verify the exact release.
3. Apply `config/activate-research-request-pacing.sql`. It locks the existing
   quota row, checks exact installed function hashes and pristine policy, and
   schedules activation at the existing current window's next natural boundary.
   It refuses an expired/malformed window rather than resetting it.
4. Verify activation time and unchanged limits/counters. At the next ordinary
   window, verify real exclusion receipts and request mix. An absent completion
   receipt is still pending, never success.

The currently spent ordinary allowance is not recovered retroactively. Starter
capacity is not reallocated. This release does not claim to eliminate redundant
owner-preview/export requests; review original request evidence separately.

Monitoring distinguishes paced wait from remaining capacity reserved for new
users. Next eligibility includes pacing, minute and provider holds. Disabling
pacing is not an automatic rollback: it releases ordinary burst protection and
must be an explicit operator decision, never a counter reset.
