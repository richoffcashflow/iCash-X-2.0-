# Stalled-work recovery: staged rollout

This incident is open. A green build, fresh heartbeat, funding/resume event,
reconciliation ticket, or accepted message does not establish recovery.

The three reviewed migrations were installed on November 14 at 16:48–16:52 UTC
and retained in the server ledger as `20261114164824_stalled_work_boundary`,
`20261114165019_preflight_continuation_fairness`, and
`20261114165219_followup_step_checkpoints`. Repository filenames match those
receipts; their SQL bytes are unchanged. Do not reapply them. Detection is active;
both behavioral policies remained disabled on readback at 16:52 UTC. Exact-main
web/worker verification and separate activation are still required.

Independent review reproduced two pre-activation defects. A valid continuation
reuses its original ticket, so a ledger keyed only by ticket ID rejected its next
issuance. Also, a zero-due voice poll can mean a five-minute cooldown, while one
estimate batch can leave held or additional originals. Neither proves a complete
recovery step. Both additive corrections are now installed and read back. Keep
both policies disabled until exact-main web/worker verification succeeds and
their separate guarded activation completes. Do not rewrite or reapply successful
migrations.

The reviewed correction head `34926db9a2e754d8d3ef4175c3ed2e5fc7c91e96`
passed all six canonical CI jobs in run `43623984349`, including native PostgreSQL
atomic-ledger rollback checks. The first additive correction was then installed
as `20261114181243_followup_pending_originals`. Its repository filename now matches
that actual ledger receipt, with SQL SHA-256
`fd17b23acfadf1c120d1d15cdff5e01f49e31ec6d66a7f13d974b9ce1cc17fed`
unchanged. Independent readback at 18:21 UTC confirmed its stored and actual
pending-reader hash `290dd463df7fa763bace9c733ec6e5f6`, disabled follow-up policy,
null activation/release fields and zero follow-up attempts. Do not reapply it.

The second correction was installed on November 14 at 20:51:34 UTC as
`20261114205134_preflight_continuation_issuance`. Its repository filename now
matches that actual ledger receipt; SQL SHA-256
`abffb8e6a7ea28dcafe2d9d48ee8417ff686c0762ea358a4fc18105435c8c43b`
is unchanged. Readback at 20:52:05 UTC confirmed the non-null issuance token-hash and
recorder-hash columns, primary key on the fair turn, and unique original-ticket /
token-hash pair. The corrected recorder hash is `4743daa455436603b3bee5f31de43e15`;
the activation hash is `2b4b3dabfbaf7cca1b26cad71f1410a7`. Stored and actual
scheduler, due, recorder and pending-reader hashes match. The recorder and pending
reader remain service-role-only; application roles cannot activate either policy.
Both policies remain disabled, with zero issued turns, decisions and follow-up
attempts and null activation/release fields. Do not reapply either correction.

PR #727 merged as `8c77bfa18a160d9e356bb89da427750d66e59282`. Exact-main
Reliability run `43641484860` passed all six jobs, including 949 suites. At
21:24:46 UTC, Vercel production `dpl_AmFDBMcvc2KwDCuwAkBgBf2QDkwv` was READY
with the live domains, worker `226d0d00-08d3-48ad-bd13-ffe3f321868e` was SUCCESS,
and monitor `89ed53e8-0582-48e0-85e7-28f823e89eb9` was SUCCESS on that same SHA.
The monitor required one normal redeploy after an HTTP 403 prevented its first
GitHub verification; all release checks remained enforced.

Guarded continuation activation returned true at 21:24:54 UTC; follow-up step
activation returned true at 21:24:57 UTC. Readback at 21:25:08 confirmed both
policies enabled for the verified release, two natural issuance decisions and
four recovery-step attempts. Those receipts are not completed customer work.
The incident remains open pending actual source-bound output and outstanding
provider evidence. No original operations, controls or financial holds were reset.

