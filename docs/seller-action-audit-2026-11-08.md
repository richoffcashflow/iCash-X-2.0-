# Seller action and disposition audit — November 8, 2026

The owner requested an audit of incoming texts, incoming and outgoing calls,
and missed automatic actions across acquisitions and buyer dispositions.
The reviewed 24-hour window ended November 9 at 02:15 UTC (November 8 at
8:15 p.m. Central). It contained seven incoming SMS events, including one
carrier notice, three recorded incoming calls and 223 saved outbound results.
Manual transcript review found about 20 apparent human connections, including
brief greetings and refusals; these are not 20 interested sellers.

## Confirmed failures and shared repairs

| Observed failure | Correction | Boundary retained |
| --- | --- | --- |
| “Remove this number from your mailing and contact list” was not an opt-out. “Wrong phone number” and “not for sale” could fall through. | Extend the shared SQL/TypeScript source-word policy. | Reported/negated statements, soft refusal versus permanent suppression, original evidence. |
| Bare “No,” “Naw” and “Sold” after a delivered ownership question became unrouted reviews. | Derive a scoped refusal from the exact last delivered ownership/interest question and apply the existing stop workflow. | No inference from a different question, an undelivered message, a manual message, or another account. |
| A text offer request waited on failed call attempts whose original terminal carrier receipts and costs had already settled. | Exclude only exact bound, settled terminal attempts from the active-call predicate. | Missing/mismatched receipts, contradictory started AI, unsettled costs and genuine active calls still block. No synthetic call-end timestamps. |
| “Please text me” after a call had no original SMS ownership opener. | A new source-bound channel handoff can prepare one ownership clarification using the existing deterministic dialogue lane. | Same account/property/number pair, actual finished call, prospective source cutoff, current contact/sender/financial checks and final admission. |
| Clipped English/Spanish voicemail instructions were counted as people. | Extend the derived response predicate and runtime classifier with parity fixtures. | Preserve ambiguous standalone speech, later real speakers, opt-outs and raw transcripts. |
| Outbound conversations inherited inbound wording and continued through menus/silence. | Add outbound direction and ending rules at the actual registration boundary; expand the existing recording-stop cutoff to menus/screeners and one unanswered check. | Frozen provider templates/hashes, bound stop capability, real-person pauses and end-call fallback. |

One audited text request was bound to a disabled sender. A reply preference does
not authorize changing numbers to evade that restriction. The repair gives
future eligible call-to-text requests a route; it does not resend that historical
message or renew its permissions.

The separate carrier-notice ingestion proposal remains PR #620. This change does
not enroll or silently copy that open work.

## Buyer, signing and title findings

No rows were waiting in the buyer reply progress ledger at review time. The two
old completed purchase examples both have explicit owner test-only buyer outreach
holds. Their title tasks were cancelled and no title requests were active. Those
holds are intentional and remain in place. Other saved signing envelopes require
actual counterparty/customer signatures or retain earlier review state; the bot
cannot supply another person's signature.

The existing supported-counteroffer, exact acceptance, agreement delivery, buyer
price/objection, original receipt, showing and title lanes are exercised by the
repository suites. A saved test agreement is not proof of a production buyer
closing, and offline verification does not claim one occurred.

## Verification and release

Focused SQL/TypeScript fixtures reproduce the reported opt-out and classification
misses, the settled-call false hold, and the missing call-to-text route. The real
reply observer cancels unstarted work while preserving dispatched/unknown costs.
Native PostgreSQL races cover 16 duplicate incoming events, competing recoveries
and final claims, concurrent Pause, and committed versus uncommitted terminal
receipts. The buyer dispatcher also reconciles the original late delivery once.
No paid provider calls, texts, contracts or historical negotiation replays are
part of verification.

Install only the four migrations in this change, in timestamp order, after
reviewing their predecessor guards. They are compatible with the existing
application's deterministic dialogue and offer contracts. Record their actual
production migration versions and verify definitions/ACLs afterward. The
voice-text activation timestamp is prospective and must never move backwards.
Clearing `voice_text_enabled_at` disables the new handoff, including final claims.
The other patches retain all original records; a rollback must not remove opt-outs
or resurrect cancelled outreach.

Enroll the reviewed same-repository PR in the established automatic release
queue. Application release remains pending until exact-head and exact-main
Reliability checks and the corresponding web/worker production receipts pass.
Prompt fixtures prove the actual registration payload, not live model compliance;
subsequent ordinary production transcripts must confirm the behavioral change.

## Production verification and remaining release gate

The four production migration receipts are `20261109025132` (source
classifications), `20261109025133` (terminal call progress), `20261109025230`
(voice-to-text continuation), and `20261109030031` (automated call evidence).
The migration service initially collided on its second-resolution version for
the third change after applying its SQL. Its receipt was registered only after
verifying both exact installed function hashes and the unchanged original
activation timestamp; the handoff was not reactivated or backdated.

Readback confirmed that the reviewed missed caller opt-out is now present in
both phone/text and contact suppression, without rewriting the saved transcript
or original result. Four latest, source-verified seller refusals were applied
through the existing stop workflow and their progress became `stopped`.
Recovery excluded later human messages and newer customer property-control
changes. No outgoing message or negotiation was replayed.

Both reviewed settled terminal attempts now return finished while their original
null call-end timestamps remain unchanged. The voicemail example no longer
counts as a human response, while a person discussing their own recorded message
still does. All three new helpers deny anonymous/authenticated callers and grant
only the service role.

The application change is committed locally. Automatic approval review rejected
the GitHub push, including after checking the existing release instructions,
because it requires explicit user approval for this repository publication.
No branch/PR publication or application deployment is claimed. Once that exact
push is approved, create the ready PR and continue the existing exact-commit
Reliability/release process; do not bypass it or resend historical negotiations.

Final local validation completed: all 810 suites in the full test invocation
passed. The additional list-quality suite introduced by the updated main branch
also passed separately. Focused source-disposition, negative-response, call
evidence, initial-reply, offer and actual call-registration tests passed, as did
TypeScript checking and the native PostgreSQL concurrency scenarios described
above. `git diff --check` is clean. These are local results; remote CI and
application deployment remain pending the publication approval.

The owner subsequently gave explicit approval to publish these fixes to
`richoffcashflow/iCash-X-2.0-` and complete the normal release checks. Publication
and production verification now proceed under that approval; the existing
exact-head, exact-main and production receipt requirements still apply.
