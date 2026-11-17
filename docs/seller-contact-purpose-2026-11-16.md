# Seller purpose questions and address repetition

The seller asking “How may I help?” or “What is this for?” was not recognized by the deterministic conversion classifier. Initial replies could receive another qualification question or “Which part would you like me to clarify?” The existing informational SMS fallback also rejected those words. Unpunctuated “How may I help” could be mistaken for a May timeline or a legal name; a courtesy “Yes” before the question could be mistaken for a signer, terms, price or shortfall confirmation.

The complete, bounded question now has an informational `purpose` intent. It answers the seller's question before routine qualification or a pending gross-price clarification:

| Current evidence | Reply after any required introduction |
| --- | --- |
| Selling interest still unknown | Would you consider selling the property for all cash? |
| Selling interest already established | We are discussing a possible all-cash purchase of the property. |
| Accepted price, before document creation | We are confirming the details for the proposed purchase agreement. |

The introduction identifies the AI assistant and the actual saved principal. It is omitted only after a delivered, provider-bound, non-customer-authored message exactly matches a known complete introduction template for that full principal. A name substring, quotation or uncertain receipt is insufficient. These replies do not repeat the saved address. The two-delivered-purpose-answer limit includes versions with and without the introduction; it cannot restart as wording changes. Full identities are never truncated to fit the existing 160-character rate.

The whole-message grammar accepts common greeting/affirmative prefixes, brief fillers, and “today.” Mixed refusals, human requests, wrong-property statements, quoted questions, conditions or transaction instructions do not match. Purpose questions establish no ownership, selling interest, legal name, other-signer agreement, price acceptance, terms/text authorization or shortfall coverage. They break an unanswered question's association; an unprompted later “Yes” cannot answer that old question. Earlier real confirmations remain intact, and a fresh actual question and answer still work. A real yes to the new cash-interest question still requires separate ownership confirmation.

The informational fallback keeps its original consent, source, routing, safety and repeat checks. Its fixed reply explains a possible all-cash purchase without a new qualification question. It refuses existing purchase documents or prior accepted-agreement evidence when the current agreement stage is unavailable. The signed-viewing wrapper is unchanged. “Why did you call me?” retains the existing analytical lane because the inherited offer-context callback exclusion remains unchanged; normalized purpose analysis cannot create callback intent or facts, and the fallback derives its own exact reply. The progress planner preserves this supported direct answer instead of substituting an unrelated qualification question after an earlier identity reply.

## Required release order

1. Integrate the phone runtime/cadence change and the shared `callOfferEvidence` purpose guard together with this text, agreement-identity, agreement-terms and payoff change. This text worktree alone is not a complete release.
2. Pass the latest exact-head canonical checks, then release the application **before SQL installation**. Verify the exact main release on the web and both Railway services with their required gates. New application code safely handles already-admitted old-SQL threads; initial sources that old SQL cannot admit retain their previous held/clarification behavior temporarily.
3. Only after every serving application is verified, take a fresh read-only function/metadata preflight and install `20261117045014_seller_contact_purpose.sql` once, with its byte-identical `config/seller-contact-purpose.sql`. Source/metadata guards and migration history stay in the runner's single transaction. The migration uses a two-second lock timeout and eight-second statement timeout, changes two function bodies, and checks all four pinned functions' complete metadata before and after the change.
4. Read back the two result hashes, unchanged dependency hashes/metadata, migration ledger and normal database health/advisories. Observe ordinary subsequent traffic only. Do not send demonstrations, replay old conversations, reset workflow findings, change policies/cutovers, remove holds or claim live speech quality from offline tests.

**SQL-first is unsafe:** the old planner does not recognize the new purpose intent and repeats qualification; its source-evidence helpers also misinterpret the unpunctuated question. Do not roll application code back to that old behavior while the new classifier remains installed. A rollback needs its own reviewed compatible source plan.

| Function | Required predecessor MD5 | Result MD5 |
| --- | --- | --- |
| `icash_seller_conversion_intent(text)` | `1f436e2035aa1663882c01c18d14ef99` | `9b9870aaa1cac692f8458493e0dd6690` |
| `icash_seller_reply_before_viewings(uuid,uuid)` | `3e16666207f75428a6357ff65c514f46` | `9418e608d2d0c53c7bc6caa1531067f5` |
| `icash_seller_response_disposition(text)` | `8e47d476f60a9e74fa6f2a6c460efdb8` | unchanged |
| `icash_seller_conversation_reply(uuid,uuid)` | `1d658835fae37b6accb8fbe7bd1db2be` | unchanged |

## Verification and limits

- `seller-contact-purpose.test.mjs`: captured live classifier/fallback/outer-wrapper predecessors; 26 actual source-to-context-to-planner-to-save-to-final-source-claim journeys; all 27 purpose forms through the actual fallback; exact-principal and quoted-introduction exclusions; ownership versus interest; pending gross-price and agreement-stage interruptions; 12 late Pause/manual/new-source/route/expiry/identity mutations before save or claim; source/metadata/result drift and atomic ledger rollback. The same suite passes PGlite and native PostgreSQL 17.11 on a disposable loopback database.
- Its inherited context/save/claim fixture exercises real source admission and immutable reply binding with deterministic unrelated provider/financial delegates. This is not a new proof of the complete production financial stack. The fallback context and viewing-presence delegates are explicit offline fixtures; the captured outer signed-viewing function is unchanged.
- Rolling-order regressions verify new application code with old SQL through actual save/claim and retain the initial-source hold. The old planner fixture is the exact `fac12dfc` file composed with current imported helpers, sufficient to show its missing purpose branch. The separately captured original evidence helper demonstrates its May/legal-name classification error; it is not presented as a full old-application deployment.
- `seller-purpose-agreement-authority.test.mjs`: 78 complete-purpose/affirmative/filler combinations against actual agreement identity, terms and payoff validators, including broken pending associations, preserved real confirmations, fresh valid answers, additional signers and mixed withdrawals. The phone authority suite separately verifies shared price acceptance, ownership and live-interest behavior in the combined release.
- Adjacent text-offer, conversation, helpful-copy, agreement-evidence, agreement-identity, payoff, shared-memory-routing, conversion, progress and service-trust suites plus TypeScript remain required. No provider calls, audio simulations, hosted data writes or recovery resets are part of these tests.
