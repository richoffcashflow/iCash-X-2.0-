# Recorded incoming reception: local capture-OFF candidate

Base: deployed main `3ce71a111da43d4e95b70e8cad11f23b684ddb13`, preserving all13 exact channel-choice files on top of recording main `a0025d1d2a46504c264dacc5a4cd7c9383549e34`. This extension does not enable a provider, change a phone route, install a rate or approval, place a call, or change historical reception behavior. The initial narrow production metadata read was cancelled. After fresh explicit permission, a read-only metadata check completed at 2026-10-03 07:02 UTC. Reception's database config is enabled, owner_quick_test, message_only, 60 seconds, 65-cent cap, customer_credits/provider_readback, reviewed through 2026-10-07 21:42 UTC. Its 60-second incoming rate is enabled; the 600-second normal rate is disabled. The separate legacy business-inbound route is disabled. Runtime incoming billing-policy JSON and provider routing/settings were not part of that read and remain unverified here. No provider or database write was made.

## Scope

The new opt-in route is `/api/reception/recorded/inbound`. The existing `/api/reception/inbound`, `/api/internal/voice/inbound`, and owner/audio test paths remain untouched. The legacy business-inbound route was read as disabled. The separate general-reception database config is enabled for the owner-only test; runtime provider routing and other owner/audio-test activation remain unverified. Therefore publishing this candidate alone does not establish “all calls recorded.” A coordinated route inventory and switch is required. Historical unrecorded calls cannot be recorded retroactively.

The separate incoming session has a versioned, immutable configuration, an incoming operation/credit reservation, and exact account, called number, caller hash, CallSID, agent, branch, version, rate and cap bindings. It never forges an outbound voice job, contact permission, screening or live-conversation record. Legacy consumed configurations and financial receipts remain intact. Only one reviewed incoming version can be enabled; the old lane must be disabled and its pending work reconciled first. The source does not expand the legacy permission to admit calls while paused: new paused admissions fail closed.

The implemented historical options are normal 600 seconds/$4.30 and separately approved owner-only 60 seconds/$0.65. The fresh metadata read confirms that only the owner-only60 database profile is currently enabled; normal600 remains disabled. New recorded prices use separately approved, versioned incoming rate IDs; neither historical rate is overwritten and neither cap is silently increased. Using the verified stored planning amounts, unchanged5x standard/3x ElevenLabs multipliers and20% reserve buffer, candidate recording/Gather allowances produce79 cents for owner60 (+14 cents) and461 cents for normal600 (+31 cents). These are unapproved estimates, not supplier observations or installed prices. Runtime billing-policy review, account allocations and cap approval remain separate.

## Consent and recording

The signed Twilio request is independently checked against a fresh canonical inbound call. After exact funding admission, a once-claimed Call update supplies the approved total 60/600-second TimeLimit and terminal callback. The app returns the AI, written-transcript, business-private audio, 30-day purpose disclosure followed by a single speech Gather. No audio recording or ElevenLabs connection begins before verified affirmative speech.

Only the same high-confidence complete affirmative phrases as the reviewed outbound gate are accepted. Refusal, silence, ambiguity, missing Confidence, configuration drift, expired consent, or failed recording setup ends the call. The start and registration claims are durable and at most once. An uncertain provider response is reconciled, never re-dialed or re-registered. Recording must be confirmed in progress before the AI connects. Consent consumes the total duration allowance; a 60-second profile can connect with fewer than 60 seconds remaining.

The original ElevenLabs agent's `record_voice=false` stays required. A separate reviewed reception branch adds only the narrow `icash_stop_reception_recording` capability alongside safe end_call. It does not adopt outbound callback/handoff/offer tools or expose private data. A frozen message-only or explicitly reviewed property-intake policy is supported; the property lookup uses only the admitted session's account and trusted caller-derived contact key. Unknown/ambiguous context asks the caller for an address rather than guessing.

Withdrawal, a new participant, or unclear permission requires the tool to terminate the exact call. Partial recording-stop success is reported as unconfirmed call termination with HTTP503; durable end intent remains due. The agent must not continue unrecorded. Multi-party/transfer recording is not implemented.

## Private access and retention

Only the authenticated owning account can obtain the allowlisted receipt list and media. The UI is `/reception-recordings`, linked from reception setup. Media is proxied from a canonical Twilio RecordingSID with no provider URL or credentials in the browser, no-store headers, bounded bytes and validated ranges. Playback is denied at the exact 720-hour expiry even if provider deletion is delayed. A browser user who can play audio can save a copy; there is no claim to prevent copying.