The issuance correction used the supported migration runner's atomic SQL-and-ledger
transaction. Both correction files contain no top-level `BEGIN` or `COMMIT`: an
inner commit could persist schema changes before the runner records its migration
receipt. The installed `followup_pending_originals` predecessor and guarded
definitions were verified before installation. Never run these statements
separately in autocommit or replace successful migration receipts.
Native and PGlite tests force a late ledger insert to fail and verify that the
issuance schema, function and disabled policy all roll back. The earlier three
already-installed migrations retain their original bytes and ledger history.

The issuance correction preserves the original ticket and records each distinct
one-use token hash under its fair turn; identical acknowledgments do not advance
the turn. It also records only the current exact original preflight. The pending
reader requires the current consumed account-recovery lease and observes original
reserved/dispatched rows by rate family, independent of due time and conversation
availability. Unknown rates remain pending. Its definition hash is part of
activation, and a new operation's existing wake trigger preserves the next source
version even if it arrives after an older version's zero-pending observation.
Both additive corrections refuse already-activated/used policies. Their tests
cover repeated ticket issuance, cooldowns, partial batches, unknown rates, source
version races, private permissions and original financial evidence.

The application also prevents a new orphaned preflight when a validated owner
preview removes the issued ticket's primary property but retains eligible
siblings. Previously it created the sibling-only asynchronous list before
completing the original ticket as empty, leaving no matching continuation ticket.
It now returns empty before claiming a list or admitting a purchase. Existing
explicit zero-phone preview evidence is still saved, and eligible siblings can
receive their own ordinary primary-bound tickets. Regression cases cover a
zero-phone primary, a not-found primary, and the sibling's subsequent normal
pending deferral. Existing saved preflights, original recovery, financial holds
and historical orphaned lists are unchanged; this is prospective prevention.

The same incident release also isolates original accepted-message evidence reads
from current leased-number availability. Existing SQL identity/delivery gates,
attempt limits, historical follow-up fences and financial holds remain unchanged.
See `docs/original-text-receipt-evidence-2026-11-14.md`.

## Current evidence

Read-only production observations on November 14, 2026 at 14:34–14:47 UTC:

* Production health returns 503 with fresh maintenance and worker heartbeats.
* The dated enrollment contains 363 positive-wallet accounts with live credited
  funding. Membership, Pause, available funds after protected holds, configuration,
  contact freshness and hours are separate eligibility dimensions, not exclusions
  silently removed from the cohort. Preliminary monitor flags are not a count of
  confirmed preventable stalls.
* The existing monitor misses overdue original operations in the contact/search
  quote gap. The private audit identified 71 candidate accounts at that boundary.
* In the preceding 24-hour message creation window, 650 messages reached provider
  acceptance, including 77 with delivery confirmation; 573 remain accepted only.
* There are 1,971 ready unsent messages across history; 1,652 use disabled senders,
  1,941 have expired operational-contact eligibility, and 1,623 have screening
  older than seven days. These categories overlap. Some other authority families
  have no operational-contact screening and require their own checks.
* Canonical receipt reads include top-level `delivered` responses whose tracking
  ends at `delivery.awaiting_confirmation` or `numbers.delayed`. Do not upgrade
  those records to delivered. Unleased old sender identities remain unresolved.
* Recording failures include provider call IDs; `ended_before_recording` must not
  be classified as an unattempted dial or automatically redialed.

Customer IDs and private original receipts belong in the retained private audit,
never this public repository. Requery these figures before each operational action.

## Stage 1: independent detection

`config/stalled-work-boundary.sql` changes only the captured observation function
at MD5 `37f703a603daa4dd5e15ae049a15a71a`. A 30-minute-old unsettled original remains
visible when there has been no recent work, including available balances between
the contact and search quotes. Recent independent output, Pause, membership,
cancellation, configuration and initial grace retain their existing boundaries.
`pending_work` means unresolved original work, not proven failure or permission
to replay. This patch does not repair the underlying operation.

