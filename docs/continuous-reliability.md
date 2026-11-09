# Continuous reliability

## November 8 deferred text recovery

The [deferred text recovery investigation](deferred-text-recovery.md) found stale
and fresh screenings together in the sender-volume waiting queue. A correct
pre-send refusal previously ended the entire maintenance pass. The service now
checks at most four distinct candidates, continuing only on three explicit
pre-transport holds and stopping after the first SMS attempt or any uncertainty.
The regression fails against the predecessor and passes with the bounded loop.
Original SQL claims, rolling caps, sender continuity, financial/contact freshness,
receipt holds and customer controls remain unchanged. This is not a release of
stale discovery messages, restoration of a disabled line or provider recovery.
Exact-head CI and production verification remain required for release.

## November 7 unused response cleanup

The [HTTP response lifecycle audit](http-response-lifecycle.md) reproduced unused
response bodies remaining open after database/authentication rejections and
successful worker dispatches. Cancel only responses the caller no longer needs,
after any financial classification, preserving authentication status and the
worker's exact durable-hold acknowledgment even when cleanup fails. No request,
capability or provider operation is replayed.

`http-response-lifecycle.test.mjs` checks the actual helpers, cleanup failures,
original financial/authentication/dispatch outcomes, and native loopback streams
that must close promptly. All four groups failed before the repair and passed
afterward; this suite also runs in local release verification. Read-only live
evidence still showed missing SMS delivery confirmations and old pending provider
work. Those remain separate unresolved conditions; transport cleanup is not proof
of carrier recovery or settlement.

## November 7 monitoring gap audit

Read-only production evidence at 11:40 AM Central showed 128 call-start
tickets and 49 saved conversation results in the preceding hour. Twenty seller
introductions had provider acceptance, which does not prove delivery. The work
snapshot still flagged four funded accounts without completed usage and 107
with old pending work. Their original receipts and holds were not changed.
Worker logs also contained transport timeouts whose stage was lost.

The audit reproduced these failures in the actual worker and maintenance route:

- Failed scheduler transport/body reads lost their operation before reaching the
  recurring-failure monitor. Successful idle polls could erase their current
  error state. Preserve the fixed operation and timeout/failure code so the
  existing bounded recurrence window sees them. Distinguish a failed claim from
  an uncertain dispatch; neither is retried within the invocation.
- Maintenance could record a healthy heartbeat before voice verification
  finished, and still return success after that verification or configuration
  recovery failed. Include its existing promise in the independent maintenance
  batch. Other lanes still run concurrently; failed optional one-time changes
  still permit the ordinary fresh capacity read.
- Missing text-receipt configuration returned zero write errors and was treated
  as a successful check. Only completed or genuinely idle recovery qualifies.
- Failed research configuration repair logged an error but returned a successful
  monitoring result. Keep the account snapshot and incident observation running,
  record a degraded heartbeat before observation, and return an unsuccessful
  monitor result when either repair or snapshot fails.

`worker-transport-failures.test.mjs` composes the real RPC client, dispatcher and
scheduler. `maintenance-failure-health.test.mjs` exercises the actual authenticated
route, monitor and batch, including slow voice checks, failed repairs, unknown
configuration, parallel recovery and private-error redaction. Existing worker,
heartbeat, failure-isolation and monitor tests remain required. No schema,
provider settings, billing, customer controls or original holds change.

These are monitoring and failure-detection repairs. They do not establish SMS
carrier recovery, settle unresolved provider charges, or prove that the four
flagged accounts have resumed completed work. Production release still requires
the exact candidate and merged-main Reliability checks and matching web/worker
deployments.

The November 5 [outbound result recovery](outbound-receipt-drain-2026-11-05.md)
addresses a measured 14–16-minute delay after calling resumed. Recording maintenance
can refill its twelve-record batch up to four times inside the same deadline and
three-row concurrency limit, retaining original leases, exact receipts and unknown
holds. This is recovery capacity, not permission to replay an outbound call.

The November 5 [production follow-through](reliability-followthrough-2026-11-05.md)
records real outreach after the restored scheduler/voice release and the remaining
account/quota findings. It also removes repeated JSON extraction and duplicate
same-result disposition scans from the owner outreach report, preserving the
canonical classifier and every report predicate. Actual before/after report,
malformed-source, permissions and atomic migration checks cover this read-path
change; it never changes holds, money or provider actions.

