# Seller scenario audit - October 9, 2026

Source commit: 2a48dbf6a02afb6a80068ac528b2e17330b1e9e7. This is a pinned source audit, not a live deployment certification.

150 scenarios: 100 executable local checks (83 passed, 17 desired-outcome mismatches), plus 50 workflow reviews. No production code, database, provider setting, outreach, signature, or payment changed.

The local runner uses actual TypeScript functions and exact shipped viewing SQL in isolated fixture tables. The 17 mismatches are test cases, not 17 independent production incidents. Prompt compliance and unseen runtime paths still need live acceptance testing.

## Highest-priority findings

### G1. Reconfirm withdrawn or conditional acceptance (P0)

An earlier yes stays valid after seller hesitation, denial, or a newly required spouse.

Required action: Bind acceptance to the latest relevant seller turn. Invalidate on hesitation, withdrawal, new decision-makers or conditions, then request fresh exact-price consent.

Cases: WITHDRAW-1 to WITHDRAW-4.

### G2. Do not erase liens or unpaid taxes (P0)

Qualified no answers are saved as zero additional debt.

Required action: Parse the whole answer before matching an initial no. Unknown amount must remain unknown, require clarification and block unsupported contract readiness.

Cases: DEBT-2 to DEBT-4.

### G3. Unify contact-stop handling (P0)

Webhook opt-out parser misses polite stop wording; analysis disagrees on mixed STOP/callback language.

Required action: Use one durable stop policy at ingestion and dispatch. Some lower layers already hold replies; reproduce cross-channel suppression before claiming any unwanted call occurred.

Cases: CONTACT-2, CONTACT-3, CONTACT-7, CONTACT-9.

### G4. Recover and replace viewing availability (P1)

Clarification cannot recover earlier unclear/withdrawn state in the same call; a later correction can leave the old slot published.

Required action: Store revision-aware availability. A later valid replacement supersedes earlier uncertainty; an unparsed correction clears old slots and requests clarification.

Cases: VIEW-2, VIEW-3, VIEW-7.

### G5. Keep busy sellers in the callback flow (P1)

Not now, call me tomorrow is marked declined by the text validator.

Required action: Prioritize explicit later availability over a temporary busy phrase. Reconcile with the SQL scheduling hold and acknowledge the saved next step.

Cases: CALLBACK-TEXT-1.

### G6. Finish seller-to-buyer viewing follow-through (P1)

Request capture and follow-up copy exist; completed contact and return-to-buyer automation were not found in the reviewed flow.

Required action: Create tracked ask-seller, await-reply, relay-options, await-buyer-choice and confirm-access work with cancellation and failure recovery.

Cases: FLOW-41.

### G7. Support multiple seller signers (P1)

Automatic seller contract flow requires soleOwner=true and builds one seller signer.

Required action: Add the verified multi-signer preparation path or explicitly assign the human task, track all signers and resume only on completed signatures.

Cases: FLOW-11.

### G8. Define no-answer and interruption recovery (P1)

Initial response and requested callback exist; a complete bounded no-answer cadence was not found.

Required action: Separate no-answer, voicemail, busy, technical failure and unknown outcome. Save a permitted next step with deduplication and stop/takeover checks.

Cases: FLOW-27, FLOW-28.

### G9. Define fresh lower-price acceptance (P1)

New quote uses the calculated ceiling; accept_offer must equal the quote. Lower saved agreements work.

Required action: Choose an explicit negotiation policy and save an authorized proposed price below the ceiling with seller evidence, then accept that exact revision.

Cases: FLOW-24.

### G10. Handle common payoff and representation wording (P2)

No-debt wording can remain unresolved; contradictory agent-agreement wording can be classified unlisted.

Required action: Clarify ambiguous representation and recognize equivalent debt-free answers without clearing other debt or authority holds.

Cases: DEBT-10, LISTING-5.

### G11. Repair baseline tests before using a green release claim (P1)

Two of 24 existing suites fail: a fixture omits signatureRequestMessage, and a source-text assertion expects obsolete prompt wording.

Required action: Update the isolated test fixture and assert current behavior. These failures do not by themselves establish live contract failure.

Cases: standard-contract-signing; seller-closing.

### G12. Verify real conversation quality and handoff completion (P1)

Local deterministic checks cannot demonstrate latency, interruptions, actual message receipt or completed human transfers.

Required action: Run controlled full conversations across voice/SMS with real timing, provider receipts, signing sandbox and handoff acknowledgements.

Cases: FLOW-09, FLOW-31, FLOW-32.

## Existing checks run

