# Preserve original lists while provider indexes finish

The November 3 follow-up found an exact successful list creation response with `status: "idle"` and `total_count: 0` for six requested people. The original recorder saved its list identity but immediately marked the check held, and normal cleanup deleted that list before it could become usable. Other original lists reported completed creation but an unfiltered people-count result of zero. Neither observation proves that the selected people have no eligible phones.

The [Create List reference](https://api.docs.dealmachine.com/api-reference/lists/create-list) currently describes record-ID creation as synchronous and completed. That differs from the observed idle response. The [Get List reference](https://api.docs.dealmachine.com/api-reference/lists/get-list) explicitly provides polling of the original list for build completion. This repair accommodates the observed idle/building response without assuming that every such response will eventually succeed.

## Bounded continuation

The disabled `preflight_indexing_enabled` policy retains an exactly bound HTTP 200 idle/building list. It never creates a replacement or changes a paid export. Subsequent work uses the original list ID, name, people source and saved owner cohort. A canonical free metadata GET must establish completed status and the exact expected count before the ordinary unfiltered and active/non-DNC filtered counts can admit anything.

A valid unfiltered count below the exact expected count is retained as an indexing observation rather than a zero-owner result. After confirmed metadata completion, only that original list-scoped count is checked again. Each observation is immutable under its one-use lease; the first exact baseline and eligible counts retain the canonical receipt keys used by the unchanged paid admission. Unknown/malformed/error receipts, mismatched identities or nonzero credit fields remain held.

At most six indexing-check handlers run, separated by the existing 90-second indexing allowance and bounded by the original creation-based 30-minute lifetime and existing ticket retry budget. Exhaustion has the explicit private reason `provider_indexing_exhausted`. Normal account scheduling continues while a list waits. Existing retry deferral is aligned to the saved next-check time so it cannot consume another capability merely to rediscover the same wait; it retains the original deadline, count, token binding and all account/source/financial controls.

The existing cleanup, cohort and due-account predicates recognize the original confirmed list throughout that same lifetime. Cleanup cannot delete an active waiting list, and terminal/expired work still receives normal bounded cleanup. READY work retains the existing verification-based admission window. Original receipts, paid-operation holds, customer Pause, membership, funds, source freshness, opt-outs, rate caps and account ordering remain authoritative. Historical deleted lists are not replayed or backfilled.

## Verification and release

`owner-preflight-list-indexing.test.mjs` reproduces the old idle-creation and zero-baseline failures against actual production function definitions, then checks the real metadata/count transport, original receipt immutability, malformed/foreign/charged evidence, Pause, expiry, bounded exhaustion and private grants. A 130-list waiting backlog yields to distinct eligible accounts; each scheduler pass retains its five-account bound and one-use ticket behavior.

`test-owner-preflight-indexing-postgres.py` exercises real competing claim/save/cleanup sessions, late old-lease callbacks, committed Pause, original unknown costs and fair issuance to three accounts amid 130 waiting lists. It runs only on the existing disposable localhost fixture database; no provider calls or customer charges are needed.

Apply the guarded migration disabled. This migration precedes the separately guarded local-quota continuation migration, which builds on its claim output. Require the full exact PR and main release checks, including native PostgreSQL, and verify matching web and worker commits before enabling the private policy. Inspect new ordinary metadata/count receipts and completed work afterward. A passing fixture or a running worker does not establish that all funded accounts recovered. Rollback disables the policy without erasing evidence, clearing holds or recreating lists.