The November 4 custom-voice preview stores a short, private sample for repeated
playback without customer-credit usage. The actual SQL/service/route fixture
covers account and VIP isolation, zero-balance playback, one-use generation,
unknown outcomes and exact-history recovery. Native concurrent-click and
desktop/mobile audio scenarios run in Reliability checks. No calls, live-voice
selection changes or paid development demonstrations are required; see
`custom-voice-preview.md` for rollout and retained provider receipts.

The November 4 failure-isolation repair separates a known failed research job
from a failed worker. The automation API keeps its failed HTTP outcome, original
held ticket and operator diagnostics. Only an allowlisted provider/receipt
failure with an exact durable hold receives the worker acknowledgement; the
worker then claims a new capability at its normal cadence. Missing or uncertain
completion, database errors and invalid shared configuration retain infrastructure
backoff. No failed capability is replayed and no financial hold is released.
`automation-failure-isolation.test.mjs` composes the actual API, runner and
scheduler to verify repeated failed research jobs followed by independent work,
continued voice/text dispatch, stale acknowledgements and infrastructure errors.

With dedicated recovery enabled, acquisition no longer executes the global
pending research settlement sweep before selecting an account. Existing durable
account follow-ups retain actual-receipt settlement and orphan recovery; legacy
dispatch retains its original fallback. This removes one bad or busy saved
receipt from the shared selection path. It does not remove the shared scheduler
lock or establish that every remaining selector has a strict runtime bound.
Production read-only evidence before this repair showed eight held research
jobs alongside completed research, texts, signing checks and account recovery in
the same two-hour window. That demonstrates partial progress, not a total stop
or proof that every funded account was working. Exact-release CI and deployed
web/worker/database verification remain required before claiming this repair live.

The same isolation review found that a failed maintenance heartbeat or account
snapshot skipped subsequent incident detection and alert dispatch. Monitoring
now attempts its independent stages even after another stage fails, retains an
unsuccessful monitor result, and lets the existing incident logic evaluate the
last persisted evidence. It never invents a fresh snapshot or recovery. The
actual monitor fixture covers heartbeat, snapshot and alert failures without
provider calls; existing stale-evidence and notification idempotency checks stay
authoritative.

Fulfillment also keeps buyer delivery independent of its optional intermediate
progress checkpoint. A failed checkpoint logs a fixed operator diagnostic and
continues the existing separately admitted buyer text/email paths; the complete
final summary is still required. Documents remain durably prepared first, and
each channel retains its own authority, funding, one-use receipt and unknown-send
checks. The ordered service fixture covers checkpoint failure, channel failure
and final-summary failure without sending messages.

The November 4 access-message correction removes the disabled checkout-phone
sign-in recommendation left in purchase confirmations, reminder emails and
permission-bound access texts after the UI/support repair. Both email formats
direct buyers to their checkout email, spam/junk folder and existing support
link. `purchase-access-email.test.mjs` covers initial/reminder and VIP/non-VIP
variants; `purchase-access-followups.test.mjs` verifies dispatched reminder and
single-segment text copy, opt-out wording and the existing immutable-retry gates.
No auth, consent, queue or migration behavior changes. Already attempted payloads
remain frozen for provider idempotency; do not resend historical messages to
demonstrate the correction. Exact-commit CI and the matching production release
must pass before calling it live.

The November 3 new-user reserve protects starter research capacity at the shared
limiter, with account-aware scheduling and operator capacity reporting. See
`new-user-request-reserve.md`. Offline and native contention coverage must verify
the ordinary boundary, global cap, per-account allowance, original one-use
requests, provider holds and nonrenewable first-funding eligibility before
activation; queued research is not a completed starter outcome.

The November 3 reporting repair decouples completed activity from credit refills, shares calendar periods across the workspace, and retains recurring scheduler database failures across successful/idle polls. See `opportunity-progress-reliability.md`. Regression coverage validates original event dates, tenant/practice boundaries, missing metrics, stale response races and bounded health recovery.

