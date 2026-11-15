# Receipt-backed progress comparison (inactive)

The live observer counts any positive-cost settlement at `settled_at` as recent
completed work. A call billed today after yesterday's dial, or a costed operation
that produced no result, can therefore hide a still-delayed account for another
30 minutes. This is a detection defect, separate from the PR746 preflight cause
repair. The earlier PR727 nine-operation boundary fix remains installed and valid.

`config/account-work-receipts-v2.sql` installs **private comparison readers**.
It does not replace the public observer or supply an activation function. It
checks the exact live observer and canonical source-helper definitions first.
The same controls, protected funds, quote boundaries, pending originals and
outreach-hours wait predicate are retained. No financial or operational rows are
written by the readers. Existing private export tables remain inaccessible to
`service_role`; a narrowly granted definer helper returns only exact-bound source
completion metadata. It does not expose raw paid receipts or broaden table grants.

| Original evidence | v2 interpretation | Time used |
| --- | --- | --- |
| Discovery result joined to its original account/operation and research rate | Completed research output, including a valid empty result | Original result `created_at`, with original request timing |
| Saved owner result joined to its operation and canonical source proof | Completed enrichment output; not unique people or completed outreach | Original saved-result `created_at`, or later original active-export `completed_at` |
| Recording joined to exact original voice job, operation, account and provider ID | Attempted call; recording failure remains distinct from a failed dial or human answer | Original `dial_claimed_at` |
| Outgoing message with provider ID and exact original `text:<messageId>` operation | Acknowledged outreach attempt; not terminal delivery | Original `dispatched_at`, explicitly a lower bound rather than acceptance time |
| Positive settled cost without source output or attempt | Financial evidence only | Does not refresh either work clock |

The private observer returns `last_completed_output_at` separately from
`last_attempted_outreach_at`. A recent attempt can be visible as
`recent_attempt_not_completed_output` while the `no_completed_work` finding
remains. It cannot clear an aged unresolved operation or manufacture completed
output. Human answers and verified terminal text delivery remain unknown in this
reader and require separate canonical outcome evidence. The original operation,
screening, job, recording, message and provider identifiers accompany the clocks.
Missing/invalid sources are not evidence of zero activity. The supplied timestamp
must equal the current transaction time. Past/future requests return no row;
current mutable source state cannot reconstruct historical as-of observations.

The canonical owner helper checks the saved result against its exact immutable
completed batch and paid receipt. Active exports additionally require the exact
export receipt, credit object and artifact hash, with finite finalization no later
than observation time. The normal save path stores contacts before finalizing its
export, so that later original finalization is the completion clock; both times
are retained. This comparison does not use an
old contact result as new contact authority, renew evidence, or dispatch outreach.

## Verification and release hold

The focused PGlite regression first reproduces the live observer's billing-only
false progress, then exercises the new comparison reader against the captured
production source functions. It covers the original nine holds, a costed failure,
late call billing with original dial timing, cross-account/provider mismatches,
text acceptance without delivery, research timing at 29:59/30:00/30:01, canonical
export proof and mismatched artifacts, Pause/membership/configuration/resume,
private permissions, unchanged evidence, prerequisite drift and install rollback.

The native PostgreSQL17 CI runner creates only its dedicated
`icash_receipt_progress_v2` database on the isolated loopback fixture service. It
checks 36 concurrent readers, generic plans, and 401 accounts with 80,000 settled
cost-only operations plus 10,000 historical rows in each of research, owner,
call and text sources (40,000 additional source-bound operations), within an
8-second query budget. Native CI, full CI/build and
independent review must pass for the exact proposed head. Local PGlite is not
native PostgreSQL or production performance evidence.

This patch is held and inactive. Before any live switch, review all consumers of
`last_completed_at` and the alert/UI vocabulary, compare source-backed v2 results
with current findings read-only under a bounded timeout, review retained unknowns
and performance, and record the approved definition hash, exact release and UTC
activation boundary. A later explicit activation/rollback patch is required; this
patch alone cannot change production health. Installation rollback is transactional
and leaves the public observer unchanged.

The frozen 363-account enrollment, `scripts/work-cohort.mjs`, and
`scripts/observe-work-cohort.sql` schema2 remain unchanged. New comparison results
must say `definitionVersion=receipt-progress-v2` and retain original source IDs.
They must not silently replace historical schema2 meanings, advance its chain,
re-enroll accounts, erase collection gaps or establish a continuous recovery streak.
No provider work is replayed and no recovery is proved by this detection change.
