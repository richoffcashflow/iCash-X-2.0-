# Seller recovery and conversion learning

This release repairs the 17 failures reproduced by the October 9 seller audit and adds a durable recovery loop to the existing call, SMS, signing and viewing workflows. It does not replace the underlying contact, financial, signing or billing authority. Implementation and local verification are complete. The recovery migration was applied to production on October 9, 2026 as version `20261009223901`; all seven message variants remain disabled until the matching application release is live. PR #135 is merged and its preview is READY. The production worker successfully deployed the merged seller code; application deployment remains held by the shared buyer voice release gate. Follow-up migrations `20261009224932` and `20261009225857` preserve eligible cases while recovery is paused and prevent replayed signing callbacks from falsely crediting a later recovery.

## Repairs

| Situation | Result |
| --- | --- |
| “Please stop,” “Stop please,” “Leave me alone,” or STOP mixed with a callback | Shared SMS/voice interpretation. Authenticated inbound call history also records phone suppression using the existing cross-channel stop trigger. |
| “Not now, call me tomorrow” | Preserve the callback request; request only missing scheduling details. |
| Earlier price acceptance followed by hesitation, denial, or another decision-maker | Invalidate transcript acceptance. Recheck current conversation evidence immediately before contract preparation. |
| “No, there is a lien,” unpaid taxes, or a qualified debt denial | Keep the amount unknown and the debt review pending. Do not convert it to zero. |
| “I do not owe anything” | Recognize an unambiguous zero mortgage report, still unverified by title. |
| Contradictory listing and representation statements | Ask for clarification before treating the property as unrepresented. |
| Unclear or canceled viewing time followed by an exact replacement | Recover to the complete new window. A bare correction invalidates the old window and requests clarification. |
| Seller offers an unconditional lower asking price | Bind the whole statement to the current call; generate a fresh proposal within the ceiling. Screen debt at that actual price. Require a fresh exact-price acceptance; never increase a saved price automatically. |
| Additional owner or unsupported contract change | Preserve a call-bound review case with the unresolved reason. Multi-signer agreements still require the existing verified signer/template workflow. |

## Runtime algorithm

1. **Observe verified events.** SMS analysis states, completed outbound calls, completed bound inbound histories, tool failures, buyer viewing requests, delivery receipts, verified purchase signatures and confirmed title milestones write durable cases or outcomes. Capture is idempotent. Practice deals and cross-account scopes are rejected.
2. **Choose a next action.** STOP and explicit human/decline signals take priority. Questions without a supported answer can receive one approved clarification. A model/provider failure is an internal reconciliation case, not a request for the seller to repeat their answer. Ownership, title, legal, financial, callback and uncertain-delivery cases remain visible for review.
3. **Recover with existing authority.** No-response cases wait 24 hours and then may queue one text asking whether to continue. Scheduled callbacks take priority. The existing automation dispatcher processes a `seller_recovery` text ticket. Current consent, property binding, account pause, contact suppression, quiet hours, active membership, actual usage billing and zero-balance admission remain in the final dispatch path. No new outbound buyer call path exists.
4. **Stop stale or repeated work.** New incoming messages, normal replies, changed stages, STOP, changed viewing options, disabled variants and expired cases invalidate old recovery sends. There is at most one recovery per thread in 24 hours, one of the same reason in seven days, and three total in seven days. A second unanswered clarification becomes review. Uncertain provider sends are never replayed automatically. Cases expire to review after seven days.
5. **Measure actual outcomes.** Recovery assignments retain account, opportunity, reason, stage, original channel, variant and delivery ID. Delivery, response, opt-out, verified purchase signing and confirmed closing are separate timestamps. A reply or verbal promise is not a conversion.
6. **Improve within the approved playbook.** Variant selection is fixed for a deal/reason/stage/channel. Comparable cohorts use distinct opportunities and delivered messages aged 30–180 days. Both variants need at least 100 delivered opportunities and five verified purchase agreements within 30 days before contract outcomes can shift allocation. The stronger smoothed contract rate receives at most 60% allocation against a 50/50 baseline. An arm with at least 100 distinct delivered opportunities and an opt-out rate above 5% is excluded. Sparse cohorts continue balanced exploration. This is bounded experimentation, not proof that a variant caused a conversion.

The learning loop chooses only versioned, approved message variants. It does not write arbitrary new answers, change the price formula, invent facts, modify contracts, increase spending authority or deploy code. Novel unanswered questions and owner resolutions form an evidence-backed improvement backlog. High-impact new answers need verified facts and a tested handler before they can be automated.

## Viewing coordination

A saved buyer viewing request can create one shared seller-availability case, including a viewing request saved alongside an agreement or reported payment. Multiple buyers reuse the outstanding seller request. When exact seller windows exist, a deterministic text can relay at most two dated AM/PM options to the buyer. The final dispatch checks that both the buyer request and seller windows are still current. No access codes or raw seller messages are copied to buyers.

The buyer request remains `needs_confirmation`; relaying options does not book a visit. A selected window, occupant/access requirements and final coordination remain in the existing viewing review workflow. Requests without current seller/buyer contact authority remain there as well.

## Owner experience

Unresolved seller cases appear in the workspace's existing “Needs your review” section, with the exact source quote, a next step and a resolution field. Resolution requires the signed-in account owner and the current case version. Saving a resolution records the outcome; it does not send a message, unpause a contact or manufacture missing authority. Unsent resolution drafts participate in the existing navigation warning.

## Verification