The November 3 continuation addresses ordinary scheduler scans entering owner-only evidence, historical-ticket/property scans, configuration-recovery contact joins, global text-thread history scans, repeated explicit empty owner previews, proven current pre-dial abort holds and missing outgoing-text delivery receipts. See `remaining-outage-recovery.md` and `text-delivery-recovery.md`. Nine native PostgreSQL scenarios cover predicate isolation, both acquisition indexes, configuration lookup and competing recovery, the text-thread index, concurrent empty-preview persistence, reviewed local-rejection recovery, abort/create races and canonical text recovery versus callbacks. They complement actual-service PGlite tests; none sends paid development outreach.

The follow-on November 2 hardening reproduces already-started batch siblings blocking selection, cleanup deleting valid waiting lists, blank owner names rejecting original successful exports, and proven unanswered browser calls retaining money. See `recovery-hardening.md`. Native PostgreSQL covers candidate admission, delayed count/cleanup contention, bounded saved-artifact leases and unanswered settlement with late-child races. All changes retain original financial evidence and the full production release gates.

The November 2 account-work recovery also covers expired free contact checks. `owner-preflight-renewal.test.mjs` exercises immutable successors, expiry/cleanup, fresh positive admission and control/source changes. `test-owner-preflight-postgres.py` races 24 renewals and a customer Pause across real sessions. The migration remains disabled until the matching web and worker release passes all checks; actual provider recovery must be observed separately.

Reliability means that supported work advances, waits for a real prerequisite, or reports a specific failure with a recovery path. A running worker and a passing build do not establish that customer work completes. No release can prove every possible scenario or guarantee zero bugs.

## Release contract

1. Read current main, relevant instructions, open changes and production evidence. Preserve newer fixes and user intent.
2. Map each affected journey from entry through persisted state, scheduler selection, provider admission, receipt, settlement and customer-visible outcome. Check both empty queues and mixed active features.
3. Reproduce each material failure with executable tests before fixing it. Keep tests for behavior and invariants, including failure/recovery paths. Do not replace real function bodies with successful stubs when testing that function.
4. Exercise concurrency on native PostgreSQL when locks, leases, uniqueness, generation counters or foreign keys matter. Local single-session PGlite tests complement this; they cannot establish lock behavior.
5. Run the existing exact-commit Reliability checks: every offline suite, production dependency audit, build, bounded concurrency, Chromium and WebKit browser checks, and native PostgreSQL contention tests. Required failures block production admission.
6. Apply compatible, guarded migrations with actual migration-history versions. Never replay provider operations, release unknown money holds or rewrite historical evidence as a recovery shortcut.
7. Verify the exact main-push check run and both production deployments. Observe ordinary scheduler/receipt progress and fresh integration diagnostics. Record remaining degraded conditions honestly.

## Scenario coverage map

The November 2 source inventory contains 237 API route files. The worker separates general, recovery, messages, voice and research lanes; scheduled maintenance reconciles original receipts. This table identifies the critical journeys across those surfaces. Endpoint inventory is not a claim that every route or live paid outcome was manually exercised.

