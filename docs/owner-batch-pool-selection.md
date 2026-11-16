# Compatible owner batches

The owner export handler separates active-phone and mobile-only targeting pools.
Previously, SQL selected at most five eligible properties and the handler then
removed siblings from the other pool. A primary plus four incompatible siblings
could become a one-property provider check even when compatible properties were
available later in the same account's queue.

Fresh active-export selection now applies the existing targeting-pool resolver
before the unchanged five-property and affordability limits. It does not wait
for a full batch. The primary remains first, and compatible siblings retain the
existing UUID order. Legacy non-export selection is unchanged. An existing live
preflight or continued original keeps its exact audience and order; no original
list is expanded, trimmed or replaced.

The handler still rechecks every property's financial eligibility and targeting
pool. Original preview/preflight receipts, final paid admission, customer controls,
outreach reserve, provider quota, unknown outcomes and credit accounting are
unchanged. This reduces avoidable checks when pools are mixed; it does not lower
the credit price of a unique property/person or establish production savings.

## Verification

The PGlite regression executes the captured production candidate, live-cohort and
targeting functions. It reproduces one compatible item after the former limit,
then selects five compatible items for both active and mobile primaries. It checks
live/continued source preservation, whole-original affordability, financial and
manual holds, age, sibling tickets, tenant boundaries, legacy behavior and no
changes to receipts, funds or quota.

The migration rejects changed predecessor source, privileges, targeting functions
or continuation manifest. A simulated outer migration-history failure rolls back
both the function and its hash slot. Every other function, privilege and policy
field is compared before and after.

The native PostgreSQL test uses 2,011 synthetic properties and five concurrent
generic-plan selectors, checks the existing targeting identity index, and verifies
that selection stays read-only while the final budget row is locked. A concurrent
migration stops at its original five-second lock bound without partial changes.
No external provider, customer message or paid development request is used.

## Release

After exact-head canonical checks and review, apply
`20261116194633_owner_batch_pool_selection.sql` once using the transactional
migration runner. The source guard requires candidate hash
`2710c80d3c330cb9c271f2536585f785` and the exact current three-entry continued-cohort
manifest. It changes only the candidate function and that function's manifest slot,
under the existing dispatcher/budget and policy locks. No separate activation is
required. Verify installed source, unchanged privileges and all other manifest
fields, then complete the exact-main production release checks.

Use ordinary production receipts to compare ready batch size, requests per
successful owner batch and credits per eligible/contactable property. Small
batches may remain appropriate when supply, funds or current eligibility limits
them; those are not evidence that the repair failed.
