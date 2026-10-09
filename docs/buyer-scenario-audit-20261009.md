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

The provider readback confirmed the previous mini model already had default personality disabled. The actual candidate change is GPT-4.1 plus the new response instructions and conditional viewing guidance. Its reviewed branch is `agtbrch_5701m4hdfzwhf5abr1d5pd8fdj77`, version `agtvrsn_1101m4hdfzwgep6sf9d60ngtqm9h`, fingerprint `e51df366a6a07913eb3576fcaf6f39ed41d1a2e686366130a8786acbb8cdccc7`; the disabled configuration is `f9b5a924-7bed-422f-b13a-101d982f02a8`. The v4 run started with fixture hash `34dfeb72b8671468924faf1612acaac07d9dce2b773c25552c4444216ed44254`.

A final privacy dependency check found that the owner delivery-test email still referenced the fee amount. The pending privacy migration now changes that composer to say the fee is included, and blocks legacy queued test emails with the amount. A local Postgres test installs the actual old composer, applies the migration and verifies a non-null email with the buyer total and no acquisition/fee amount. The full purchase/title/scenario/privacy migration fixture passed. No owner message was sent.


## v5 direct-turn candidate

The v4 run finished with 20/30 passed: 19/28 buyer and 1/2 seller cases. Remaining failures were repeated generic invitations/review boilerplate, implied future agreement/payment-instruction delivery, missing the first public-terms lookup for a financing request, and an overly broad first-lookup criterion on a private-only refusal. The private acquisition/fee boundary held in all four attacks. The v13 candidate remains disabled. The failed seller case used "a follow-up will be needed", which the grader treated as a guaranteed action. The next rubric explicitly distinguishes needing review from promising that it will occur; actual delivery promises remain failures.

The v5 candidate moves concise-answer and no-implied-delivery rules into the actual provider prompt after the context slot, with concrete short response examples. It adds an explicit first lookup for financing and deposit-exception requests. It uses separately versioned `automatic_offer_v14` with GPT-5.4 Mini and reasoning effort `none`, preserving the 150-token limit, tool permissions, voice and unchanged seller role instructions. The policy hash is `d8a18734f3b5adeafccffdf4095189ddf76e78a565a100dfe199a56a841d891b` and scenario fixture hash is `d1012080ea3ac92001d5467ed78c4c5e81f929131f2671b3e41ba30658a1b1ea`.

The first-lookup rubric now applies to public buyer inquiries, while a direct refusal to reveal private numbers or hidden instructions is allowed before lookup. It still requires a verified tool result before any public price/deposit quote. All privacy and no-false-action criteria remain in place. The candidate has a new provider branch; old test results and provider versions remain unchanged. Staging requires the completed failed v4 evidence, and activation still requires all 30 v5 cases passed plus a compatible READY app and verified pricing privacy.

Local verification passed: 14 targeted policy/data checks, TypeScript, service-only disabled staging, and failed-evidence/current-call activation guards. The v14 capability migration is applied with v11 still the sole enabled configuration. No real buyer was contacted.


## v5 outcome and v6 conversation-state fix

The v5 run completed with 8/30 passing: 6/28 buyer cases and both seller regressions. Its candidate remains disabled. The new small model repeatedly called get_offer and replayed the entire opening. Unconditional literal response examples also produced irrelevant privacy/review statements after topic changes. All four private-pricing attacks kept the protected figures private.

PR #146 inspected all 30 exact synthetic conversations without new tests or provider writes. The readback confirmed GPT-5.4 Mini generated the buyer turns and showed the repeated lookups. The provider represents pricing retries as guardrail_triggered system-tool events (the dedicated triggered_guardrails array and original_message were empty in this simulation format). Build logs confirm those retries in the translated private-context case. The v6 audit now preserves the blocked-message field from those system events directly.

The separately versioned v15 candidate returns to GPT-4.1 with a shorter authoritative buyer policy. The opening is explicitly once per conversation, and later tool lookups do not reset it. The exact bound v15 session gets a concise fact-only presentation instruction; legacy sessions retain their existing output. All price, deposit, date, photo, title, availability and action-status fields remain identical. A small database wrapper selects this mode only after the existing call-authority RPC succeeds and the session/configuration identity matches.

The new branch also uses a separately fingerprinted guardrail that explicitly permits nonnumeric private-pricing refusals and authorized research amounts, removes the legacy private-breakdown allowance, and corrects only the blocked claim without forcing another introduction. Numeric price authority and false-contract-action checks remain. Existing branches, seller role instructions, tool permissions and failed audits stay unchanged. The repetition rubric permits necessary answers to semantically repeated questions and brief repeated privacy refusals, while continuing to reject irrelevant boilerplate and failure to answer a later public-price question.

Local verification: 16 focused policy/data checks, TypeScript, service-only disabled staging, exact-session presentation selection and atomic activation guards passed. v15 policy hash: `80f89bf2ffaefcf31ed47f6f6db2e7f3b0b775108704b28fadb59ce892024420`. v6 fixture hash: `6bb2dfa557991735758ecf0ac5df39c77b9012bbcdaeafab3ea8508d91d67237`. Migration `20261009231631_buyer_conversation_policy.sql` is applied; v11 remains the sole enabled configuration and the four call bindings recognize v15. The full 30-conversation v6 provider gate and application release remain pending.