| Journey and trigger | Actual entry points | Required persisted outcome and failure handling |
| --- | --- | --- |
| Sign in and resume | `/api/auth/email`, `/api/auth/verify`, `/api/auth/dashboard-password` | Account-bound authenticated session, or visible denial/expiry; stale private reads cannot survive access loss. |
| Subscription or credit purchase | `/api/payments/checkout`, `/api/funding/checkout`, `/api/webhooks/stripe` | Verified payment receipt grants the matching access/credits once; pending checkout is not described as funded. |
| Setup and activation | `/api/setup`, `/api/work/activation`, `/api/work/readiness` | Saved configuration and explicit account controls determine eligibility; legitimate Pause, missing funding or disabled channels remain specific prerequisites. |
| Research and enrichment | `/api/work/discovery`, `/api/internal/automation`, `/api/internal/property-check` | Persisted property/contact results and original provider/cost evidence; rate limits back off, unknown purchases stay held, unrelated eligible lanes continue. |
| Fresh seller intake | `/api/webhooks/meta-leads`, `/api/webhooks/make-leads`, `/api/work/instant-leads` | Source-bound lead and eligible initial outreach; duplicate events do not create a new contact request or override opt-out. |
| Calls and recording | `/api/internal/voice/inbound`, `/api/internal/voice/recording/*`, `/api/work/call-history` | Distinct queued, dispatched, consent, terminal and recording evidence; preserve the reviewed agent, recipient authority and original uncertain call. |
| Texts and inbound replies | `/api/webhooks/contiguity`, `/api/internal/messaging`, `/api/work/messages` | Save original incoming events, select one next action, distinguish accepted from delivered, resume from the original late receipt and suppress duplicates. |
| Qualification, offers and negotiation | `/api/internal/voice/cash-offer`, `/api/work/deals`, seller/buyer progress in the shared dispatcher | Supported asking/offer/acceptance states remain distinct; collect missing facts, preserve customer edits and frozen terms, surface only unresolved authority decisions. |
| Contracts and signatures | `/api/work/signing`, `/api/internal/voice/seller-agreement`, `/api/work/documents` | One authorized envelope and authoritative signatures; unsupported terms or missing signatures cannot advance to a completed purchase. |
| Buyer outreach, visits and deposits | `/api/work/buyer-network`, `/api/work/buyer-coordination`, `/api/work/showings`, `/api/internal/journeys` | SMS/email outreach, published terms, confirmed availability and real deposit evidence; no invented booking, discount, deposit or buyer call. |
| Title and closing | `/api/webhooks/title-email`, `/api/work/title`, `/api/work/title-tasks`, `/api/work/closing` | Authenticated correspondence and recorded closing evidence; counterparty waits remain visible and completion is never inferred from elapsed time. |
| Support and notifications | `/api/support`, `/api/webhooks/support-email`, `/api/notifications/updates`, `/api/notifications/preferences` | Scoped support history, delivery receipts and current preferences; cancellation, unsubscribe and access loss remain effective. |
| Operator control and health | `/api/admin/overview`, `/api/admin/accounts/view/*`, `/api/internal/maintenance`, `/api/health` | Scoped private views, freshness and actual workflow evidence; external scheduled health checks and account-outage monitoring supplement worker heartbeats. |

These are existing executable coverage anchors, strengthened by this release. They are not a claim of live paid end-to-end execution.

| Journey | Coverage anchors | Required failure cases |
| --- | --- | --- |
| Signup, paid access and funding | `private-free-signup.test.mjs`, `workspace-subscription-lock.test.mjs`, `support-checkout.test.mjs`, `wallet-funded-prospecting.test.mjs` | Duplicate receipts, missing access, depleted credits, explicit Pause and tenant separation |
| Research and contact admission | `scheduler-reliability.test.mjs`, native owner-preflight and automatic-export tests | Empty inventory, unavailable provider, exact prior-operation evidence, Retry-After, concurrent claims and unknown purchase outcomes |
| Seller calls and texts | `recording-agent-comparison.test.mjs`, `required-call-recording.test.mjs`, `seller-text-offer.test.mjs`, native seller-progress test | Empty/mixed-feature scheduler, duplicate messages, delayed delivery, superseded replies, changed agent identity/configuration, interrupted calls and opt-out |
| Negotiation and agreements | `seller-text-offer.test.mjs`, `automatic-contract-preparation.test.mjs`, `standard-contract-signing.test.mjs`, `original-contracts.test.mjs` | Unsupported prices, missing confirmations, duplicated events, frozen agreement data and actual signer authority |
| Buyer disposition and title | `buyer-coordination-route.test.mjs`, `buyer-purchase-terms.test.mjs`, `title-inbound.test.mjs`, `title-update-service.test.mjs`, `deal-journey-service.test.mjs` | Cross-deal identity, private acquisition data, delayed counterparty responses, stale terms and completion without authoritative evidence |
| Recovery and operation | `worker-recovery.test.mjs`, `runtime-cost-efficiency.test.mjs`, `scripts/test-account-recovery-postgres.py`, browser/health suites | Shared SQL failures, busy-account fairness, foreign-key deadlocks, single claims, stale completion, durable wakeups and no duplicate paid action |

Use `pnpm test` to run every `tests/*.test.mjs`; follow `.github/workflows/reliability.yml` for native PostgreSQL and browser prerequisites. Native fixtures only target disposable localhost port 55443 and never accept a production connection string.

## November 2 incident ledger

