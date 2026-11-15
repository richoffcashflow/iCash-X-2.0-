# Original expired-list ticket continuation

A resumed contacts ticket can encounter its original free list after the list's
30-minute validity window. Older handlers record generic `held`. The normal
selector excludes generic held tickets, so the already deployed targeted cleanup
handoff cannot reach this source even when request capacity returns. Funding,
clearing alerts and issuing new ticket IDs do not repair this state.

This change adds one independent maintenance lane. A default-disabled SQL policy
may return one exact original ticket to its existing bounded retry family after
checking its original screening hash, current ownership/configuration/membership,
available funds, source deadline, targeting, known free-list receipt, and the
existing complete `unstarted` evidence fence. All paid or uncertain operation
projections remain excluded. The ticket's ID, token, original retry deadline,
deferral count and completion history are retained. A private immutable journal
records the original ticket, list, configuration and rate. No provider request,
purchase, contact message, hold release or financial operation occurs here.

The journal captures a **current normal-admission ceiling**, not an inferred
historical price. A known lower ticket quote blocks continuation. Existing
recovery approvals remain excluded; the existing credit and spend triggers
enforce the new restrictive ceiling through final dispatch. Current normal
financial and recipient checks still apply to any later work.

An undeleted expired list still returns `cleanup_required`. Only a confirmed
canonical deletion permits the existing ordinary fresh-generation claim. If
global FIFO cleanup wins first, continuation verifies that original terminal
cleanup receipt and takes the same normal renewal path. Unknown cleanup results
remain held, and neither timestamps nor expired-list validity are extended.
The worker reads the journal before a fresh property preview. A persistent SQL
creation fence also blocks another fingerprint/generation before the original
canonical deletion, including when an older application version is running.
Both source protections remain effective after disabling new ticket repairs.

Selection checks at most eight eligible candidates for lock contention and
repairs at most one. An account advisory lock and shared budget lock serialize
against normal list claims, Pause and final financial admission. Row locks use
NOWAIT inside a per-candidate subtransaction, so one locked account can be skipped
without stopping another eligible account. Existing acquisition pacing and
provider request budgets own subsequent work.

## Deadline ordering correction

The original selector ordered by the free list's creation time. A newer list can
belong to a ticket whose original retry deadline is earlier. With one repair per
minute, that order can leave an otherwise eligible ticket unselected until its
deadline expires. The offline regression reproduces six missed deadlines in a
twelve-ticket synthetic cohort, even with every maintenance invocation succeeding.
The same cohort is feasible at the same cadence when ordered by deadline.

`20261115131828_owner_expired_ticket_deadlines.sql` changes only the candidate
order: first the earlier of the original ticket retry deadline and the original
list's 24-hour source boundary, then original creation time and stable IDs. It
retains the eight-candidate contention scan, one successful repair per invocation,
every eligibility and financial check, original deadlines and provider pacing.
This improves which eligible source gets the next slot; it cannot guarantee
completion before expiry when funding, consent, locks or provider capacity block
the remaining ordinary work.

The ordered migration requires the exact post-checking-overlay function hash
`dc82846a6166fefbd3fbe782035f0875` and verifies both complete policy manifests and
their guard triggers. Under the existing administrative advisory lock and shared
budget lock, it replaces the function and changes only that function's hash in
the two manifests. Enabled states, original activation release/time, all other
manifest entries, original rows and journals remain unchanged. The migration
ledger records the correction; it does not reactivate either policy. It also
supports a fully staged, still-disabled installation without enabling it.

The existing release controller must verify the current production predecessor,
exact canonical release and full/native CI before installing the correction in
its normal schema-plus-ledger transaction. Fresh readback also checks the
unchanged function owners, execution grants and private-table RLS, which function
definition hashes do not cover. All 21 other base-manifest functions remain
unchanged. The budget lock serializes journal effects; a caller already running
can retain the old ordering for that invocation. A failed ledger write rolls the
function and both manifest changes back together. Rollback still disables new
repairs under the shared budget lock and retains all source journals and caps.
Do not restore an obsolete function alone or extend deadlines to recover an
expired original.

