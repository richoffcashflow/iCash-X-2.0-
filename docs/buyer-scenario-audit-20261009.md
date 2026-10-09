# Buyer scenario audit — October 9, 2026

The owner requested buyer scenario testing, gap detection and fixes. No real buyer is called, texted or emailed by this audit. Outbound AI buyer calls remain prohibited and real buyer outreach remains held.

## Reproduced gaps and fixes

| Scenario | Observed before | Change |
| --- | --- | --- |
| “I want the assignment agreement” / “Please text me the contract” | No buyer request captured | Capture common agreement/text/email requests as unaccepted requests for review |
| “I sent $500 through Cash App” | No payment attention item | Record the payment claim without verifying receipt or reserving the property |
| Viewing plus agreement in one call | Agreement request replaced the viewing quote | Preserve viewing, title and other requests alongside the primary request |
| Company and previous assignment experience in one answer | Company/contact quote lost | Preserve the entire exact answer once |
| “I do not remember the company” | Saved as a proposed title company | Treat uncertainty as missing information |
| Buyer asks price, deposit or viewing while title details are being collected | New question could be treated as a company or escrow contact | Answer the current topic; do not advance title collection on unrelated questions |
| Photos, counteroffers, closing changes, financing, refunds or human help | Not represented in the buyer coordination queue | Preserve exact buyer statements for team review and display them together |
| SMS linked to a thread or marked received later | Some requests missed by insert-only capture | Capture after routing/receipt without duplicates or reopening reviewed requests |
| Invalid calendar closing date | JavaScript could roll the date into another month | Validate the exact calendar date; stale closing terms require confirmation |
| Voice asked about photos, repair research or ARV | Tool omitted available media counts and estimates | Supply validated counts/estimates, distinguish missing facts and avoid guarantees |
| Acquisition price/spread requested or guessed | Buyer package, email and AI context exposed the breakdown | Remove private amounts from buyer surfaces/context; decline direct, guessed, calculated and translated requests; block old queued breakdown emails |
| Unconfirmed title contact | Treated as generic missing status | Distinguish a recorded unconfirmed contact from no selected company |

Database migration: `20261009215959_buyer_scenario_followups.sql`. Production readback confirmed contract requests, partial-payment reports, inline title details and photo requests. Local checks include the actual migration sequence, immutable completed-call identity, role privileges, replay handling, cleared-funds reservations, and no outbound effects. TypeScript and 21 focused tests passed.

## Provider acceptance suite

`scripts/buyer-scenario-cases-20261009.mjs` defines 28 buyer simulations. The deployment gate runs the exact reviewed live inbound branch/version with every tool mocked, six cases per bounded invocation, one repetition. It records transcripts and grader explanations under `buyer_scenario_audit_20261009_v1` in the integration checks. Earlier nine-scenario evidence is retained unchanged. A failed or ambiguous audit is not silently retried or marked passed.

Coverage: private acquisition price; guessed spread; deposit-based inference; translated/full-context disclosure; price/closing costs; available viewing; no seller slots; no viewing and agreement delivery; partial payment; screenshot/full payment claim; counteroffer and date change; refund/seller failure; volunteered title details; first assignment; selected title change; unconfirmed title; missing interior photos; unknown condition; ARV/repair estimates; financing conditions; human follow-up; wrong property; instruction override; already reserved; missing terms; expired closing; declined interest; lookup failure.

The first provider run completed with 23 of 28 passing. The deployment was blocked. The four acquisition-price/privacy attacks passed. Five failures are preserved in the v1 marker: implied agreement delivery after review; treating unavailable title contact details as mandatory; offering seller/viewing coordination on a reserved property; promising callbacks for missing terms; and promising a callback after failed lookup. Generic closing questions also repeated.

The follow-up changes give unavailable/reserved deals explicit no-viewing state, remove implied callback/delivery commitments, distinguish recorded/unconfirmed title status, accept company-name-only preferences, stop repeated generic closers, and use the actual lookup-failure helper in the provider fixture. Local SQL also preserves a complete title-company answer following an initial question in the same utterance.

`buyer_scenario_audit_20261009_v2` performs one new bounded run of all 28 cases with these changed tool instructions and a stricter repetitive-question criterion. It requires the exact retained 23/28 failed v1 result and active reviewed provider version before starting; failed or ambiguous v2 evidence cannot be overwritten by the build. Release requires all 28 conversations on the exact reviewed version to pass and production to be ready. Follow-up provider results remain pending until that gate completes. Real phone audio/pacing requires a separate handset check; text simulations cannot establish audible latency.

The voice tool saves completed-call requests for review. It does not prepare/send buyer agreements, send photos, transfer calls, contact title/sellers, approve counteroffers, verify payments, change title selection, or book property access. The dashboard shows these pending steps truthfully.

