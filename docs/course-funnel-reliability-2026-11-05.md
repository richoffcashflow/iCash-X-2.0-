# Course funnel reliability, November 5, 2026

The owner supplied the course transcript and requested efficient automatic work
from seller conversations through buyer assignment and title/closing. The course
describes research, qualification, negotiation, signed purchase, buyer outreach,
visits, assignment, deposit, title coordination and proceeds. A customer can take
over and explicitly return work to the bot. The raw transcript and its personal
details are not included in the repository.

## Reproduced and repaired

| Trigger | Previous behavior | Current behavior |
| --- | --- | --- |
| Seller answers “No” to a delivered cash proposal | Repeats the proposal | Asks the seller's price; a counterprice receives a fresh proposal and requires fresh acceptance |
| Clear refusal, contact restriction or review request enters deterministic offer planning | Could continue the pitch | Applies the existing source-word response policy and clears acceptance |
| Customer edits terms after the buyer assignment claim | Signing could adopt the newer unaccepted terms | Claim returns the exact locked document; existing signing hash checks reject any later change before provider creation |
| Earlier deal already has title sent, lacks a verified closer, or has an old unresolved delivery | Consumes the batch's title opportunity | Scans the bounded batch for another eligible deal while leaving the original hold intact |
| Current title delivery returns unresolved or configuration/review failure | Journey can report successful processing | Reports the fixed title-delivery diagnostic and truthful title counters |
| Customer cancels, dismisses or finishes a title task during PDF/email I/O | Late failure overwrites that decision | Saves delivery uncertainty separately and changes task state only if still scheduled |

Each batch still advances at most five journeys, claims at most one assignment,
prepares at most one new title package and dispatches at most two journey messages.
An uncertain current provider attempt consumes its slot and is never retried.
Previous title holds can be skipped only before document preparation; malformed or
unexpected results retain the slot. No new provider loop or background poll exists.

## Scenario evidence

- `course-seller-scenarios.test.mjs`: 2,165 combinations of value, repair cost,
  payoff, delivered/accepted/failed receipts, refusal, opt-out, ordinary and
  conditional acceptance, counterprice, net proceeds and changed property facts.
  Also replays the course-shaped $175k value / $28k repairs / $92k proposal through
  identity, ownership, closing date, inspection, readback and agreement permission.
  Uses actual offer planning with synthetic source and receipt fixtures.
- `seller-text-offer.test.mjs`: real SQL source/resume/save/final dispatch and
  receipt loop verifies “No” -> counterprice question -> $90k -> fresh acceptance,
  alongside existing contract, tenant, Pause and receipt scenarios.
- `buyer-assignment-snapshot.test.mjs`: original production claimant and wrapper,
  additive migration, 24 blocking conditions and six post-claim document edits
  against the actual signing-service comparison. Dependencies outside the claim
  are explicit disposable fixtures, not simulated proof of provider delivery.
- `test-buyer-assignment-snapshot-postgres.py`: native PostgreSQL CI races 16
  duplicate claims and 16 competing buyer claims; holds real locks across
  before/after customer edits and checks private execution privileges.
- `funnel-followthrough.test.mjs`: 26 service fault cases, including malformed
  snapshots, title fairness/attempt limits and cancellations at both PDF and email
  boundaries. `title-service.test.mjs` verifies existing holds never resend.
- Existing suites retain viewing coordination, buyer qualification, non-refundable
  deposit confirmation, title replies, closing blockers and received-proceeds
  verification. New fixtures do not replace those gates.

These are offline simulations and database checks. No development seller/buyer
messages, title emails, calls, paid lookup or signature submission were performed.
TypeScript and the complete offline suite are required, followed by all canonical
Reliability checks on the exact PR head, including native contention and browser
checks. A successful provider email response is not proof that title opened.

## Compatible database prerequisite

`config/buyer-assignment-terms-snapshot.sql` is paired byte-for-byte with a CLI
generated migration. It updates only
`icash_claim_journey_assignment_before_completion(uuid)` after checking the exact
predecessor definition hash `4dcbb00b25643248c6cffe3648dc5e48`. It retains locks,
admission conditions, permissions, ownership and search path. The added
`expectedTerms` field is compatible with the prior application. Install it before
the new application, which refuses an assignment claim without its snapshot.
The expected resulting definition hash is `8fd1f8fc78b3ba9e7e5829c4cdebf652`.

Never run a blanket database push. Inspect the exact production function and
migration receipt, then verify the exact-main checks and production deployment.
Application rollback remains compatible with the additive database field; do not
rewind consumed signing or title claims to manufacture recovery.

## Live evidence boundary

The read-only production snapshot during this investigation had eight live owner
purchase envelopes (two completed), one owner closed journey, no customer
envelopes/journeys, and no title requests, closing updates or journey messages.
Those aggregates do not establish an end-to-end customer closing. Owner examples,
accepted messages, signed documents, verified deposits, title acceptance and
received proceeds remain distinct facts. A new ordinary customer deal must supply
each real receipt before its outcome can be counted. This release does not remove
financial eligibility, unknown-cost holds, contact authority, manual takeover or
explicit customer Pause in pursuit of speed.
