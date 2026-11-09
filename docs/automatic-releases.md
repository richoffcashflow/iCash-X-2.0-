# Automatic iCash X releases

On November 4, 2026, the owner approved the practice workspace update and requested automatic releases universally for completed iCash X work. This is standing authorization to finish reviewed, requested changes through production without another routine “approve” or “ship” message. It does not turn unfinished or previously held proposals into release candidates.

## Register completed work

The implementing agent completes the requested scope, reviews the final diff, runs relevant local checks, and resolves any database, provider or coordinated-release prerequisites. It then applies `auto-release` to the ready PR under the owner's standing authorization. Do not wait for the owner to repeat approval merely to add this label.

The owner's November 9, 2026 UI-preservation instruction also applies to automatic releases: keep the existing interface unless the owner explicitly requested the specific visible change. Review each candidate against the current UI baseline in `AGENTS.md`; broad improvement, support-repair or shipping authorization does not permit a redesign or added UI. Restore accidental UI regressions to the approved baseline.

Candidates target `main` in `richoffcashflow/iCash-X-2.0-`, are authored by the verified owner `richoffcashflow`, are from this same repository, are not drafts, and were created on or after November 4, 2026. PR #561 is the initial explicitly approved candidate. Future changes use the same path. Do not label historical held candidates without separately established scope and readiness.

The label is a release-queue marker, not a substitute for review or test evidence. Reassess a changed head. `release-hold`, an unresolved requested change, an incomplete prerequisite or a failing check stops that candidate. Remove the hold only after its actual cause is resolved. Preserve unrelated work and other agents' releases.

## Release controller

The enabled **Automatic iCash releases** background task checks hourly, including after the implementing conversation ends. It uses the existing GitHub and hosting integrations; no new workflow credentials or repository security changes are required. This hourly continuation is distinct from the existing Git-triggered deployment, which starts when a merge occurs.

For each eligible candidate:

1. Read the current PR, complete diff, reviews, current main and relevant release instructions. Confirm scope and prerequisites.
2. Require the latest canonical **Reliability checks** run for the current full head SHA to finish successfully, including all required jobs. A successful Vercel preview does not satisfy this gate.
3. Re-read the head, then perform a normal merge with `expected_head_sha`. Serialize release progress and preserve an independent rollout already in progress.
4. Allow the existing Git integration to build production. Require successful checks from the latest **main push** workflow for that exact production commit. Do not promote the preview or bypass `verify-production-release.mjs`.
5. Confirm the production target, commit, READY state and applicable live aliases. Verify an affected Railway service when worker runtime/configuration changed; UI-only work does not require a worker restart.

Only receipt-backed production verification means “live.” An open PR, a merge, an issued deployment, queued work or a healthy worker heartbeat alone does not.

## Continue delayed releases

Queued CI or hosting work stays pending for the next run, without another approval request or repetitive waiting notifications. The existing production gate waits twenty minutes for CI. If that exact timeout is the only deployment failure, the matching main-push checks subsequently pass, and the intended commit has not been superseded, the controller may perform one normal provider redeploy for that production commit. Inspect earlier attempts first; preserve all gates and do not duplicate an unknown mutation.

A substantive failure requires a fix and fresh checks. Never deploy an older commit over newer main, infer that migrations ran from a green PR, or install unreviewed SQL to make a deployment pass. Preserve ordered migration receipts, compatible web/worker releases, explicit customer controls, original provider evidence and all paid-development-test restrictions.

Report a newly verified release or a concrete blocker that requires the owner's action. No billing changes, credit purchases, paid demonstrations, customer messages, deployment sharing or unrelated permission changes are part of automatic release.

## Stop or pause

The owner can pause the background task. A `release-hold` label excludes an individual PR; draft status or removing `auto-release` also withdraws it from the automatic queue. Existing provider and repository release protections remain in force.
