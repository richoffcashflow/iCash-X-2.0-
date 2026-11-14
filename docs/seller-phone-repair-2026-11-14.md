# Seller phone progression repair

The latest owner call repeated waiting phrases and answered questions, lost a calculated cash offer after an interrupted timing answer, and restarted its opening greeting. The original call and financial evidence remain unchanged.

## Reproduced application failures

- An adjacent timeline question, cut-off timing answer, presence check and completed timing answer failed the existing immediate-question matcher. The ordinary timing answer became a material-change hold and erased the quote. Recognize only this bounded timing-only continuation. Real property, debt, ownership, price and mixed corrections retain their holds.
- A plain negative answer to the complete mortgage/liens/taxes/HOA inventory was not recognized. Save the two seller-reported zero balances only for an unqualified negative to the complete final question. Partial inventories, qualified debt questions, uncertainty and mixed answers cannot establish zero debt or title clearance.
- The singular question about another owner needing to agree was missing from the initial ownership-answer matcher. It now has the same bounded semantics as the existing plural wording; prior co-owner changes and signer requirements remain authoritative.
- A confirmed, unclaimed intake-lock collision was immediately classified as quota exhaustion. Fresh, exactly bound call-now requests may retry that same admission twice within one second and their original expiry. Generic maintenance, actual quota denials, ambiguous responses and admitted paid work are never replayed. The observed pre-claim delay is real; missing original handler logs prevent attributing that exact delay to lock contention.

Runtime guidance tells the assistant to finish listening, use the corrected conversational name, avoid repeated tool prefaces and never restart a greeting after a tool response. It preserves actual identity, listing, monetary, acceptance, recording and signature requirements. Instructions alone do not establish speech quality.

Recording reconciliation also treated the provider's pending `processing` status as proof that an established live recording had stopped. Pending reads now release the original maintenance lease without changing the established recording state. Stop, ended and failed callbacks that win during that read remain authoritative. The actual handler and SQL fixture reproduce the old state change and cover these races. This is a separate confirmed lifecycle defect, not a proven cause of this outbound call's missing offer.

## Provider turn settings

The historical provider preparation configured an eager turn detector and a fixed two-second “One moment” filler. The new reviewed candidate preserves all other settings, disables the automatic filler timer, uses normal turn-taking and waits ten seconds before a silence prompt. The existing provider version and its reviewed fingerprint must be updated together through a separately verified rollout. An application deployment alone does not change the active provider configuration.

`scripts/stage-seller-voice-turns.mjs` is inert in ordinary builds. Explicit staging requires the exact production-main commit and pinned current inbound/outbound reviews. It validates the actual source agents and tools, creates zero-traffic child branches with only the reviewed turn-setting changes, rechecks sources and full candidate configurations, and saves private candidate evidence. A durable per-commit/direction intent precedes each branch creation. Lost responses permit GET-only reconciliation of that original deterministic branch; they never authorize another create request. No active configuration, enabled flag, account approval, caller route, rate or provider tool is changed by staging. Printed output excludes credentials, prompts and contact details. Activation remains a separate reviewed operation after exact release verification.

## Verification and release

Fictional replays use the actual offer service for inbound and outbound conversations, including interrupted timing, debt and ownership answers, the same conditional price through acceptance, one final terms readback and one simulated agreement. The original helpers fail the newly covered cases. No external model evaluation, paid call, message, contract or historical replay is performed. Preserve customer controls, financial holds, source freshness and exact delivery evidence.

Release uses current-head Reliability checks, the normal expected-head merge, exact main-push checks and verified web/worker deployments. Report application release, provider activation, observed ring latency and a successful live conversation separately. Never label thousands of scenario permutations or passing instruction assertions as real successful calls.
