# Seller source authority reconstruction

This source change restores the seller authority work lost from the paused workspace. It depends on the receipt-time canonical context, raw call-source completeness migration, and atomic agreement admission migration. It is not an activation or production repair record.

- Contextual short answers use the actual last question. Earlier acknowledgments do not become payoff, repair, listing, price or identity questions.
- Raw whole-source stop, human, review and explicit material-change statements remain typed holds through canonical memory, call qualification, SMS planning and direct agreement preparation. Later generic qualification or Yes cannot clear them. Baseline debt/repair answers remain in ordinary calculation paths; negated, reported, hypothetical and question-only material statements do not become persistent change assertions.
- Unknown original call clocks retain the whole quote but never grant positive facts. Later verified clarification may resolve ordinary uncertainty. Persistent restrictions are scanned before chronology and cannot disappear with an unclocked turn.
- Raw source v1 deliberately sets legacy top-level completeness false for stale workers. This reader requires the exact raw version and validated SMS receipt projection before deriving coverage from `callSourceComplete` and the SMS source's completeness/count. Complete coverage does not mean qualification or signing permission.
- A price-authority gap preserves the exact original accepted amount. It requires a new source-bound acceptance, rather than replacing $60,000 with a recomputed $90,000 ceiling. Voice recovery requires the current quote tool receipt carrying that exact source marker and a subsequent unqualified exact-price answer. Delivery requests alone do not create initial price acceptance.
- SMS final agreement consent uses the exact current canonical source pair. Identity questions reset at each source boundary; unknown clock/context markers cannot lend a previous question.

## Original deferred-call proof

`SellerCallPrefix` v2 is `{version:'seller-call-prefix-v2',conversationId,pairCount,turnCount,fingerprint}`. The fingerprint is SHA-256 of UTF-8 `JSON.stringify([startEpochMilliseconds, turns])`; every ordered speaker turn is `[role, wholeMessage, originalSecondsOrNull]`. User offsets are required; missing agent offsets remain null. Numeric offsets must be bounded, monotone and not future. Explicit tool-only payloads are excluded; malformed speaker entries are rejected. The 1,000-row and 262,144-byte limits never clip evidence.

Completion must have the exact first `turnCount` speaker turns, original start and user count. All appended speaker turns must be neutral acknowledgements, including agent-only endings. Inserted/changed/retimed speech, a changed price/recipient/date, an old v1 proof or missing proof cannot renew authority. Current raw holds and qualification are independently rechecked. SQL owns the source-manifest comparison, original-call binding and exact fingerprint CAS; the TypeScript review never invents a replacement envelope or operation.

The reserved live-history variable currently omits clocks. When needed, the normal same-conversation provider getter may supply original clocks only when the entire ordered live speech matches. A stale subset supplies no proof; differing/newer speech holds direct preparation. No network request, dispatch or provider creation occurs in these fixtures. Enabled deferred admission rejects missing proof, so a null proof does not promise automatic delivery.

## Validation and remaining boundary

Focused fixtures cover exact price drift and restoration, receipt uncertainty, all consumer hold propagation, direct claim fingerprints, full-turn prefix matching, source boundaries, hypothetical/negative statements, actual raw SQL to reader/consumer composition, and ordinary valid progression. Existing voice offer/route, text offer, payoff, qualification, identity, agreement and recovery fixtures remain required alongside TypeScript and the atomic migration's native PostgreSQL race tests.

The change does not resolve genuine human/contact/material-review requests, create clocks for absent evidence, replay uncertain sends, alter cancellation, enable a cohort, or prove universal natural-language understanding. These unresolved sources remain held for their existing review path. A provider source that never supplies a matching complete original transcript cannot recover automatically.
