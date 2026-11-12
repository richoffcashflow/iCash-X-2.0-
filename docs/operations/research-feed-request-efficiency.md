# Research feed request efficiency

Two failures were verified in the November 12, 2026 production audit.

1. A deferred owner-export preflight fetched `/properties/ids` again before
   consulting the saved list/check. Pending, empty and held checks could consume
   an identity-preview request without advancing contact acquisition.
2. Startup exclusion synchronization still required the legacy query switch and
   `discovery_configs.research_list_id`. The active financial query instead uses
   `targeting_query_settings.list_id` with independent synchronization. Newly
   funded accounts could have protected requests and due research but never
   reach a search while unsynchronized exclusions remained.

## Behavior

`icash_pending_owner_preflight` is a bounded service-only read. It reuses the
existing cohort predicates, account, membership, funds, exact candidate order,
snapshots, owner availability and phone-pool evidence. Only an original pending
check can resume. The existing one-use claim controls all provider actions.
Once the count is positive, a fresh owner preview and unchanged paid admission
are still required. No preview timestamp, cohort expiry or purchase is renewed.

Startup synchronization accepts either the original enabled legacy query/list
or the exact enabled financial-query list with independent synchronization.
The live shared list must be ready. Its original lease, account-bound token,
first-funding eligibility, per-account reserve, provider holds and final shared
quota lock still apply. Both assigned-property and financial-acquisition
exclusions are included. A changed list, disabled policy, Pause, expired lease,
wrong account or replay refuses admission. Original provider acknowledgment
remains necessary to clear pending exclusions.

This does not raise quota, reallocate the startup reserve, change budgets,
enable the legacy query, copy property ownership between customers, retry an
unknown paid operation, or change the UI. The separately released daily pacing
and maintenance policy retains its original activation boundary.

## Validation and release

- Offline service scenarios verify zero repeat identity reads while a saved
  check waits, and a fresh identity read plus ordinary admission after success.
- PGlite executes the real reserve/pacing functions and recreates the financial
  startup configuration. It checks both exclusion sources, one-use tokens,
  late controls, immutable counters at installation and private access.
- Native PostgreSQL races exercise 24 competing startup claimants and 24
  request UUIDs: one shared lease and one original reserved request.
- Install `20261112194430_research_feed_request_efficiency.sql` before releasing
  its application caller. The migration guards exact predecessors. It adds
  no tables, changes no counters, and keeps all existing admission locks.
- Verify production exclusion receipts and actual account properties/contacts
  after release. Offline checks and a healthy process are not proof that every
  funded account has recovered or that a seller will respond.
