# Acquisition turns for continued original owner work

The November 15 read-only follow-through found a second scheduling gap after an
expired free-list ticket had been safely continued. The original ticket still
had current source authority, sufficient funds and repeated three-request
capacity windows, but it did not issue before its unchanged retry deadline.
After canonical cleanup, the old list no longer qualified as a live preflight
continuation. The account returned to ordinary aging, behind a large overdue
queue. Completing the repair journal therefore did not establish completed work.

`continued-owner-scheduling.sql` keeps these exact originals within the existing
two-continuation, one-ordinary acquisition schedule. During continuation turns,
the earliest eligible deadline across cleaned originals and existing live lists
precedes ordinary account aging. The property selector compares the same source
deadlines so the winning account selects the intended screening. Ordinary turns
keep their existing order and aging.
The five-account selection bound and operating-budget lock remain unchanged.

The separate source resolver requires the immutable continuation journal, exact
account/ticket/screening/list binding, original recovery approval and cap,
canonical token-bound cleanup, current cohort snapshots and targeting, current
funds and retry authority, no later same-list generation, and no unresolved
same-property financial hold. The deadline is bounded by the original retry
deadline and source timestamps. It never renews a deadline or releases a hold.

The cleaned-original ranking requires the existing three-request capacity and
ready export capacity. It does not feed `icash_owner_preflight_due_at` or the
two-request saved-list path. A separate live-list deadline helper is derived from
the exact existing due predicate, changing only its projected value. It retains
the original source, cohort, financial and phase-capacity checks. Waiting lists
use their creation time plus 30 minutes; ready lists use their checked time plus
30 minutes, each bounded by the original ticket and source deadlines. An
ineligible sibling cannot improve an account's rank. Existing eligible live-list
steps retain their two-request path. Final list, provider-request, funding,
source and spend admission are unchanged. A cleaned list is never reused.
Original uncertain paid work is never replayed.

Recording a fair turn happens after the original ticket becomes issued. The
existing issue-token hash still provides exactly-once accounting. When no live
list supplies the source, the recorder repeats the journal proof for that exact
issued ticket and binds the decision to its original cleaned preflight. It does
not weaken a held-only predicate globally or exempt a financial hold.

## Upgrade and verification

This migration supports an upgrade of the already activated continuation,
acquisition-headroom and preflight-step policies. It rejects missing activation
receipts, changed published predecessor metadata, changed source functions,
missing budget rows and missing or disabled immutable source guards. A disabled
first installation is not supported by this migration.

Apply through the normal migration-ledger transaction after the composite
release checks. Preserve every existing enabled flag, fair-turn counter,
activation timestamp, release receipt and original journal. Update only the
changed scheduler/recorder hashes, the existing step scheduler key and headroom
scheduler hash. A separate `continued_original_hashes` field records the new
source, cleaned-original deadline and live-list deadline helpers plus the
property selector. Existing exact-count activation
manifests retain their shapes; their earlier activations are not replayed.

Tests use disposable synthetic sources and the captured actual acquisition,
property-selection and issued-decision functions. Required evidence includes the
old overdue-queue failure; three-request admission while two requests stay held;
same-original issuance and recording; deadline order across both continuation
families; two-of-three continuation and one-of-three ordinary progress;
concurrent single issuance and token-idempotent recording;
unchanged Pause, funds, source, cleanup, generation and unknown-receipt guards;
immutable deadlines; unchanged request counters and financial evidence; and
transactional migration rollback.

Observe ordinary production receipts after deployment. Passing these tests does
not establish that a provider completed an export or delivered contacts. An
original that already expired remains expired; this change grants no new
authority to revive it.
