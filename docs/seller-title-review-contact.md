# Seller intake contact repair

The October 7 Redbud submission completed research but remained unassigned because limited contact admitted only `payoff_may_exceed_budget`, excluding `title_review_needed`. The same phone also had an older unresolved property reply that prevented a new ownership question.

Changes:

- Admit title-review holds to the existing single-match, 24-hour limited contact flow. Keep financial hold, offer authority, consent, wallet, daily allowance, suppression and account controls intact. Patch live functions rather than replacing VIP/any-market allocation with an old snapshot.
- Permit only the exact current ownership opener from a newly submitted, independently consented intake to cross an older routing hold. It cannot cross a newer ambiguous reply, send attachments, replay a delivered opener, or resolve/reassign old incoming messages. A bare yes still needs property clarification when several properties share a number.
- For a property-bound limited-contact reply, ask the fixed mortgage/title question once, acknowledge the answer once, then stop. No model request, offer, contract, fabricated payoff verification or automatic follow-up call. Immediate dispatch uses the existing authenticated webhook; an unclaimed message has bounded worker fallback.
- The limited-call prompt asks for clarification without asserting that a lien is unpaid or the balance is too high.

Validation: isolated actual SQL routing and limited-contact suites, including fresh-opener routing, idempotency, tenant boundaries, expiry, manual/STOP controls, fixed replies and worker ticket; actual webhook simulation; TypeScript; production webpack build. Financial/provider delegates in the routing simulation are stubs. These checks do not establish live delivery.

Release order: deploy the neutral limited-call prompt, then apply fresh-intake and limited-reply migrations, then the title-review contact admission. No historical message replay or permission renewal. Any old provider outcome remains unchanged.

Production verification: PR #43 merged as `0629c948a28f821d9b15959497c4f82da6d070bd`; deployment `dpl_4a7Q7ck6dr22gVMVcuW3fbTnJFcg` READY on both public domains. All three migrations applied. Service-only routine grants and table RLS verified; no new security warning or runtime error observed. Redbud assigned through the normal worker at 7:59 PM Central. Its live SMS delivery remains unverified; subsequent preparation reached the existing 8:00 PM Central contact-hour cutoff. The previous Arden recovery event was not replayed.