| Failure observed | Root cause and change | Evidence required for closure |
| --- | --- | --- |
| Two old current searches prevented the already-approved standing research configuration | The searches predate request-ledger evidence and cannot use automatic modern continuation. An explicit source-hash/ticket-bound legacy repair records local handler evidence without inventing provider evidence, preserves money and the original ZIP, and atomically restores independent work in a saved alternate market. | Original operation/wallet invariance, native competing claims and Pause, exact standing-rate lineage, unchanged geographic scope and verified new ordinary work. |
| A completed export gateway failure blocks new contacts across accounts | Automatic capacity recovery covered only the original exact HTTP 500 shape. A separately gated 504 policy validates the original gateway receipt and aged finished request, then reuses three free idle-inventory checks. | Native contention for both policies, unchanged original purchase/owner/money holds, matching releases, and an ordinary maintenance verification followed by independent production work. |
| Finished property-search errors freeze three current ZIP configurations | Continuation required an exclusion list and an unknown timeout. Exact completed HTTP 500 failures now qualify behind a disabled rollout switch, retaining every existing independent-ZIP and immutable-operation guard. | Offline request/policy/Pause/isolation cases plus observed distinct-ZIP continuation; original failed searches and commitments remain unchanged. |
| Message/general scheduler repeatedly returns SQL 42702 | Buyer recovery used alias `j`, colliding with an existing PL/pgSQL row variable. The concurrent buyer receipt repair in PR #525 already changed only that alias in production; this release preserves that repair and adds the safe SQLSTATE to worker diagnostics. | PR #525 reproduces the old failure with the actual shared issuer and verifies original delivery reconciliation, including native concurrent calls; fresh production scheduler logs no longer show this error. |
| Receipt recovery deadlocks with ordinary dispatch (40P01) | Recovery held a followup row while the ticket FK waited for a dispatch-locked account. `account-recovery-parent-lock.sql` acquires a nonblocking parent key-share lock alongside the queue lock. | Native PostgreSQL reproduces the original deadlock; the fixed issuer selects another due account, preserves the skipped wakeup, admits one of 16 concurrent claims and rejects stale/cross-account completion. |
| Approved outgoing and incoming voice configurations reject the same provider version | November 2 read-only evidence shows disabled `user_memory` changed from `accept_unverified_identities: false` to the exact `identity_policy.rules=[{verification_method:'workspace_asserted'}]` representation. Compatibility applies only with memory disabled and the legacy field absent; every other field must still reproduce the saved full hash. | Synthetic incoming/outgoing regression cases reject enabled memory, extra rules/fields, malformed values and unrelated changes. Fresh deployment diagnostics must confirm the actual original approvals match. Private redacted evidence is useful for the diff but cannot itself reproduce the full hash. |
| A previous main release failed a WebKit photo access-control page error during fixture navigation | Move the unchanged empty-photo fixture from intercepted fulfillment to the existing local HTTP test server, retaining origin/preview/method guards. Application photo-error handling is unchanged. | Browser checks must still exercise the photo read and assert zero page errors, external calls and unauthorized writes. No error filtering or unconditional test retry is added. |

## November 3 continuation ledger