Run the focused boundary suite, all tests, build and isolated native PostgreSQL
job. The native job executes captured production function bodies and schema
fixtures, checks service-role permissions, concurrent reads and rollback.
Production is never the rehearsal database. Apply only after that exact head has
passed its full checks and review. Read back function/ACL evidence afterward.

Rollback restores the captured `observations` definition in
`tests/fixtures/stalled-work-production-20261114.json` only if the installed body
still matches this patch. This restores the known detection gap, so preserve the
private incident cohort and unresolved findings; do not clear account states.

## Stage 2: continuation fairness, disabled first

`config/preflight-continuation-fairness.sql` installs an inactive policy. The
existing scheduler already uses durable tickets, exact source hashes, original
operation fences, bounded scans and an operating-budget lock. This change gives
valid continuations two selection turns followed by one ordinary-work turn, with
fallback when the preferred class has no eligible work. Existing age, starter
priority and account ordering remain within each class.

The fair turn and append-only decision commit with the original ticket issuance.
An interrupted transaction rolls back both. Competing workers serialize through
the existing budget lock. Ordinary work cannot be starved by an endless stream
of continuations. Failed/no-work selections do not consume a turn. Independent
screening, voice, messages and recovery pools keep their existing dispatch paths.

The due predicate, original waiting creation+30-minute rule, existing positive
check window, three-request gate, pacing headroom, minute/day caps, final request
admission and spending limits remain unchanged. No retry deadline, provider list,
receipt, contact permission or original operation is rewritten. Expired lists
remain a separate cleanup/reconciliation queue; retryable tickets do not revive
them. The prior local incident patches were not available in the mounted
worktrees or current incident branches; captured production bodies are the
guarded baseline here.

After exact-head native fairness/concurrency/cost/permission/performance tests,
full CI, review, main-push CI and exact web/worker production verification:

1. Install disabled and verify the scheduler and due hashes stored in
   `icash_work_private.continuation_policy`; verify all other gates are unchanged.
2. Activate using `icash_work_private.activate_continuation_fairness(<exact main SHA>)`
   from the authorized migration connection. An application role cannot activate.
3. Observe naturally due, source-bound continuations and ordinary work. Follow
   original preflight/ticket/operation IDs through actual output and settlement.
   A fair issue receipt alone is not completed customer work.
4. On unexpected cost, unfairness, repeated preflight refusal, source mismatch or
   scheduler latency regression, lock `icash_operating_budget` and set this policy
   `enabled=false`. Keep its decisions and all financial/provider evidence.
   The one-time activation refuses accidental reactivation after rollback.

## Stage 3: durable independent recovery steps

`config/followup-step-checkpoints.sql` installs inactive per-step recovery history.
The matching handler records a durable claim and terminal observation for estimates,
voice receipts, customer updates and attention. Each service gets its own bounded
deadline. Completed steps survive a lost acknowledgment and replacement ticket;
only unfinished safe recovery runs again. Receipt polling with outstanding holds
does not mark its checkpoint complete. Every primary call, message, purchase and
financial hold remains governed by its original source-bound service.

Native tests must prove competing claim exclusion, process interruption, stale
worker refusal, identical finish acknowledgments, private permissions and rollback.
The synthetic end-to-end customer recovery journey crosses the actual handler and
database checkpoint RPCs; provider fixtures cannot establish live delivery.
After exact production versions are verified, activate through
`icash_work_private.activate_followup_steps(<exact main SHA>)`. Observe natural
recovery step receipts before broader rollout. Roll back by disabling this policy;
keep every attempt and original operation. Existing receipt triggers still wake a
new source version, and existing bounded failure cooldowns remain authoritative.

## Fixed cohort observations

The private November 14 baseline freezes membership. `scripts/work-cohort.mjs sql`
renders `scripts/observe-work-cohort.sql` for exactly those accounts, including
accounts that later pause, leave membership, run out of funds or disappear. Run it
read-only through the authorized database connection. `append` accepts the results
and creates a new exclusive, hash-linked private observation; it refuses a changed
cohort, a duplicate/older observation or altered prior history. Persist every new
observation, never replace its predecessor. The collector retains original
operation/message/provider IDs, source content hashes, work timestamps and outcome
states without copying message text into the report. Provider evidence stays in
its original immutable receipt ledgers.