Each authorized maintenance cycle also records one `owner_ticket_continuation`
event containing only an allowlisted status. `busy`, `held`, `idle`, `disabled`
and `continued` remain normal observed outcomes; `continuation_unavailable`
retains the existing failure health. The log contains no source identifiers or
receipts. A continuation event does not establish a new list, customer output or
account recovery.

Native validation includes real lock contention, separate 31-source waiting and
checking cohorts, and the existing 3,000-source waiting backlog regression. An
additional 3,000-source checking diagnostic exposed pre-existing proof-query
cost sensitivity: both the original FIFO selector and the corrected selector
can exceed the unchanged eight-second test deadline on a cold fixture. Paired
successful runs were comparable, but they do not establish a universal latency
bound. This correction adds no index and raises no database or provider timeout;
that larger checking-backlog limitation remains distinct from deadline ordering.

## Release order and verification

November 15 06:35 UTC staging checkpoint: the unchanged first migration
`20261115000614_owner_preflight_step_capacity.sql` is installed **disabled** under
production ledger version `20261115063438`; its SHA-256 is
`978e90303616e9fed5dfc18e69c920a66e0910d9d0654c85f941a7b8f10075af`.
The second migration failed with `23514` because its replacement stage constraint
omitted the previously installed `owner_preview_local_record_rejection_v1`
family. Its entire transaction rolled back; no second-stage objects or ledger
receipt were installed. All original rows remain unchanged.

The corrected second migration pins and locks the exact validated predecessor
constraint (`pg_get_constraintdef` MD5 `2fa5e4892ed35117f5520875b250bbe2`) and
retains all three old stages while adding only the expired-known-list stage.
The fixture preserves the observed 32 local-refusal, 50 early-cleanup and four
local-recorder-rejection rows using synthetic identities and receipts. Offline
and native rehearsals reproduce the old failure, verify immutable original
history, then resume the corrected second and third stages in separate
schema-plus-ledger transactions, including failed ledger writes.

After the corrected exact head passes fresh full/native CI and review, the
existing controller must resume at `20261115000635`, then `20261115002841`.
**Do not reinstall or edit stage one, delete old recovery rows, bypass the
constraint, or activate a partial installation.** Verify the actual first-stage
ledger receipt and unchanged disabled policy before resuming. This checkpoint
does not establish a live application deployment or account recovery.

1. Run the full exact-head checks, including the isolated native PostgreSQL job
   `test-owner-expired-ticket-postgres.mjs`. PGlite proves schema and behavior but
   does not prove real multi-session locks. The native runner is hard-bound to a
   disposable localhost database and makes no provider calls.
2. Rehearse installation and rollback. Install the SQL while its policy is
   disabled **before** deploying the maintenance caller. A missing RPC is an
   explicit maintenance failure rather than a reported recovery.
3. The existing release controller must verify the exact worker/web release and
   installed function/trigger identities. Coordinate with any new preflight
   claim migration before installation: its reviewed final definition must be
   the predecessor used by this patch, and both policies must freeze the same
   final definitions. Do not launch a second rollout.
4. Only the normal administrative release gate may call
   `icash_research_private.activate_expired_preflight_ticket_continuation(sha)`.
   Activation is one-time, rejects drift or disabled guard triggers, and is
   inaccessible to API roles. Ordinary maintenance cannot enable this policy.
5. Follow original ticket/list/operation IDs through naturally occurring work in
   the unchanged funded cohort. `continued`, successful deletion or a new free
   generation are not completed customer work or a confirmed account recovery.

Rollback takes the existing shared operating-budget row lock, then sets
`expired_preflight_ticket_policy.enabled=false`. Retain the activation metadata,
journals, original receipts and immutable financial caps. Do not revert repaired
ticket states, delete evidence, reactivate the same policy or bypass uncertain
operation holds. Application rollback retains the SQL creation fence and financial caps; an older
worker may remain held until original cleanup completes, but cannot create a
replacement list before canonical deletion.

Coverage includes the exact hidden-source boundary, known lower quotes, current
rate increases, direct credit/spend guard rejection, source/controls changes,
original expiry, uncertain and terminal cleanup, missing/corrupted manifests,
guard disabling, permissions and rollback. Native CI adds twelve simultaneous
workers, one-time activation, locked-oldest fairness, late Pause, concurrent
global cleanup and a blocked-source performance fixture.
