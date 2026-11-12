# Startup contact dependency recovery

The November 12 request audit found a second startup dependency after restoring
financial-query exclusions. A completed exact no-records export rejection held
the shared export slot from 06:19 UTC. Existing recovery could not perform its
three free inventory reads once ordinary request capacity was exhausted.
Newly funded accounts had reserved capacity and eligible properties but could
not progress to contacts.

Automatic recovery still uses ordinary capacity first. If its existing source,
policy, shared lock and retry checks pass but ordinary capacity cannot cover the
three reads, it may select one currently eligible funded starter with actual
contact work. Source eligibility is checked in due order until a match, so
older starter accounts without usable properties cannot hide a later candidate.
The initial immutable request records that beneficiary; later probes retain the
same account and recheck its eligibility, source availability and controls.
No other account can replace it midway through the review.

All three reads use the existing atomic limiter, 980-request shared reserve,
50-request first-funding cap and provider holds. Final verification requires
the unchanged source and provider evidence plus consistent account attribution.
Completing valid reads can free only shared scheduling capacity. The original
export, held owners, monetary uncertainty and paid purchase are unchanged.
There are no new paid requests, customer charges, quota resets, limit changes,
historical retries or UI changes in this migration.

Validation composes the real reserve/pacing implementation with the original
automatic export policies. PGlite covers current and late controls, ordinary
priority, unchanged counters and financial evidence. Native PostgreSQL races
24 claimants and 24 workers at each probe, requiring exactly three reserved
admissions for one account, including its final available allowance.

Install `20261112200046_starter_export_dependency.sql` after those checks pass.
It guards exact function predecessors and is compatible with the existing
runtime. Observe original recovery receipts and new contact records before
claiming live account recovery; property searches alone do not prove contacts
or interested sellers.