| Failure observed | Root cause and change | Evidence required for closure |
| --- | --- | --- |
| Scheduler timeouts inside owner proof and calling-hour checks | Ordinary accounts planned owner-only evidence; duplicate timezone work added scanning cost. Short-circuit unrelated accounts before the unchanged owner proof and calculate the same local hour once. | Original predicate equivalence, native owner-evidence lock isolation, exact release and fresh scheduler error observations. |
| Configuration recovery compares millions of unrelated ticket/contact pairs | Correlate the contact UNION to the exact job target before the remaining joins, retaining every original predicate and matching row. | Full candidate/write/audit equivalence, actual UNION lookup plan, 24 competing workers, committed Pause and SKIP LOCKED. |
| Seller text scheduling repeatedly scans message history by thread | Add a thread-leading index for the unchanged global exclusion; account-leading indexes do not efficiently serve that predicate. | Actual selector and generic-plan equivalence, lower buffer work, unchanged history, and late messages across all states, including different or null account IDs. |
| Acquisition repeatedly scans historical ticket and property evidence | Add indexes for the existing active-ticket predicate and property/account lookup without changing admission. | Exact selected rows, original unknown-operation hashes and indexed buffer reductions; live total latency is not inferred from buffer counts. |
| Empty free owner previews repeat for batch siblings | Preserve every exactly bound, explicitly zero-phone sibling from the original successful zero-credit request. | Actual batch services, service-role access, 24 concurrent saves, late Pause/source/operation changes and ordinary production evidence. |
| Live zero-phone previews fail to save despite successful free requests | The recorder rejected the provider's additional `licensed: 0` credit field. Accept exactly the legacy four zero-credit fields or the observed five zero-credit fields; preserve raw receipts and every other guard. | Reproduce the production shape against the original recorder, then exercise both real service paths and native competing saves. Reject unknown/nonzero credit fields and confirm ordinary new empty-preview receipts without replay or backfill. |
| Four finished preview handlers remain permanently held after the local save failure | A separately disabled, explicit local-handler review binds the exact ticket, unique free request and batch, released code, current source and approved rate. Preserve immutable before-evidence and restore only the existing bounded recovery family after whole-batch unstarted checks. | Exact hashes, unchanged original evidence and money, fixed caps/counters/deadlines, concurrent approval and late Pause/paid-admission rejection, matching release, then ordinary fresh work. Missing raw previews remain missing. |
| Current handler stops before recording creation but retains its dispatched credit cap | Bind an explicit pre-create result to the current consumed ticket and settle only under original account, operation, job and ticket locks. | Actual recording boundary, concurrent abort/create races, preserved late provider evidence and unchanged historical unknown holds. |
| Accepted outgoing texts lack terminal delivery callbacks | Bounded canonical original-message GET recovery preserves immutable source evidence and permanently excludes recovered historical deliveries from new seller/Meta follow-ups. | Actual production observers, source-marker checks, callback races, unchanged billing and original delivery observations. Incoming reception remains independently unverified. |
| First canonical message reads report delivered but omit terminal timestamps | The provider defaults tracking to false. Explicitly request `?tracking=true` and bind that URL while retaining the actual delivery-time requirement. | Provider-default regression, unchanged original held attempts/backoff/quota, real-trigger/native callback checks and fresh ordinary production receipts after the exact release. |
| An open buyer reply remains stale after a failed background read | A visible refresh arriving after response headers but before the response body settled was discarded by the in-flight guard. Coalesce one pending read, retaining the saved reply, existing poll and abort/hidden guards. | `fulfillment-refresh-queue.test.mjs` reproduces held-503-body recovery with the actual component/request code and covers success, no-event failure, hidden tabs, unmount and changed deals. Preserve the existing browser reply assertion and 12-second deadline; exact-release browser checks remain required. |

Current operational targets are inherited from the installed monitor and lease policies: worker/maintenance evidence younger than three minutes; call or text dispatch older than five minutes must surface as unresolved; contract delivery older than ten minutes must surface; expired recovery leases get a new receipt-reconciliation capability without replaying primary work. For this release, a new 42702, a repeated recovery 40P01, failed original voice-approval comparison, stale heartbeat or wrong deployed commit is a rollback/investigation trigger. Latency and qualified-deal-cost targets require a representative live cohort; this short outage investigation does not establish them.

The initial read-only snapshot was degraded, including older unresolved receipt/export evidence. Do not acknowledge, delete or settle those records just to change the health result. A new outage-free observation window does not prove historical customer work succeeded. Paid calls, texts, data purchases and signature submissions are not authorized development tests by this release request.

## November 4 hidden workflow gaps