Independent leased maintenance at `/api/reception/recorded/maintenance` authenticates with existing CRON_SECRET. It is gated only by schema readiness, never capture, wallet, or account pause. It deletes expired media before depending on call/conversation/cost availability, verifies deletion, retries uncertain termination and recovers exact provider identity. Immutable recording metadata remains available for late billing after media deletion. Provider deletion latency is not guaranteed.

## Cost integrity

All settlement remains bounded by the admitted immutable customer cap and the existing reserve/claim/complete-cost authority. A service request cannot invent an approval. A separately approved, immutable standing incoming cost policy is bound to the rate/account/configuration and frozen into each admitted session. Routine calls with that policy settle automatically through the existing maintenance worker from canonical provider attestations plus its explicitly approved estimates; no human review or fabricated cost_review row is needed per call. The database constructs and validates all 16 components, enforces the original cap, and records append-only automatic-settlement provenance. Missing receipts, unknown units, mismatched bindings or above-cap costs retain the hold for exceptions. Historical/manual sessions without such a policy retain the exact per-call-review path. Matching retries are idempotent, and a later changed readback never erases an already recorded charge.

A call ending before any start/register attempt has automatic carrier-only settlement under the same frozen policy: no fictional ElevenLabs receipt, no audio or storage charge. A confirmed consent setup has a conservative estimated Gather allocation; setup failure before the disclosure is prepared has none. A lost/uncertain recording or AI registration attempt is not misclassified as a zero-AI call.

Twilio Call.price covers call connectivity, not Media Streams. The candidate keeps a separate conservative stream allocation (rounded-up carrier minutes at $0.0044), one default speech Gather ($0.02), audio ($0.0025 per started recorded minute unless actual recording price is available), and 30-day storage ($0.0005 per minute-month allocated 30/28). These are labeled estimates. Inclusive ElevenLabs USD uses actual cost_fiat with decimal half-up rounding to micros; LLM is not billed again. These public tariffs do not prove the user's plan, overhead allocation or final invoice.

## Remaining live release work and approval

1. Independent code/SQL review and complete synthetic tests against the exact frozen bytes. Apply reviewed SQL before enabling schema readiness; no config or rate rows are installed by the SQL.
2. Preserve the verified current owner-only60 profile while completing the remaining review of provider routing, outstanding holds, immutable prior approvals and runtime billing policies. Do not inspect protected function bodies or circumvent prior denials.
3. Review an exact recorded incoming quote and obtain approval for any higher customer cap. Review carrier total-time/queue treatment, storage/playback overhead, full allocations and eventual stream invoice coverage. A historical $0.65 owner test is not permission for normal customers or a higher charge.
4. Prepare and read back the distinct branch and stop tool, preserving original Main, privacy, credentials and existing outbound setup. Verify no additional audio copies or exports and verify private Twilio media authentication.
5. Install a new disabled versioned config/rate and full standing cost policy through the existing authorized review process. The launch configuration must select the automatic policy; missing it leaves the historical manual-review fallback and does not fulfill routine automation. The unresolved billing template is deliberately disabled, with null identities/approval dates; never install it as-is. Never rewrite the consumed legacy config/receipts or disable their guards.
6. Obtain a separately bounded test authorization if needed. Verify real ASR Confidence, incoming TimeLimit behavior, exact media tracks, refusal/withdrawal, private playback and independent cleanup. Synthetic success does not substitute for real provider evidence.
7. Only after approval and test review, coordinate capture flags and Twilio route switch; preserve legacy fallbacks as fail-closed rather than unrecorded continuation. Verify the real cron invocation and alerting for held termination/deletion/billing. Inventory and cover or disable every other enabled inbound path before claiming all-call coverage.