The November 15 collector optimization preserves the schema-2 query evidence and
classification. A non-executing production plan showed two full voice-job history
scans per cohort account. The collector now materializes only fixed-cohort voice
jobs in the exact union of the original creation/update/dispatching windows, then
groups the two original projections once. Recording selection still requires the
same account, job, operation and null-safe provider-call identity, with the same
creation-time/ID ordering. Missing accounts retain their original evidence; absent
voice counts remain null and absent receipt arrays remain empty. There is no
database migration, public-observer replacement, timeout increase or change to
outreach, admission, charges, policy activation or the inactive PR753 comparison.

`tests/work-cohort-query.test.mjs` executes the captured predecessor and optimized
queries against the same synthetic 363-member snapshot, including 12,000 old voice
jobs, recent and outside-cohort jobs, both inclusive time boundaries, dispatching
jobs, missing accounts and contradictory recording identities. Complete evidence
rows and observation hashes must match. Its executed plans require the original
726 voice-history scans to become one. This verifies query equivalence and bounded
scan shape; it does not establish production latency or customer recovery. The
original 20-second read bound and append-only missing-observation history remain.

Read-only production verification at `2026-11-15T19:42:53.546002Z` evaluated all
363 members and every original evidence field within the unchanged 20-second
bound. The compact verification returned in 12.4 seconds including transport,
with 184 research receipts, 2,057 call receipts and 8,673 text receipts. It hashes
the full evidence rather than pruning its expensive projections. An earlier full
row transfer ended with `Transport closed`; therefore this check establishes
bounded database evaluation, not successful full-observation delivery or a new
observation in the historical chain. Do not fill the collection gap from this
compact check or infer customer recovery from it.

Missing observations, unknown eligibility, unverified answers and proven-preventable
stall counts remain explicit. `needs_investigation` is not a confirmed preventable
stall. Calling hours are a channel-specific condition, not an excuse to block
independent research. Funding, resume, reconciliation, issue receipts and cleared
alerts are not output. Query and review every cohort member; prioritize those with
little or no original output. Hourly observations are sampled evidence, not proof
that no short interruption occurred between observations.

## Remaining recovery gates

* Reconcile every uncertain operation by its original key and provider evidence.
  Missing receipts imply unknown cost/outcome. Do not free holds, mint bypass IDs,
  replay calls/texts/purchases, or treat reconciliation alone as completed work.
* Refresh unsent outreach only through the current source-bound refresh workflow:
  ownership, phone, national eligibility, consent/opt-out/suppression, fresh
  financial screening, customer/system budget, quota, hours and sender readiness
  must all pass. Its enabled policy is not proof the old queue can safely resume.
* Established sender continuity requires verified ownership and service readiness
  for the existing identity. A replacement needs an explicit audited continuity
  design and review; no silent rotation or accepted-message test resend.
* Keep active and historical unresolved health findings visible and account for
  overlapping accounts. Retain the same enrolled accounts when funds, membership
  or consent change; record intentional waits and unknowns in each dated snapshot.
* Support PR #725 remains held until its corrected exact head passes all checks
  and review. Its failing clarification assertion was reported to the existing
  owner on the same PR. Support deployment is separate from this incident.

## Sustained verification

Keep append-only dated snapshots with original work/receipt IDs, source hashes,
eligible-stage conditions and explicit unknowns. Prioritize accounts with no or
little receipt-backed work. Report genuine stalls separately from intentional
waits and unknowns; calls must distinguish queue/claim/provider ID/verified answer,
and texts must distinguish ready/accepted/confirmed/failed/unconfirmed.
Compare the fixed cohort over multiple weeks, retain missing observation periods,
and never infer a continuous zero-stall streak from intermittent snapshots.
