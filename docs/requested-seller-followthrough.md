# Requested seller contact and clipped mailboxes

The November 13 owner report reproduced three separate failures in shared code:

- An outbound conversation heard only a clipped destination-number fragment, then silence. The agent repeated its ownership question before ending after about 35 seconds. Recording and the exact-call stop receipt succeeded; the mailbox recognition happened too late.
- No initial SMS was queued. The fresh, consented seller intake passed its contact review, but the opener preflight treated it as cold outreach and hit the shared sender's cold-introduction pacing.
- A subsequent greeting had a supported ownership clarification, but the final dialogue guard rejected it because title/payoff details were still under review. That legitimate financial hold must prevent an unsupported offer, not the bounded question needed to identify the seller.

## Shared changes

Every recorded outbound registration receives a final destination-bound instruction for a bare mailbox number or its clipped nine-or-more-digit ending before human conversation. It stops through the existing exact-call recording tool without another introduction or silence check. Ordinary greetings, prices, requested phone answers, later human conversation and silence alone do not satisfy this rule. This changes runtime instructions; it does not add carrier answering-machine detection or claim perfect recognition.

Requested introductions receive warm sender classification only for an active, consented intake matched to the same account, screening, property and recipient. The final message must also match the original opener assignment, request key and opening record. Queueing and final sender admission use the same classification. Total provider capacity, consent review, routing, customer Pause, financial admission, original operation claims and cold-outreach limits remain in place.

The existing limited title/payoff window can send the specific supported ownership clarification. A delivered clarification can then anchor the existing bounded payoff question even when the first opener never arrived. Other dialogue actions, unsupported offers and contracts remain blocked by the financial review. Existing review rows and historical messages are not replayed.

Authorized contract links already have warm sender classification. The contract service still requires the accepted, source-bound terms and delivery preflight, reuses an existing envelope, and retains an unknown provider outcome for reconciliation instead of sending again.

## Verification and release

- `requested-seller-followthrough.test.mjs` runs the saved production opener, actual queue, sender claim/trigger and capacity functions over local synthetic rows. It reproduces cold pacing, admits a valid requested opener once, rejects changed consent/source/tenant/copy, preserves contract classification and enforces total capacity. External permission/provider adapters remain fixtures.
- `limited-seller-ownership-reply.test.mjs` runs dialogue preparation, queueing, the final claim and payoff continuation with the real limited-contact predicate. It covers current consent, account, time window, Pause, changed routing and no invented offer/contract authority.
- `required-call-recording.test.mjs` verifies both recorded entry paths carry the recipient-bound mailbox policy and preserves exact-call stopping/recording behavior. It verifies transport and instructions, not live speech recognition.
- Existing agreement, preflight, status, identity, evidence, recovery, confirmed-delivery and contract-text suites exercise accepted terms, send-once behavior and uncertain outcomes without real messages or signatures.

The two database migrations are compatible with the existing runtime. Install their reviewed definitions, verify private permissions and current bound contact classification read-only, then release through the exact-head Reliability checks and verify production web and worker commits. No paid provider simulation, test call, test text, contract or historical replay is part of this release. Live ring, recognition and delivery receipts remain distinct from offline verification.

Production database readback on November 13 confirmed migrations `20261113170818` and `20261113170819`, private helper permissions, and the affected intake's requested-contact, current-permission and limited-contact predicates. The security advisor inventory was unchanged. Application production verification is tracked in the release PR.