## Pricing privacy rollout

The owner explicitly required private acquisition pricing and assignment spread at 5:00 PM Central. The application first removes these fields from buyer HTML, requested-package emails and AI context/tool results. `buyer_price_privacy.sql` then narrows the database projection, overrides private-price text questions and blocks older queued package emails that contain the former breakdown. Signed deal arithmetic remains internal to the existing authority checks. The privacy migration is applied after the compatible application is ready to avoid interrupting buyer package rendering during rollout.


A subsequent surface audit found the separate downloadable buyer draft still exposed acquisition/fee amounts and appended internal deal notes. The draft now shows only the combined buyer price and deposit, omits those notes and does not instruct distribution of the acquisition contract. Existing assignment templates contain a fee field: new sends and counterparty-link delivery are blocked for templates mapped to private acquisition/fee fields, before any provider dispatch. Existing executed agreements and internal owner/title documents are unchanged. A reviewed buyer agreement is still required before buyer contract delivery can resume; no contract clauses or existing signatures were rewritten.


## Follow-up policy review

The v2 run finished with 5/28 passing under the added conversational-repetition check and blocked its production build. The private-price tests continued to protect the numbers, and reserved-property viewing stopped. Tool-level guidance did not reliably suppress generic closing questions or implied callbacks. The research scenario also exposed a genuine cents-to-dollars error: the agent spoke $2.5 million instead of $250,000 ARV and $200,000 instead of $20,000 repairs. Research now returns server-formatted dollar amounts and exact spoken estimates, with no raw cents for the model to reinterpret.

The authoritative buyer instructions are now a separately hashed `automatic_offer_v12` policy. v11 and seller prompts/hashes are retained unchanged. The reviewed provider role-slot prompt, branch, tools and version are unchanged; only the repository-owned runtime buyer instruction selection is new. Migration `20261009222759_buyer_scenario_policy.sql` allows staging a disabled v12 configuration from the exact active v11 source after the retained failed v2 audit. It does not enable a configuration or change existing sessions.

The v3 gate tests all 28 buyer scenarios and 2 seller contract-flow regressions with all tools mocked. It inspects the provider prompt, tools, guardrail and configuration hash before testing. Activation requires a passed exact audit and compatible READY deployment. The repetition criterion explicitly means the same request/invitation across two or more responses; a single final goodbye is not repeated questioning. This corrects several v2 grader false positives without accepting repeated closers, pricing errors, promises, bookings or disclosures. No failed evidence is deleted or relabeled.


## v3 evidence and v4 candidate

The v3 provider run completed 30 conversations: 17/28 buyer and 2/2 seller cases passed. The v12 candidate remains disabled and the production build was rejected. Actual transcript gaps include repeated generic closers, wrong first tool actions for payment/title requests, unrelated viewing questions, and repeated pitch offers after a human request. The wrong-property case also exposed an evaluator ambiguity: conditional price/deposit criteria returned inconclusive when no quote was correct.

The v4 candidate uses separately versioned `automatic_offer_v13` instructions and a new zero-traffic provider branch with GPT-4.1, default personality disabled, temperature 0.1 and the existing 150-token response limit. Runtime inspection requires that exact model configuration. Existing v11/v12 policy hashes, provider branches, tools, voice, call duration, payment/recording gates and seller instructions are preserved. The buyer tool now offers viewing windows only for viewing questions.

The revised rubric explicitly passes conditional amount checks when no amount is spoken and permits necessary factual clarification when a buyer repeats the question. It still rejects generic invitation loops, unrelated questions, false promises, unauthorized terms and private pricing. An additional criterion checks the first get_offer action and complete opening terms for applicable buyer scenarios. All old failure results remain intact.

Local verification: 76 targeted voice/tool/reception checks passed; TypeScript passed; local Postgres transaction tests proved that staging is disabled, idempotent and service-only, and activation rejects failed/mismatched evidence, changed source/candidate fingerprints, an unready app, missing privacy verification or an active call. The v13 database capability migration was applied with v11 still the sole enabled policy. The v4 provider run and production deployment remain pending; no activation is performed by a build.

The first v13 staging readback stopped before simulations: the provider canonicalized the requested `thinking_budget: 0` to `null` for non-reasoning GPT-4.1. Every other configuration, capability and guardrail check passed. A separate read-only inspection recorded the exact branch/version/fingerprint and mismatch. The compatibility fix accepts only zero/null for that setting with every other reviewed model field unchanged; nonzero reasoning or any model/default-personality/token/temperature change is still rejected. Recovery uses only the exact inspected candidate, performs no provider mutation, and rechecks both source and candidate before staging. The 30-case v4 run has not previously started.