- Original executable seller audit: **100 passed, 0 gaps, 0 errors**, compared with 83 passed and 17 gaps before repairs.
- New isolated PostgreSQL migration suite: **41 scenarios passed**, including source capture, idempotency, stale-message rejection, STOP, quiet hours, zero balance, unknown delivery, source-channel/tenant isolation, learning promotion/rollback, owner resolution and seller-to-buyer viewing relay.
- **39 focused test suites passed**, including actual offer/contract route bodies, grounded lower-price proposals, final acceptance, account activity pagination, contact policy, recovery review authorization and the latest buyer scenario/privacy changes.
- Existing seller conversation (123 scenarios), seller response and buyer purchase SQL suites passed separately with their documented fixture delegates.
- Local production-mode Next build and TypeScript passed. No live sellers/buyers were called or texted and no signing request was sent by this verification. The production migration was applied with sending disabled; a rollback-only synthetic database check passed event capture, cross-account rejection, owner-only resolution, stale-version rejection and no outbound message creation. Production readback confirmed RLS and service-only table/function access.
- After integrating main (#134; later reconciled through #137), the broad `pnpm test` run stops at `contact-channel-admission.test.mjs`, which still expects the retired account daily spending cap to block admission. That test and its readiness implementation are unchanged from main. A separately checked old static copy assertion in `workspace-view.test.mjs` also remains stale. Product behavior was not changed to restore obsolete expectations.

The latest integrated release also passed the 100-case seller audit, all 41 recovery migration checks, buyer SQL integration, standard contract signing, seller policy, agreement route, buyer scenario and buyer voice policy tests. The shared production provider audit v3 passed 19 of 30 conversations and remains a release blocker; its immutable results and required build gate are preserved. The later v4 provider audit also failed (20/30), including one seller delivery-failure dialogue; the candidate remains inactive.

Tests execute the shipped recovery migration with synthetic data. Older consent/billing/provider dispatch functions are explicit fixture delegates in the new SQL suite; their existing suites cover those separate boundaries. Local passing tests do not establish real-model dialogue quality, live carrier delivery, live provider latency or an actual conversion lift.

## Rollout

The release-pause regression was reproduced before the follow-up fix: disabled variants incorrectly moved an eligible open case to manual review. The new check proves pause leaves it open without an attempt, and re-enabling approved variants resumes the same case. Production had no captured cases when checked, so no records required repair. Migration `20261009224932_seller_recovery_pause_preserves_gaps.sql` was applied with all seven variants still disabled.

1. Apply `20261009223901_seller_gap_recovery_learning.sql` after the current buyer scenario/privacy migrations and before the application change. It is transactional, creates private/RLS-protected storage, revokes client execution of internal functions, and performs no provider calls or historical outreach backfill. Message variants start disabled, which also holds viewing relays during rollout.
2. Deploy the application commit together with the existing automation worker and refreshed seller voice guidance. The new recovery kind requires `ICASH_LIVE_WORK_READY=true`; the SMS-only release flag does not independently enable it. Existing financial/contact gates still govern each attempt.
3. Verify the first synthetic account case through capture, queue, final claim, receipt and review UI before admitting real recovery work. Verify the authenticated provider callbacks and actual Supabase privileges in the deployed environment. Enable the seven reviewed variants only after the application and full live-work gate are ready.
4. Observe delivery/unknown rates, unresolved cases, opt-outs, signatures and closing outcomes separately. There is no claimed conversion improvement until live evidence matures.

To pause new recoveries without disabling ordinary work, an authorized database operator can disable the approved recovery variants and hold pending `seller_recovery` tickets. Final claims then reject queued recovery templates. Do not reset an uncertain provider operation or delete its receipt. Retain the migration when rolling back application code so saved cases and evidence remain intact.

The signing-replay regression also failed before its fix: repeating an already-completed purchase callback attributed that old signature to a subsequently delivered viewing follow-up. The trigger now ignores completed-to-completed updates; new verified signing events still count. Migration `20261009225857_seller_recovery_signing_replay.sql` is installed.

The positive-credit regression failed when a legacy reservation exceeded a positive wallet balance. Migration `20261009230421_seller_recovery_positive_credits.sql` makes both seller-recovery and viewing-relay scheduling require a positive balance, without subtracting old reservations. Completed usage remains billed by the existing dispatch path; zero-balance, consent, quiet-time and suppression checks still pass.

The shared `inspect-buyer-scenario-guardrails-20261009.mjs` now reads the exact completed v5 synthetic invocations without new tests, provider mutations or changes to acceptance results. Its saved evidence reports no guardrail events in the inspected failed cases, while several dialogues call get_offer seven times and repeat full terms. The v5 run failed 8/30; its candidate remains inactive. The required release gate is preserved.

## Local commands

```sh
node --experimental-strip-types scripts/audit-seller-scenarios.mjs /absolute/path/to/pglite/index.js /tmp/seller-scenarios.json
node --experimental-strip-types scripts/test-seller-recovery-pglite.mjs /absolute/path/to/pglite/index.js
node --experimental-strip-types tests/seller-recovery-policy.test.mjs
node --experimental-strip-types tests/seller-recovery-route.test.mjs
node --experimental-strip-types tests/live-agreement-route.test.mjs
node --experimental-strip-types tests/workspace-activity-route.test.mjs
pnpm exec tsc --noEmit
pnpm build
```

`build:verified` includes live provider/owner tests and configuration operations. It is not the local verification command for this release.
