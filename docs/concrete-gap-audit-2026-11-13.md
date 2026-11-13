# Concrete gap audit — November 13, 2026

The owner requested 1,000 concrete gaps and fixes, then prioritized outbound scenarios and unattended operation. This change repairs **16 distinct failure modes** found in the current implementation. It does not claim 1,000 confirmed defects, perfect reliability, verified live calls or guaranteed deals. Test permutations, intentional holds, informational database advisories and inactive-account observations are not counted as defects.

Baseline: `0dc3e4eb3cc531d37bed9ec255184736d8a78658`. The existing UI, original provider operations, financial reservations, source/recipient bindings, contact controls and final dispatch claims remain in place. There are no schema, provider configuration, budget, contract-template or historical replay changes.

## Repaired failure modes

| ID | Concrete trigger and previous behavior | Repair and executable evidence |
| --- | --- | --- |
| G01 | Address-completion matching throws or waits; the initial text and call never start. | Independent completion and first-contact tasks, all awaited. `inbound-lead-failure-isolation` covers lookup, queue, send and deferred completion. |
| G02 | Property research fails or stalls in the worker or saved-address continuation; first contact waits behind it. | Research and contact start independently, retaining their original final claims. The actual service and address route are exercised. |
| G03 | Meta intake is durably accepted, then assignment fails; the accepted inbox notice is reset to pending. | Downstream work returns pending without undoing acceptance. Original receipt and one acceptance attempt are retained. |
| G04 | An acceptance PATCH commits but its response is lost; the error handler downgrades the accepted Meta or Make receipt. | Failure updates require `state=neq.accepted` on the original claim token. Both transports have lost-acknowledgment tests. |
| G05 | One checkpoint, row read, research, assignment, follow-up or offer operation throws; later leads in the batch are abandoned. | Stage failures are isolated without retrying the failed step in that pass. The unchanged three-lead cap is retained. Faults are injected at all three positions. |
| G06 | A lead-work exception exits while three already-started conversion deliveries remain unawaited. | Every launched measurement promise is awaited, including failed passes. Tests assert all three complete before the worker returns. |
| G07 | Follow-up dispatch resolves with a held or failed transport status; `allSettled` is mistaken for successful processing. | Only accepted/delivered texts and started calls qualify as processed; rejected work is counted. Holds and unknown outcomes remain pending without replay. |
| G08 | Inbound work fails, but seller maintenance reports HTTP 200. | The actual cron route returns 503 for failed inbound work, including disabled-acquisition mode, while independent work continues. Make and Graph failures retain visible pending outcomes. |
| G09 | A malformed expiry parses to `NaN`; the address-link expiry comparison passes. | Require an explicitly future timestamp. Invalid, empty and expired values queue nothing. This is defensive input handling, not evidence of a production exploit. |
| G10 | Buyer estimates/searches use an anonymous quota call and omit finish receipts, losing remaining-quota headers, 429 cooldown and unknown-outcome evidence. | Use the existing scoped request ledger for `buyer_estimate` and `buyer_search`, including account, operation and unique request IDs. Tests cover response, 429 and unknown outcomes, strict admission, final spending denial and no paid retry. |
| G11 | Entity deduplication retains a higher-scoring contact without permission or beyond the remaining budget, hiding a permitted affordable contact at the same entity. | Check each contact's own permission and cost before selecting one entity representative. Preserve its own identity/evidence, one contact per entity, the five-contact cap and reserve. |
| G12 | Successful auto-sign/late-expiry writes and failed Graph reads leave unused HTTP response bodies open. | Cancel unused bodies before proceeding. Stream fixtures verify cleanup; signature confirmation still comes from the existing canonical readback, with no write retry. |
| G13 | Signed-PDF and Meta receipt limits are checked after buffering complete downloads; chunked or misleading lengths can exceed the memory budget. | Reject oversized declared lengths before reading; enforce 20 MiB for PDFs and 64,000 bytes for Meta receipts while streaming, cancel on overflow and release readers. Tests cover declared/chunked/misleading lengths and exact valid bytes. |
| G14 | A seller-response bookkeeping write fails after dispatch; later sellers in the batch receive neither their independent text nor their call. | Complete every independently admitted row and report the bookkeeping failure afterward. Original channel claims still own delivery; no channel is repeated. The real service is exercised across 5,832 mixed fault combinations. |
| G15 | A buyer-network email throws after its attempt counter increments; the catch increments it again, abandoning a later buyer. Any held send also suppresses continuation despite a full candidate batch. | Bound by three selected candidates, count each dispatch once, continue after per-buyer failure, and keep a full selection eligible for another scheduled pass. Queue failures, missing queue IDs, held sends and unknown sends are injected at each position, including an oversized selection. |
| G16 | Customer-update or attention dispatch returns a `needs_review` status; account follow-up ignores it and falsely acknowledges reconciliation as successful. | Propagate explicit failure statuses into the existing durable retry acknowledgment, while still attempting the other independent notification. Original one-use notification claims prevent a provider replay. |

