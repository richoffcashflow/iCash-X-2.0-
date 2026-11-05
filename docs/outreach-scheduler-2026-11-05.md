# Eligible properties without outreach

The November 5 owner report concerns actual calls and texts, not worker uptime or maintenance completions. Production read-only checks at 8:48–9:02 AM Central found two distinct conditions:

- Ordinary new contacts use the existing 9 AM–9 PM Central fallback when their source has no verified recipient timezone. Before 9 AM, 1,613 ready jobs and 1,599 potential first-text threads were correctly outside that window. Unexpired contacts are only one prerequisite for dispatch.
- General scheduling repeatedly failed with PostgreSQL 57014 while preparing contacts, examining active voice holds, or scanning seller openers. The dedicated text selector and its legacy wrapper still scanned every candidate despite the older bounded helper.
- After 9 AM, ordinary text sends resumed. New voice jobs instead stopped before reservation/dial with `production_agent_review_required`; runtime diagnostics reported `VOICE_AGENT_CONFIGURATION_MISMATCH` and then `diagnostic_shape_bound`. This release does not approve that unknown configuration or claim the calling incident resolved.

## Changes

Contact preparation materializes exact national receipt/source bindings before joining the rest of its candidates. The legacy branch, complete final proof, order, LIMIT 100, insertion loop, caller locks, ACLs, historical receipts and funds are unchanged. This uses current indexes and needs no concurrent index creation. The separately held #548 migration must be reassessed against the new function hash; it must not be installed blindly.

The dedicated first-text issuer now examines at most 32 cheaply selected candidates per call. It advances the existing private cursor, rechecks current eligibility and final copy/source admission, and wraps to revisit blocked or newly eligible rows. The legacy wrapper delegates to this same selector, preserving its prior fallback. Existing invitations must bind the exact account/thread/message and have no earlier ticket. An uncertain or already attempted send is never replayed.

Voice diagnostics inspect only the exact configuration projection and fixed identity fields used by the unchanged validator. Up to 256 KiB, 6,000 nodes and depth 32 allow deeper provider tool schemas while retaining bounded, redacted observations. At most 64 optional-default candidates are examined under the existing 750 ms slice and one-minute process cooldown. No prompt/configuration value or secret is logged, and diagnostic findings never grant approval.

## Verification

The read-only global source SELECT on production took 1,751 ms before and 757 ms with the materialized binding, returning the same empty projection at that observation. These are individual query measurements, not a guarantee of end-to-end dispatch latency.

Offline equivalence covers foreign receipts, missing/malformed sources, complete and partial prior channels, legacy observations, account scoping, source changes, Pause, suppression, costs, unchanged insertion and service-only authority. Native PostgreSQL checks exercise generic/custom plans, competing preparation, late Pause and source/receipt changes under the original locks.

Text fixtures reproduce 1,024 checks in one original call and 32 afterward, cursor sharing/wrap, blocked early accounts, actual saved invitations, wrong-account history, one-use tickets, final queue behavior and original routing/price/opener triggers. Native contention checks exercise concurrent cursors, locked threads and late customer/credit changes. No paid provider tests or retrospective outreach are part of verification.

## Release record

Pending exact-head reliability checks, guarded function migrations and matching production deployment. After installation, verify ordinary caller/text receipts separately from scheduler tickets. Keep the voice incident open until its current provider mismatch is identified and repaired with exact approval evidence; never replace an approval hash merely to clear the failure.