22 of 24 selected existing JavaScript suites passed. standard-contract-signing failed because its transformed test harness does not inject signatureRequestMessage, which the production module imports. seller-closing failed a stale prompt-string assertion. Three isolated SQL suites passed: seller conversation (123 cases), seller response and buyer purchase/viewing. These use synthetic dependencies and establish no live delivery.

## Run the new checks

Install @electric-sql/pglite@0.3.14 in a separate tools directory if it is not already available. Then:

```bash
node --experimental-strip-types scripts/audit-seller-scenarios.mjs /absolute/path/to/pglite/dist/index.js /absolute/path/to/results.json
```

Exit 0 means all desired outcomes passed, 1 means gaps were reproduced, 2 means a setup/check error occurred. No provider network is allowed by the runner.

## Scenario matrix

PASS = executed local check only. GAP = a reproduced mismatch or clearly labeled source-reviewed missing workflow. REVIEW = specified behavior still needs an end-to-end acceptance check. P0 = acceptance, debt, authority or contact control first; P1 = deal continuity or release evidence; P2 = remaining verification/clarification.

| ID | Stage | Scenario | Required AI action | Result | Evidence/source |
|---|---|---|---|---|---|
| CONTACT-1 | Contact permission | STOP | Persist contact suppression and cancel queued outreach. | PASS | Executed local check; lib/contiguity.ts:isMessageOptOut |
| CONTACT-2 | Contact permission | Please stop. | Persist contact suppression and cancel queued outreach. | GAP | Executed local check; lib/contiguity.ts:isMessageOptOut |
| CONTACT-3 | Contact permission | Stop please. | Persist contact suppression and cancel queued outreach. | GAP | Executed local check; lib/contiguity.ts:isMessageOptOut |
| CONTACT-4 | Contact permission | Dont text me again. | Persist contact suppression and cancel queued outreach. | PASS | Executed local check; lib/contiguity.ts:isMessageOptOut |
| CONTACT-5 | Contact permission | Please remove me. | Persist contact suppression and cancel queued outreach. | PASS | Executed local check; lib/contiguity.ts:isMessageOptOut |
| CONTACT-6 | Contact permission | Do not contact me. | Persist contact suppression and cancel queued outreach. | PASS | Executed local check; lib/contiguity.ts:isMessageOptOut |
| CONTACT-7 | Contact permission | Leave me alone. | Persist contact suppression and cancel queued outreach. | GAP | Executed local check; lib/contiguity.ts:isMessageOptOut |
| CONTACT-8 | Contact permission | Unsubscribe | Persist contact suppression and cancel queued outreach. | PASS | Executed local check; lib/contiguity.ts:isMessageOptOut |
| CALLBACK-TEXT-1 | Callback | Not now, call me tomorrow. | Recognize a callback separately from refusal; ask only for missing scheduling details. | GAP | Executed local check; lib/text-ai-policy.ts:validateTextAnalysis |
| CALLBACK-TEXT-2 | Callback | Call me tomorrow. | Recognize a callback separately from refusal; ask only for missing scheduling details. | PASS | Executed local check; lib/text-ai-policy.ts:validateTextAnalysis |
| CALLBACK-TEXT-3 | Callback | I missed your call. | Recognize a callback separately from refusal; ask only for missing scheduling details. | PASS | Executed local check; lib/text-ai-policy.ts:validateTextAnalysis |
| CALLBACK-TEXT-4 | Callback | Wrong number. | Recognize a callback separately from refusal; ask only for missing scheduling details. | PASS | Executed local check; lib/text-ai-policy.ts:validateTextAnalysis |
| IDENTITY-1 | First conversation | Are you a real person? | Answer honestly and continue the current context. | PASS | Executed local check; lib/text-ai-policy.ts:validateTextAnalysis |
| HUMAN-1 | Human handoff | I want to talk to a human. | Pause automation and request a person. | PASS | Executed local check; lib/text-ai-policy.ts:validateTextAnalysis |
| CONTACT-9 | Contact permission | Mixed message: STOP, call me tomorrow. | Hold conflicting stop/callback instructions for clarification; do not queue a callback. | GAP | Executed local check; lib/text-ai-policy.ts:validateTextAnalysis |
| ACCEPT-1 | Offer acceptance | Yes. | Accept only an unqualified yes to the exact currently quoted price. | PASS | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| ACCEPT-2 | Offer acceptance | No. | Accept only an unqualified yes to the exact currently quoted price. | PASS | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| ACCEPT-3 | Offer acceptance | Yes, but I need $110,000. | Accept only an unqualified yes to the exact currently quoted price. | PASS | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| ACCEPT-4 | Offer acceptance | Yes if you close tomorrow. | Accept only an unqualified yes to the exact currently quoted price. | PASS | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| ACCEPT-5 | Offer acceptance | That works. | Accept only an unqualified yes to the exact currently quoted price. | PASS | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| ACCEPT-6 | Offer acceptance | Sounds good. | Accept only an unqualified yes to the exact currently quoted price. | PASS | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| WITHDRAW-1 | Offer acceptance | After an earlier yes: I am not ready to sell. | Invalidate acceptance and resolve the latest objection before preparing an agreement. | GAP | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| WITHDRAW-2 | Offer acceptance | After an earlier yes: Wait, I need to think. | Invalidate acceptance and resolve the latest objection before preparing an agreement. | GAP | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| WITHDRAW-3 | Offer acceptance | After an earlier yes: I never agreed to that. | Invalidate acceptance and resolve the latest objection before preparing an agreement. | GAP | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| WITHDRAW-4 | Offer acceptance | After an earlier yes: Actually I need my spouse to agree first. | Invalidate acceptance and resolve the latest objection before preparing an agreement. | GAP | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| WITHDRAW-5 | Offer acceptance | After an earlier yes: I changed my mind. | Invalidate acceptance and resolve the latest objection before preparing an agreement. | PASS | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| WITHDRAW-6 | Offer acceptance | After an earlier yes: Cancel the agreement. | Invalidate acceptance and resolve the latest objection before preparing an agreement. | PASS | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| ACCEPT-7 | Offer acceptance | Seller accepts a different spoken price | Hold until the exact current price is confirmed. | PASS | Executed local check; lib/call-offer-evidence.ts:callOfferEvidence |
| DEBT-1 | Mortgage and liens | No. | Preserve qualifications and debt disclosures; unknown additional debt must not become zero. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-2 | Mortgage and liens | No, there is a lien. | Preserve qualifications and debt disclosures; unknown additional debt must not become zero. | GAP | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-3 | Mortgage and liens | No, there are unpaid taxes. | Preserve qualifications and debt disclosures; unknown additional debt must not become zero. | GAP | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-4 | Mortgage and liens | No other loans, but unpaid taxes remain. | Preserve qualifications and debt disclosures; unknown additional debt must not become zero. | GAP | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-5 | Mortgage and liens | I owe $5,000 in taxes. | Preserve qualifications and debt disclosures; unknown additional debt must not become zero. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-6 | Mortgage and liens | Not sure. | Preserve qualifications and debt disclosures; unknown additional debt must not become zero. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-7 | Mortgage and liens | Between $2,000 and $4,000. | Preserve qualifications and debt disclosures; unknown additional debt must not become zero. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-8 | Mortgage and liens | My mortgage is $20,000. | Record only an unambiguous seller-reported balance, or ask for clarification. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-9 | Mortgage and liens | The house is paid off. | Record only an unambiguous seller-reported balance, or ask for clarification. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-10 | Mortgage and liens | I do not owe anything. | Record only an unambiguous seller-reported balance, or ask for clarification. | GAP | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-11 | Mortgage and liens | Not sure, maybe $20,000. | Record only an unambiguous seller-reported balance, or ask for clarification. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| DEBT-12 | Mortgage and liens | The other owner owes $20,000. | Record only an unambiguous seller-reported balance, or ask for clarification. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| SHORTFALL-1 | Mortgage and liens | Yes. | Capture ability to cover the stated $10,000 shortfall without treating conditional funding as available. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| SHORTFALL-2 | Mortgage and liens | No. | Capture ability to cover the stated $10,000 shortfall without treating conditional funding as available. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| SHORTFALL-3 | Mortgage and liens | Yes if I can borrow it. | Capture ability to cover the stated $10,000 shortfall without treating conditional funding as available. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffEvidence |
| SHORTFALL-4 | Mortgage and liens | Debt exceeds price; seller cannot cover difference | Keep contract preparation blocked. | PASS | Executed local check; lib/seller-payoff.ts:sellerPayoffPosition |
| PRICE-1 | Pricing | Current value $200,000; repairs $40,000; fee $10,000 | Use supported numbers and preserve an already agreed lower price. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| PRICE-2 | Pricing | Repairs increase to $60,000 | Use supported numbers and preserve an already agreed lower price. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| PRICE-3 | Pricing | Seller claims lower repairs than research | Use supported numbers and preserve an already agreed lower price. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| PRICE-4 | Pricing | A lower $90,000 price was already accepted | Use supported numbers and preserve an already agreed lower price. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| PRICE-HOLD-1 | Pricing | {"acceptedPriceCents":11000000} | Hold price/contract discussion while this material issue is unresolved. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| PRICE-HOLD-2 | Pricing | {"conditionPending":true} | Hold price/contract discussion while this material issue is unresolved. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| PRICE-HOLD-3 | Pricing | {"factsPending":true} | Hold price/contract discussion while this material issue is unresolved. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| PRICE-HOLD-4 | Pricing | {"agreementRevisionRequired":true} | Hold price/contract discussion while this material issue is unresolved. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| PRICE-HOLD-5 | Pricing | {"listedWithAgent":true} | Hold price/contract discussion while this material issue is unresolved. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| RESEARCH-STALE | Property research | STALE | Hold until the right property has current, applicable research. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| RESEARCH-ADDRESS | Property research | ADDRESS | Hold until the right property has current, applicable research. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| RESEARCH-LAND | Property research | LAND | Hold until the right property has current, applicable research. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| RESEARCH-VALUE | Property research | VALUE | Hold until the right property has current, applicable research. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| PRICE-5 | Pricing | Low equity with unresolved mortgage | Discuss a conditional price but block contract preparation. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| LISTING-1 | Ownership and listing | Yes. | Clarify conflicting representation facts before quoting or ending the lead. | PASS | Executed local check; lib/seller-listing.ts:sellerListingEvidence |
| LISTING-2 | Ownership and listing | No. | Clarify conflicting representation facts before quoting or ending the lead. | PASS | Executed local check; lib/seller-listing.ts:sellerListingEvidence |
| LISTING-3 | Ownership and listing | I might list it with a realtor. | Clarify conflicting representation facts before quoting or ending the lead. | PASS | Executed local check; lib/seller-listing.ts:sellerListingEvidence |
| LISTING-4 | Ownership and listing | It is not listed with an agent. | Clarify conflicting representation facts before quoting or ending the lead. | PASS | Executed local check; lib/seller-listing.ts:sellerListingEvidence |
| LISTING-5 | Ownership and listing | It is not listed, but I have an agent agreement. | Clarify conflicting representation facts before quoting or ending the lead. | GAP | Executed local check; lib/seller-listing.ts:sellerListingEvidence |
| CONTRACT-1 | Purchase contract | {"soleOwner":false} | Require valid confirmations; declining a visit alone does not waive terms or kill the deal. | PASS | Executed local check; lib/seller-agreement-flow.ts:confirmedSellerTerms |
| CONTRACT-2 | Purchase contract | {"allDecisionMakersAgree":false} | Require valid confirmations; declining a visit alone does not waive terms or kill the deal. | PASS | Executed local check; lib/seller-agreement-flow.ts:confirmedSellerTerms |
| CONTRACT-3 | Purchase contract | {"sendTextRequested":false} | Require valid confirmations; declining a visit alone does not waive terms or kill the deal. | PASS | Executed local check; lib/seller-agreement-flow.ts:confirmedSellerTerms |
| CONTRACT-4 | Purchase contract | {"termsConfirmed":false} | Require valid confirmations; declining a visit alone does not waive terms or kill the deal. | PASS | Executed local check; lib/seller-agreement-flow.ts:confirmedSellerTerms |
| CONTRACT-5 | Purchase contract | {"materialFactsChanged":true} | Require valid confirmations; declining a visit alone does not waive terms or kill the deal. | PASS | Executed local check; lib/seller-agreement-flow.ts:confirmedSellerTerms |
| CONTRACT-6 | Purchase contract | {"agreedPriceCents":10300000} | Require valid confirmations; declining a visit alone does not waive terms or kill the deal. | PASS | Executed local check; lib/seller-agreement-flow.ts:confirmedSellerTerms |
| CONTRACT-7 | Purchase contract | {"closingDate":"2000-01-01"} | Require valid confirmations; declining a visit alone does not waive terms or kill the deal. | PASS | Executed local check; lib/seller-agreement-flow.ts:confirmedSellerTerms |
| CONTRACT-8 | Purchase contract | {"inspectionAccess":"no"} | Require valid confirmations; declining a visit alone does not waive terms or kill the deal. | PASS | Executed local check; lib/seller-agreement-flow.ts:confirmedSellerTerms |
| CONTRACT-9 | Purchase contract | Seller purchase deposit | Do not add buyer-assignment deposit rules to the seller purchase agreement. | PASS | Executed local check; lib/seller-agreement-flow.ts:confirmedSellerTerms |
| SIGN-1 | Signatures | {} | Advance only on verified signatures and required owners/terms. | PASS | Executed local check; lib/contract-readiness.ts:contractReadiness |
| SIGN-2 | Signatures | {"sellerSignaturesVerified":true} | Advance only on verified signatures and required owners/terms. | PASS | Executed local check; lib/contract-readiness.ts:contractReadiness |
| SIGN-3 | Signatures | {"sellerSignaturesVerified":true,"customerSignatureVerified":true} | Advance only on verified signatures and required owners/terms. | PASS | Executed local check; lib/contract-readiness.ts:contractReadiness |
| SIGN-4 | Signatures | {"allOwnersConfirmed":false} | Advance only on verified signatures and required owners/terms. | PASS | Executed local check; lib/contract-readiness.ts:contractReadiness |
| SIGN-5 | Signatures | {"legalDescriptionReviewed":false} | Advance only on verified signatures and required owners/terms. | PASS | Executed local check; lib/contract-readiness.ts:contractReadiness |
| CALLBACK-1 | Callback | {} | Dispatch once only at an allowed, confirmed time and recheck current controls. | PASS | Executed local check; lib/callback-policy.ts:callbackDecision |
| CALLBACK-2 | Callback | {"timeConfirmed":false} | Dispatch once only at an allowed, confirmed time and recheck current controls. | PASS | Executed local check; lib/callback-policy.ts:callbackDecision |
| CALLBACK-3 | Callback | {"humanTakeover":true} | Dispatch once only at an allowed, confirmed time and recheck current controls. | PASS | Executed local check; lib/callback-policy.ts:callbackDecision |
| CALLBACK-4 | Callback | {"permitted":false} | Dispatch once only at an allowed, confirmed time and recheck current controls. | PASS | Executed local check; lib/callback-policy.ts:callbackDecision |
| CALLBACK-5 | Callback | {"canceled":true} | Dispatch once only at an allowed, confirmed time and recheck current controls. | PASS | Executed local check; lib/callback-policy.ts:callbackDecision |
| CALLBACK-6 | Callback | {"exclusiveLease":false} | Dispatch once only at an allowed, confirmed time and recheck current controls. | PASS | Executed local check; lib/callback-policy.ts:callbackDecision |
| CALLBACK-7 | Callback | {"now":1791581579817} | Dispatch once only at an allowed, confirmed time and recheck current controls. | PASS | Executed local check; lib/callback-policy.ts:callbackDecision |
| CALLBACK-8 | Callback | {"contactWindowOpen":false} | Dispatch once only at an allowed, confirmed time and recheck current controls. | PASS | Executed local check; lib/callback-policy.ts:callbackDecision |
| POSTSIGN-1 | After contract | Returning seller already has a signed contract | Resume access coordination; do not requalify or quote a new offer. | PASS | Executed local check; lib/automatic-call-offer.ts:calculateAutomaticCallOffer |
| VIEW-PUBLIC-1 | Viewing | Expired slot | Do not advertise past availability. | PASS | Executed local check; lib/buyer-purchase-terms.ts:sellerViewingSlots |
| VIEW-PUBLIC-2 | Viewing | Slot contains private access code | Only publish time fields. | PASS | Executed local check; lib/buyer-purchase-terms.ts:sellerViewingSlots |
| DEPOSIT-1 | Buyer handoff | Assignment fee in cents: 1000000 | Calculate 20% of assignment fee, capped at $5,000, only on the buyer side. | PASS | Executed local check; lib/buyer-purchase-terms.ts:buyerDepositCents |
| DEPOSIT-2 | Buyer handoff | Assignment fee in cents: 5000000 | Calculate 20% of assignment fee, capped at $5,000, only on the buyer side. | PASS | Executed local check; lib/buyer-purchase-terms.ts:buyerDepositCents |
| CLOSE-1 | Closing | Seller says the sale is closed; title has not confirmed | Keep closing incomplete. | PASS | Executed local check; lib/closing-workflow.ts:nextClosingStage |
| CLOSE-2 | Closing | Verified title close confirmation | Advance to closed. | PASS | Executed local check; lib/closing-workflow.ts:nextClosingStage |
| VIEW-1 | Viewing | One complete viewing window | Keep only the latest confirmed seller availability; clarification must recover without publishing an outdated time. | PASS | Executed local check; config/seller-viewing-availability-and-buyer-intent.sql:icash_capture_seller_viewing |
| VIEW-2 | Viewing | Unclear time, then exact answer in the same call | Keep only the latest confirmed seller availability; clarification must recover without publishing an outdated time. | GAP | Executed local check; config/seller-viewing-availability-and-buyer-intent.sql:icash_capture_seller_viewing |
| VIEW-3 | Viewing | Withdraw old time, then supply replacement in the same call | Keep only the latest confirmed seller availability; clarification must recover without publishing an outdated time. | GAP | Executed local check; config/seller-viewing-availability-and-buyer-intent.sql:icash_capture_seller_viewing |
| VIEW-4 | Viewing | Explicit withdrawal only | Keep only the latest confirmed seller availability; clarification must recover without publishing an outdated time. | PASS | Executed local check; config/seller-viewing-availability-and-buyer-intent.sql:icash_capture_seller_viewing |
| VIEW-5 | Viewing | Missing timezone | Keep only the latest confirmed seller availability; clarification must recover without publishing an outdated time. | PASS | Executed local check; config/seller-viewing-availability-and-buyer-intent.sql:icash_capture_seller_viewing |
| VIEW-6 | Viewing | Two complete windows | Keep only the latest confirmed seller availability; clarification must recover without publishing an outdated time. | PASS | Executed local check; config/seller-viewing-availability-and-buyer-intent.sql:icash_capture_seller_viewing |
| VIEW-7 | Viewing | Seller corrects the window without repeating the word viewing | Keep only the latest confirmed seller availability; clarification must recover without publishing an outdated time. | GAP | Executed local check; config/seller-viewing-availability-and-buyer-intent.sql:icash_capture_seller_viewing |
| VIEW-8 | Viewing | DST clock repeats 1:30 AM | Request an unambiguous viewing time. | PASS | Executed local check; config/seller-viewing-availability-and-buyer-intent.sql:icash_parse_viewing_slot |
| FLOW-01 | Intake | Seller submits the same property twice | Reuse the bound lead; avoid duplicate billing, texts, and calls. | REVIEW | Source review; not an executed end-to-end test; lib/seller-optin-server.ts |
| FLOW-02 | Intake | Address autocomplete selects the wrong house | Read back the property; correct the address before fresh research or contact. | REVIEW | Source review; not an executed end-to-end test; docs/seller-title-review-contact.md |
| FLOW-03 | Intake | Research provider times out or returns multiple matches | Preserve the inquiry and request review without pretending an offer is ready. | REVIEW | Source review; not an executed end-to-end test; lib/seller-qualification.ts |
| FLOW-04 | First conversation | Wrong number or person is not the owner | Stop that contact and resolve the owner without exposing debt or contract information. | REVIEW | Source review; not an executed end-to-end test; lib/seller-phone-flow.ts |
| FLOW-05 | First conversation | Why are several buyers contacting me? | Explain the actual network and principal, without inventing competitors or urgency. | REVIEW | Source review; not an executed end-to-end test; lib/homeoffer-buyer-identity.ts |
| FLOW-06 | Contact permission | New form arrives from an already suppressed number | Keep existing suppression until a valid scoped repermission path completes. | REVIEW | Source review; not an executed end-to-end test; config/text-messaging.sql |
| FLOW-07 | First conversation | Seller speaks Spanish or another unsupported language | Offer a supported language or a qualified person; do not infer acceptance from unclear speech. | REVIEW | Source review; not an executed end-to-end test; lib/seller-phone-flow.ts |
| FLOW-08 | First conversation | Heavy accent, noise, interruption, or unclear number | Ask one concise clarification and read back the amount/date before saving. | REVIEW | Source review; not an executed end-to-end test; lib/call-offer-evidence.ts |
| FLOW-09 | Human handoff | Seller demands a person during an offer | Pause the bot, preserve the conversation, assign the handoff, and confirm only actual transfer. | REVIEW | Source review; not an executed end-to-end test; docs/seller-workflow-continuity.md |
| FLOW-10 | Contact preference | Text only; do not call | Honor the channel preference and continue permitted texting without restarting voice. | REVIEW | Source review; not an executed end-to-end test; lib/contiguity.ts |
| FLOW-11 | Ownership | Two owners both agree and want the contract | Collect both legal names and signing destinations; route through the required multi-signer workflow. | GAP | Source review; not an executed end-to-end test; lib/seller-agreement-service.ts |
| FLOW-12 | Ownership | Spouse or co-owner is unavailable | Save who must agree, schedule a joint follow-up, and hold the agreement. | REVIEW | Source review; not an executed end-to-end test; lib/seller-agreement-flow.ts |
| FLOW-13 | Ownership | Inherited house; probate is incomplete | Collect the claimed authority and route to title/legal review before promises or signatures. | REVIEW | Source review; not an executed end-to-end test; lib/seller-agreement-flow.ts |
| FLOW-14 | Ownership | LLC, trust, guardian, or power of attorney seller | Identify the actual owner and authorized signer; verify authority before contract execution. | REVIEW | Source review; not an executed end-to-end test; lib/seller-agreement-flow.ts |
| FLOW-15 | Ownership | Divorce, disputed ownership, or competing heirs | Hold price acceptance/contract changes and route the dispute to the appropriate reviewer. | REVIEW | Source review; not an executed end-to-end test; lib/automatic-call-offer.ts |
| FLOW-16 | Ownership | Currently listed or under another purchase agreement | Record the exact restriction, avoid encouraging a breach, and follow the supported deal policy. | REVIEW | Source review; not an executed end-to-end test; lib/seller-listing.ts |
| FLOW-17 | Property condition | Tenant-occupied property with a lease | Record lease, occupancy, and possession needs; confirm access with the authorized occupant. | REVIEW | Source review; not an executed end-to-end test; lib/seller-phone-flow.ts |
| FLOW-18 | Viewing | Tenant refuses access or seller cannot get a key | Save the access blocker, seek an approved alternative, and update the waiting buyer. | REVIEW | Source review; not an executed end-to-end test; config/seller-viewing-availability-and-buyer-intent.sql |
| FLOW-19 | Property condition | Unsafe building, squatter, pets, or hazardous access | Record the access concern and route it to a person; do not instruct buyers to enter. | REVIEW | Source review; not an executed end-to-end test; config/seller-viewing-availability-and-buyer-intent.sql |
| FLOW-20 | Property condition | New fire, foundation, flood, or major repair disclosure | Save the full statement, refresh material numbers, and invalidate old acceptance as needed. | REVIEW | Source review; not an executed end-to-end test; lib/automatic-call-offer.ts |
| FLOW-21 | Property research | Seller offers two houses or corrects the parcel | Keep each property separate and bind any offer to the right address/parcel. | REVIEW | Source review; not an executed end-to-end test; lib/seller-agreement-binding.ts |
| FLOW-22 | Property research | No credible comparable sales or unsupported property type | Explain what needs review and assign research rather than invent an ARV. | REVIEW | Source review; not an executed end-to-end test; lib/offer-policy.ts |
| FLOW-23 | Negotiation | Seller will not accept the supported maximum | Ask once whether price or timing is flexible, then save a specific next step or end respectfully. | REVIEW | Source review; not an executed end-to-end test; lib/seller-phone-flow.ts |
| FLOW-24 | Negotiation | Seller offers a lower price or asks to negotiate incrementally | Record the actual proposed price and obtain exact acceptance with price provenance. | GAP | Source review; not an executed end-to-end test; lib/automatic-call-offer.ts |
| FLOW-25 | Negotiation | Seller claims a competing cash offer | Ask about their decision criteria; compare only supported terms and avoid inventing a competing buyer. | REVIEW | Source review; not an executed end-to-end test; lib/seller-phone-flow.ts |
| FLOW-26 | After contract | Seller asks for a higher price after signing | Keep the signed agreement intact, route the requested amendment, and reapprove economics. | REVIEW | Source review; not an executed end-to-end test; lib/seller-agreement-service.ts |
| FLOW-27 | Call recovery | Call drops during the offer or contract preparation | Preserve the last completed action; reconcile provider outcomes before a follow-up. | REVIEW | Source review; not an executed end-to-end test; lib/seller-response-service.ts |
| FLOW-28 | No answer | Busy, voicemail, disconnected, or no answer | Distinguish outcomes and use an explicit bounded follow-up policy where contact is permitted. | GAP | Source review; not an executed end-to-end test; docs/audits/2026-10-05-seller-to-closing.md |
| FLOW-29 | Callback | Seller reschedules, cancels, or misses a callback | Cancel the old job, preserve the latest confirmed time, and avoid duplicate or late calls. | REVIEW | Source review; not an executed end-to-end test; lib/callback-policy.ts |
| FLOW-30 | Callback | Tomorrow near midnight or during a DST change | Use the seller timezone, exact date and AM/PM readback; clarify ambiguous times. | REVIEW | Source review; not an executed end-to-end test; lib/relative-callback.ts |
| FLOW-31 | Voice quality | AI pauses, speaks over seller, or repeatedly says it is checking | Use one short acknowledgement, bounded tool retries, and resume at the last answered question. | REVIEW | Source review; not an executed end-to-end test; app/api/internal/voice/cash-offer/route.ts |
| FLOW-32 | Conversation continuity | Seller texts while on a call or the customer takes over | Use one current conversation state, stop conflicting automation, and preserve both messages. | REVIEW | Source review; not an executed end-to-end test; docs/sms-voice-continuity.md |
| FLOW-33 | Purchase contract | Signing link never arrives or will not open | Check provider delivery, exact recipient and envelope, then use the bounded resend/recovery path. | REVIEW | Source review; not an executed end-to-end test; lib/contract-text-resend.ts |
| FLOW-34 | Purchase contract | Seller has no smartphone or needs accessibility help | Offer the supported alternative signing/help workflow without signing for the seller. | REVIEW | Source review; not an executed end-to-end test; lib/seller-agreement-flow.ts |
| FLOW-35 | Purchase contract | Seller legal name, address, or closing date is wrong | Pause sending and revise through the authorized agreement version path. | REVIEW | Source review; not an executed end-to-end test; lib/seller-agreement-service.ts |
| FLOW-36 | Purchase contract | Seller wants their attorney to change terms | Save the requested changes and send them to an authorized reviewer. | REVIEW | Source review; not an executed end-to-end test; lib/seller-phone-flow.ts |
| FLOW-37 | Purchase contract | Seller wants payment before signing or demands purchase EMD | Explain the actual saved seller agreement and route unsupported concessions. | REVIEW | Source review; not an executed end-to-end test; lib/seller-agreement-flow.ts |
| FLOW-38 | Signatures | Seller says done, but signing status is still pending | Check the provider and ask for the final submit step only if still needed. | REVIEW | Source review; not an executed end-to-end test; lib/seller-agreement-service.ts |
| FLOW-39 | Signatures | Seller signs but the customer signature fails | Keep the deal awaiting the required signature and notify the responsible person. | REVIEW | Source review; not an executed end-to-end test; lib/contract-readiness.ts |
| FLOW-40 | Deadlines | Inspection or closing deadline approaches with unfinished work | Track the contractual deadline, assign the blocker, and obtain an authorized extension if needed. | REVIEW | Source review; not an executed end-to-end test; lib/closing-workflow.ts |
| FLOW-41 | Viewing | Buyer wants to visit but the seller has no saved availability | Ask the seller, save the reply, relay options to the waiting buyer, then confirm access. | GAP | Source review; not an executed end-to-end test; config/buyer-viewing-seller-followup.sql |
| FLOW-42 | Title selection | Seller suggests a local title company | Collect the company/contact and verify suitability and authority before selection or sending documents. | REVIEW | Source review; not an executed end-to-end test; lib/title-service.ts |
| FLOW-43 | Viewing | Buyer declines to view the property | Continue the supported assignment process if the buyer wants to proceed. | REVIEW | Source review; not an executed end-to-end test; lib/automatic-call-offer.ts |
| FLOW-44 | Viewing | Seller or buyer cancels a previously arranged visit | Withdraw the slot and notify the other party; do not leave stale access instructions active. | REVIEW | Source review; not an executed end-to-end test; config/seller-viewing-availability-and-buyer-intent.sql |
| FLOW-45 | Viewing | Buyer asks for lockbox, alarm code, or permission to enter | Provide only specifically authorized access information to the correct recipient. | REVIEW | Source review; not an executed end-to-end test; lib/buyer-purchase-terms.ts |
| FLOW-46 | Buyer handoff | Buyer claims deposit payment or sends a screenshot | Keep the property unreserved until required agreement and cleared-funds verification complete. | REVIEW | Source review; not an executed end-to-end test; config/buyer-purchase-terms-and-reservations.sql |
| FLOW-47 | Buyer handoff | Buyer backs out, cannot fund, or misses deposit deadline | Alert the operator, preserve seller obligations, and follow an authorized backup-buyer plan. | REVIEW | Source review; not an executed end-to-end test; lib/closing-workflow.ts |
| FLOW-48 | Title and payoff | Title finds a lien, payoff shortfall, or foreclosure deadline | Save the verified title facts, pause unsupported promises, and route the issue with a responsible person and deadline. | REVIEW | Source review; not an executed end-to-end test; lib/seller-payoff.ts |
| FLOW-49 | Closing | Closing moves, seller needs more time to move, or possession changes | Confirm the request, coordinate title/buyer, and obtain any required signed amendment. | REVIEW | Source review; not an executed end-to-end test; lib/closing-workflow.ts |
| FLOW-50 | Closing | Seller asks when money will arrive or for changed wire details | Use verified title/payment status and independently verified instructions. Mark paid only with actual evidence. | REVIEW | Source review; not an executed end-to-end test; lib/closing-workflow.ts |

## Scope limits

The uploaded purchase/assignment PDFs returned placeholder text in extraction, so this audit does not certify their visual field mapping, executed wording, enforceability or signature completion. The contract checks assess the application code. No legal conclusions or state-specific approvals are supplied. The review preserves buyer-outreach SMS/email only, buyer matching after executed purchase, stable party identity, and seller/occupant-confirmed access.