Sources checked 2026-10-03: [Twilio pricing](https://www.twilio.com/en-us/voice/pricing/us), [Recordings API](https://www.twilio.com/docs/voice/api/recording), [Call update TimeLimit](https://www.twilio.com/docs/voice/api/call-resource), [Connect completion](https://www.twilio.com/docs/voice/twiml/connect), [ElevenLabs register-call direction](https://elevenlabs.io/docs/api-reference/integrations/twilio/register-call). No live provider call or setting change was performed.


## Reproducible local verification

- All isolated Node suites, TypeScript --noEmit, and the Next.js webpack production build are run against the combined3ce71 base before freeze.
- Dedicated incoming Node tests cover50 service/provider/route/template cases, including context preservation, default-off transport construction, callback/CAS races, private range/expiry behavior and disabled cleanup.
- PGlite:23 SQL scenarios/169 assertions. Native PostgreSQL17: the same23 scenarios plus four genuine two-session schedules/180 assertions. Duplicate admission, configuration-disable/admission lock order, recorded/legacy exclusive enablement and duplicate automatic settlement are tested using actual lock waits.
- Real SQL-backed synthetic-provider flows cover accepted/refused automatic settlement with zero per-call cost_review rows; no AI receipt is fabricated for gate-only calls. Private policy ACLs, frozen authority after pause/expiry, over-cap/unknown/mismatch holds and immutable prior charges are exercised.
- The combined fixture installs this inactive schema beside released operational core, DNC adapter, outbound recording and self-service channel choice, with no new policy/config/session rows. Existing owner/principal/receipt behavior and real voice/SMS reserve/claim gates still pass.
- The local source-extracted wallet/operation primitives are executed. The protected current production private wrapper chain was not inspected or substituted; these results do not claim production provider or funding-chain acceptance.
- Browser visual verification remains incomplete: agent-browser was not installed, and the supported cloud browser rejected the local preview with ERR_BLOCKED_BY_CLIENT. The preview also reported a restricted-environment network-interface diagnostic; no alternate route was used to bypass the browser restriction. The preview process was stopped. Static/component and route tests pass, but authenticated browser playback and actual provider behavior remain release checks.

Commands from the candidate workspace:

    npm test
    ./node_modules/.bin/tsc --noEmit --incremental false
    ./node_modules/.bin/next build --webpack
    node --experimental-strip-types scripts/test-recorded-reception-pglite.mjs /workspace/scratch/b590400d2960/icash-test-tools/node_modules/@electric-sql/pglite/dist/index.js
    bash scripts/run-recorded-reception-postgres.sh
    node --experimental-strip-types scripts/test-recorded-reception-combined-pglite.mjs /workspace/scratch/b590400d2960/icash-test-tools/node_modules/@electric-sql/pglite/dist/index.js

The native runner uses the existing official PostgreSQL17 binaries in the review workspace, creates a disposable localhost-only fixture, refuses to reuse an existing server and stops its server afterward. No provider calls or live database mutations occur.


## Review revision: immutable answered-call clock

Admission and answered-call timestamps are different clocks. The initial setup/ringing watchdog is 60 seconds after admission. Before spoken consent can authorize recording, service-only CAS binds canonical Twilio Call `start_time` with exact account, CallSID, caller, called-number and direction checks. It must fall between admission minus one second (provider timestamp precision) and admission plus 60 seconds, and the full approved call must fit the already-frozen review/rate/policy window. That is existing admission headroom, not additional billable duration or a larger quote.

The one-time binding freezes `call_started_at`, `call_deadline_at = call_started_at + max_total_seconds`, and the 45-second consent deadline. Remaining AI time and independent maintenance use those same stored deadlines. Missing, future, stale, foreign, changed or racing evidence cannot move them. Receipt recovery remains possible after pause, but cannot authorize fresh recording work. The provider TimeLimit remains exactly the approved 60 or 600 seconds.

The SQL-backed signed regressions stagger answer by 5 and 55 seconds for both approved durations, then consume 10 seconds for consent and the rest for recorded AI. They verify no admission-clock premature hangup, automatic settlement and private playback metadata at the full valid limit, rejected audio beyond the bound limit, and immutable/replay/CAS controls. The declined UI says the call is ending until canonical terminal evidence confirms it ended.

Base-tree verification excludes the generated, ignored `next-env.d.ts`; all repository files otherwise hash to tree `327e4aee6b0beca5e384d90de02f5598bf32a165`.

Clock conflicts also cannot block lost-recording discovery. Even with capture OFF and a changed carrier clock, a once-claimed start can recover its one exact Call/account-bound recording, persist the original 720-hour expiry, and verify deletion without restarting recording, registering AI or settling disputed costs. The signed SQL regression covers this lost-response and expiry sequence.
The same exact-recording discovery also precedes an unavailable canonical Call read or unconfirmed termination. Separate SQL regressions show that each carrier failure still leaves audio queued for verified expiry deletion while durable end intent and cost holds remain.

Final combined base is inactive owner acceptance commit `111c7e00656174c4af7e3f025e7d0b349df579ff`, tree `2eb91f8a44d2063248dc64d97cc4d45f44a7d3bd`. All 23 owner release files are preserved, with only `vercel.json` merged to append incoming maintenance beside owner, outbound recording and billing crons. The combined fixture installs both inactive owner SQL and incoming SQL with zero owner configurations/runs and zero incoming configurations/policies/sessions.
If a canonical carrier GET remains unavailable while durable end intent or a watchdog is due, maintenance still attempts the exact reserved CallSID END operation. It cannot mark terminal or settle until the fully bound terminal readback recovers. The outage regression checks both the attempted END and delayed terminal confirmation.