## Outbound recovery coverage

`tests/outbound-continuation.test.mjs` executes the actual seller-response service for all **5,832 combinations** of accepted, review-held or thrown SMS/call results across three sellers, crossed with all eight subsets of failed bookkeeping writes: `3^6 × 2^3`. Each combination checks exact account and lead binding, all six independent channel attempts, one attempt per channel, three truthful outcome receipts, and a visible error when any receipt fails. These are synthetic boundary tests; they do not prove provider delivery, call quality or database concurrency.

Existing dispatch, deferred-text, unknown-call, worker-recovery, fulfillment and isolated-database suites remain the evidence for their respective admission and recovery paths. The fix does not replace unknown outcomes with automatic redials or resends. Bounded continuation selects newly eligible work through the existing final claims.

Read-only production sampling also found `business_number_mismatch` holds. Most sampled affected threads belonged to an SMS-enabled sender without enabled/verified outbound calling; a small remainder required further diagnosis. That is a configuration dependency, not permission to rotate established conversation numbers, bypass verification or count each held job as a separate code defect. No sender or provider configuration was changed by this patch.

## Verification and release

The new tests execute the real services and routes with fictional database/provider boundaries. Buyer cursor tests also execute the existing SQL against isolated PostgreSQL. No paid calls, texts, signatures, data purchases or customer messages are used for development verification.

New suites are registered in `scripts/verify-release-local.mjs`; `scripts/test-all.mjs` discovers them automatically. Relevant existing intake, buyer, signing, maintenance and contract tests remain required. Type checking, an application production build, the local release checks, and the canonical exact-head Reliability checks gate this release. A merge or passing preview is not production verification; follow `automatic-releases.md` and `production-release-gate.md`.

| Local verification | Result |
| --- | --- |
| `node scripts/verify-release-local.mjs` | All 425 required suites passed on the final application changes. |
| `node scripts/test-all.mjs` | All 917 suites passed on the final application changes, including the 5,832 seller batch fault combinations. |
| `node node_modules/typescript/bin/tsc --noEmit --incremental false` | Passed on the final application changes. |
| `node node_modules/next/dist/bin/next build --webpack` | Production build passed on the final application changes. |
| Bounded concurrency simulation | All eight phases passed. This does not replace native concurrent PostgreSQL release checks. |
| Browser coverage | Earlier desktop Chromium checks and desktop/mobile Chromium seller-form checks passed. Local WebKit could not launch because `libGLESv2.so.2` is missing. The last outbound changes have no UI edits. |

Publication and exact-head/exact-main CI, web and worker release verification are still pending. The existing production worker's successful deployment predates these local fixes and is not evidence they are live.

Remaining scope: this pass does not demonstrate a live end-to-end closing, establish live ring latency, fix every funded-account progress warning, resolve unverified caller IDs or complete the requested 1,000-gap audit. Further findings need their own concrete reproduction and verified fix. Intentional RLS denial policies and quota pacing must not be disabled to make an audit count or dashboard look better.
