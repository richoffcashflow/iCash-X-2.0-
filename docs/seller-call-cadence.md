# Seller call invitations and runtime speaking cadence

## Scope

Prospective application-only change. No database migration, provider setting write,
new calling authority, historical conversation replay, or paid development test.
Frozen provider prompts, reviewed hashes and timing settings remain unchanged.

## SMS behavior

The deterministic seller offer lane can offer a call once after actual ownership
and selling interest are established, while qualification is still incomplete.
The exact existing callback question is reused so immediate and later availability
continue through the established source-bound callback workflow. A question about
price is answered before another qualification step; it does not fabricate a price
or ownership. SMS continuation does not require a phone-availability question.

The invitation additionally requires current account voice choice, an available
seller conversation context and an account/screening/phone-bound current seller
voice permission. Missing, disabled or failed reads retain the ordinary SMS step.
The flag in an input context is not trusted by the service. A call preference is
not a booking, and final request, hours, consent, wallet and provider checks remain
with the existing callback dispatcher.

Previously attempted call questions, a text preference, acceptance or a prepared
cash quote prevent another invitation. A bare yes to the invitation asks for the
missing time; it never dials. A bare no to the optional call question keeps the
text conversation moving. Explicit refusal or STOP keeps the original review and
suppression behavior. Unknown message or active-call receipts retain their holds.

A bare “Sold” that reaches the planner is clarified rather than promoted to
ownership or acceptance. An upstream source-bound decline, including “Sold” to
a verified delivered ownership question, still stops admission and cannot be
reopened by this clarification or a later price question. An explicit completed-sale
statement stops the pitch. A later explicit correction can resolve planner-level
ambiguity only when the original admission checks allow continuation. Prior source
messages and delivery evidence are not edited. Regression fixtures use fictional
names, addresses and identities.

## Speaking behavior

A compact idempotent runtime guard covers ordinary outbound sellers, outbound
intake, matched inbound sellers and inbound intake. It directs the assistant to:

- Answer first, ask one necessary question, and wait.
- Let names, amounts and dates finish.
- Yield to interruptions, answer the correction, and resume only unfinished content.
- Clarify incomplete details without restarting the pitch.
- Keep required disclosures and exact terms complete.
- Treat silence and brief acknowledgments as neither consent nor acceptance.

Limited-contact and cancellation calls, inbound buyers and unknown callers keep
their existing scoped behavior. Buyers retain the required complete opening terms.
AI identity stays truthful. Duplicate runtime wording is compacted to preserve the
existing 24,000-character cap and whole saved-history exchanges; frozen policy
constants and price/contract authority remain unchanged.

## Verification and release

Focused offline checks: `seller-call-invitation`, `seller-call-cadence`,
`seller-offer-qualification`, `seller-caller-identity`, `live-dispatch`,
`buyer-voice-policy`, `buyer-scenarios`, and `recording-agent-comparison`.
The two new suites are included in the release selection; the aggregate runner
discovers them normally. Run the existing `seller-text-offer` database integration,
full type check, aggregate/release selections and normal build on the final commit.

String and deterministic transcript tests establish policy assembly and decisions,
not perceived voice quality, model adherence, latency or provider interruption
performance. Saved authorized audio should be assessed separately. New paid calls
remain disabled unless separately authorized with a concrete enforced spending cap.
Only exact-head successful CI and verified web/worker deployment establish release.