| Failure observed | Change | Closure evidence |
| --- | --- | --- |
| A buyer strategy has more pages but the other strategy ends | [Independent saved cursors](buyer-search-continuation.md) continue the original strategy inside the same five-page budget. | 62 complete histories, SQL/application parity, actual empty/paid receipt fixtures, unchanged original receipts and mixed-release admission. |
| Generic inbox traffic makes property reception look healthy | [Property-reception evidence](property-text-reception-health.md) distinguishes routed property replies and reports private authenticated webhook failures. | Account/event binding, no generic false recovery, preserved webhook responses, native concurrent diagnostics and bounded lock waits. This does not prove provider delivery or recover missing messages. |
| Owner demonstrations obscure customer outcomes | [Customer outcome reporting](owner-deal-outcomes.md) separates the owner column and requires matching signatures, title evidence and received-proceeds confirmation. | Real verifier, canceled assignment replacement, tenant/practice/period isolation, unavailable/partial states, responsive browser view. |
| A manually signed purchase does not make the buyer handback obvious | [Explicit buyer handback](buyer-handback.md) exposes the existing return-to-bot control on collapsed cards, including ordinary signing-seeded closing setup and date reviews. | Actual component callbacks, off-page attention summary, save failures, explicit clicks, account Pause, unchanged server admission and desktop/mobile browser scenarios. |
| The single cold reminder becomes due after the original phone observation expires | [Fresh contact observation](seller-contact-refresh.md) obtains one new exact-phone check for an eligible prospective gap, then uses the original PR #547 revalidation. | Actual production predecessor fixtures, immutable one-use claims/receipts, real billing and shared quota, native races, Pause/STOP/source binding and no historical replay. An unknown paid outcome stays held. |
| Access messages recommend a disabled phone sign-in route | Incorporate the reviewed email-only access correction from PR #551. | Existing receipt/idempotency tests, email-only support regression and unchanged account credentials. |
| Settled calls consume the billing scheduler's one recovery turn per minute | [Bounded confirmed-entry cleanup](confirmed-billing-queue-drain.md) reads at most 100 due pending entries against the complete canonical settlement evidence, then retains the original single unfinished claim. | Starvation reproduction, positive/zero charge and tenant/manifest/ledger rejection, unchanged money and call records, native competing claims/locked rows, exact-definition migration and observed original-receipt recovery. Unknown costs and explicit reviews remain held. |
| Settled contacts with every phone claimed by another account fill the discovery buffer | [Phone inventory projection](phone-inventory-opportunity-buffer.md) excludes only complete, current source-bound phone sets under explicit other-account cooldowns. | Reproduced 25→11 slots while retaining seven unknown purchases; malformed/unprepared phones, legacy/current alternatives, tenant/source checks, immutable records and native concurrent claim visibility. |

These fixes preserve the newer bounded learning release in PR #554. Deploy only after the exact release passes all Reliability checks and the matching application and worker are live. Schema changes are individually reviewed; migration-history differences are not permission for a blanket database push. Missing incoming-provider history, old unresolved costs and historical expired-contact holds remain separate evidence gaps.

November 4 seller-call follow-up: [Conversation repetition](seller-conversation-repetition.md) reproduces the natural-listing-answer rejection and routine co-owner false hold, preserves existing financial holds and signer checks, and consolidates runtime delivery instructions without changing frozen provider approvals.

## November 5 audit follow-up

| Failure observed | Change | Evidence required for closure |
| --- | --- | --- |
| A seller asks to text or says they cannot talk before ownership is known; the inbound event has no reply job | [Prospective ownership clarification](initial-reply-and-journey-isolation.md) binds a bounded response to the delivered original question without inferring ownership or sale authority. | Original failure reproduction, activation/source cutoffs, actual trigger/resume/final-send guards, native concurrent duplicates, exact migration receipt. No historical outreach replay. |
| A failed buyer message aborts the next independent message; held results are counted as sent | [Journey failure isolation](initial-reply-and-journey-isolation.md) preserves independent claims, attempt limits and unknown holds while returning truthful progress and cron failure status. | Real service/route fault matrix, duplicate/uncertain-claim protection, title eligibility fairness, late-state preservation and exact production web release. |

The general automation lane still requires separate observed recovery from its
database statement timeouts. PR #548 stages the contact-preparation optimization;
its concurrent-index installation and production-ledger prerequisites remain
explicit gates. A successful deploy or healthy heartbeat does not close that
incident. Rejected unclassified messaging events also require payload-shape
evidence before calling them lost seller replies.

## November 8 seller action review

See [the seller action audit](seller-action-audit-2026-11-08.md). The incident covers
missed natural opt-outs, delivered-question refusals, false active-call offer
holds, source-bound voice-to-text continuation, machine-answer classification
and the actual outbound registration prompt. Focused replay fixtures and native
reply/receipt races accompany the patches; explicit buyer test holds remain.
Production behavior is verified only after the exact application release.
