# Private ElevenLabs acceptance test

This is an isolated acceptance flow, not a seller-calling launch. `/voice-test` uses a private expiring capability, capped sessions, a private ElevenLabs agent, and a 180-second provider-enforced maximum. No phone numbers are imported or dialed. No customer wallet, acquisition workflow, learning metric, or conversion event is modified.

## Access and secrets

- `ELEVENLABS_API_KEY` stays server-side. Required scopes: ElevenAgents write and Voices read. Read-only access is insufficient for creating the test agent.
- Test access tokens are 32 random bytes encoded as 64 hex characters. Store only SHA-256 hashes in `icash_voice_test_access`, with a short expiry and maximum 3 sessions. Share the raw token only with the tester in the URL fragment `#access=...`, never in query parameters, logs, commits, or analytics.
- The page removes the fragment and keeps test access only in sessionStorage. It sends the token in an Authorization header. The provider session token is never persisted.
- Supabase test tables have RLS enabled and no public/authenticated grants. Only server code accesses them. Database functions are SECURITY INVOKER, have fixed search paths, and are executable only by service_role.
- Revoking the test grant stops new sessions and result access. Disable `icash_voice_test_config.enabled` to stop all new tests. Already-issued provider tokens have their own expiration; active calls are capped by the agent.

## Persistence and spending controls

`icash_reserve_voice_test` atomically consumes a session allowance before calling the provider, with a global test-session concurrency lock. Unknown provider outcomes are not retried automatically. A reservation remains blocking for 20 minutes when the result is unknown. A token failure consumes an allowance conservatively until manually reconciled.

Provider-generated conversation IDs are stored before returning WebRTC tokens to clients. The result route retrieves only the conversation attached to the requesting test grant and verifies both agent and conversation IDs. It ignores client-provided summaries, timestamps, transcripts and claims of success. Provider polling is limited to once per five seconds per session. Completed results are cached durably in Postgres.

Callbacks require a provider-extracted explicit confirmation, an exact supporting user quote, a future date within 90 days, an explicit UTC offset, and matching IANA timezone/date-time components. Ambiguous times stay `needs_confirmation`. An opt-out takes precedence. Valid callbacks are `scheduled_test` records only: **no real callback is dispatched**. Model extraction still needs acceptance testing and human review before this becomes a live scheduling flow.

Provider credit units and provider-reported USD costs remain separate. Missing USD costs are unknown, not zero. Test calls do not consume customer credits.

## Verification

- Local: `pnpm test:voice`, `node --experimental-strip-types tests/callback-policy.test.mjs`, `pnpm exec tsc --noEmit`, `pnpm build`.
- Database: reserve a test session and check allowance denial in a transaction rolled back after testing; confirm anon has no SELECT and authenticated has no function EXECUTE.
- Preview-only script: `scripts/elevenlabs-verify.mjs` runs only when VERCEL_ENV=preview and branch=elevenlabs-voice-verification. It provisions one private agent and runs one synthetic text-input/voice-output conversation. The impossible-preimage all-zero token hash marks internal fixture records, never customer data.
- The scripted check does **not** prove microphone recognition, voice quality, browser permissions, phone delivery, or callback dispatch. The tester must use the microphone, confirm a date/time/timezone, end the call and select See summary & callback. Then inspect the actual provider-backed transcript and saved callback.
- Agent provisioning uses a database claim. Unknown outcomes require manual reconciliation before resetting provisioning_claimed; do not blindly re-create agents.

## Current evidence — 2026-09-28

- Vercel authenticated GET checks: Agents 200, Voices 200.
- Local callback tests, typecheck and build passed.
- Migration applied; anon access and authenticated RPC execution denied as expected.
- Owner corrected ElevenAgents Write. Agent creation then rejected `platform_settings.analysis_llm=gpt-4.1-mini`; the API accepts a narrower set than the SDK type implied. Omitting this override uses the provider-supported analysis default. Live agent dialogue is still configured for gpt-4.1-mini.
- A private agent was successfully created with authentication enabled and a 180-second maximum.
- The synthetic WebSocket check timed out after its first user message. Recovery retrieved the exact isolated conversation and persisted its transcript and provider summary without initiating a duplicate call. The 61-second conversation reported 667 provider credit units / $0.066680670765539 provider USD cost. These are provider units, not customer credits.
- The summary mentioned a callback but the user had not completed the confirmation exchange. The application correctly persisted `needs_confirmation` with no due date. Confirmed callback scheduling has passed deterministic fixture tests, but has NOT passed a real microphone conversation yet. Provider has-audio fields describe retained audio availability; because recording is disabled, they are not proof that speech synthesis or recognition failed.
- After explicit owner approval, a private grant was issued for 48 hours / 3 sessions. Never commit the raw capability or extend its allowance without authorization.
- Automatic preview verification was removed after diagnosis so unrelated rebuilds do not perform provider mutations. Re-enable the explicit verification build command only for the next authorized acceptance run.

Official references:
- https://elevenlabs.io/docs/api-reference/agents/create
- https://elevenlabs.io/docs/api-reference/conversations/get-webrtc-token
- https://elevenlabs.io/docs/api-reference/conversations/get
- https://elevenlabs.io/docs/eleven-agents/libraries/java-script

## Account identity requirements

Customer seller calling remains disabled pending acceptance. Account details now saves first/last name, optional company, and a stable provider-premade voice assignment through an authenticated same-origin endpoint. The server derives the account from the verified user; client-supplied account IDs are ignored. Database upserts preserve the original voice even during concurrent first saves. No legal-name verification or signing authority is granted by saving these details.

Rules for live integration:

- Ask for first name, last name, and optional company name in one compact inline form. A company is not required. Use the confirmed company name when present; otherwise use the confirmed first and last name. Never infer a company or LLC from an email address or append LLC automatically.
- Keep assistant name separate from the represented customer. For example: “I’m Alex, an AI assistant working on behalf of Jordan Smith.” The assistant must not claim to be Jordan.
- Assign each account a voice automatically from a small approved, licensed conversational voice pool. Persist the selected voice ID and assistant name; use the same identity on follow-ups. Voices may be reused across accounts, but all customers should not default to the identical voice. Do not rotate voices per call or to circumvent contact controls.
- Optional voice changes belong behind account details, not in the activation funnel. Apply a change to future conversations only. Freeze the identity snapshot on each conversation so transcripts remain attributable to the original identity.
- Company/display-name edits do not rewrite signed contracts or grant signing authority. Contract party details require separate validation before use.
- Never overwrite a shared provider agent with one customer's identity during concurrent calls. Use tenant-scoped agents or authenticated server-controlled session configuration and enforce tenant isolation.

Customer identity storage and automatic voice assignment are implemented, but not yet wired into live seller calling. The current private test uses only the isolated iCash X identity.

- Private agent tuning verified 2026-09-28: Chris — Charming, Down-to-Earth; eleven_v3_conversational; speed 0.97. Short conversational delivery prompt; private auth and 180-second limit preserved. No calls were initiated by tuning. Subjective audio quality still requires the owner’s microphone test.

## V4 and conversation behavior — 2026-09-28

The official model guide lists `eleven_v4_turbo`, while the public OpenAPI `TTSConversationalModel` enum still omitted it during this check. The actual authenticated PATCH of the isolated private agent returned 200, and a subsequent GET confirmed `eleven_v4_turbo`, the original voice, authentication enabled, and the 180-second cap. No calls were initiated. The API response takes precedence over the stale enum for this verified integration.

The private-test prompt now leads a concise acquisitions discussion: seller motivation, relevant condition facts, timeline, ownership, targeted objection handling, and an explicit next-step request. It must not invent an offer or claim that a contract/message was sent. Real offer presentation and contract-link texting remain unconnected. They require reviewed underwriting, an authorized ceiling, agreed terms, owner checks, an approved contract/e-signature integration, an enabled messaging provider, and actual send/delivery/signature receipts. No seller call is enabled by these changes.

A subsequent authenticated update and GET verified v4 Turbo with Chris, eager turn-taking, speculative response generation, interruption events, automatic spelling patience, and the exact revised acquisitions prompt. Authentication and the 180-second cap remained enabled. The preview build passed. Speculative generation can increase LLM usage; it is confined to the capped private test and must be measured before production rollout. No zero-latency claim is warranted. V4 does not support the old speed/style sliders; natural pacing is directed through the dialogue instructions.

Public ElevenAgents pricing reviewed: standard additional call minutes $0.08/minute, LLM usage additional, external carrier billed separately. This is published general pricing, not a verified account-specific v4 invoice. Actual v4 audio quality, end-to-end latency, and cost still require a completed acceptance conversation.

Sources:
- https://elevenlabs.io/docs/overview/models
- https://elevenlabs.io/docs/overview/capabilities/text-to-speech/eleven-v4
- https://elevenlabs.io/pricing/agents

## Owner feedback and cost tuning — 2026-09-28

The owner approved the Chris/v4 Turbo sound, then requested a relaxed young-adult conversational style and female voices in the account pool. The private prompt now uses everyday acquisitions phrasing without forced slang, flirtation, fake laughter, or claims about being human or a particular age. Customer assignment already permits approved premade Sarah/Jessica voices alongside Chris/Eric/Brian; selection depends on actual provider availability and is persisted per account. The private test keeps the approved Chris voice.

Cost preference supersedes the earlier speculative-generation experiment: turn speculative generation OFF while retaining eager turn-taking, spelling patience, v4 Turbo and the inexpensive gpt-4.1-mini dialogue model. Responses remain capped at 120 output tokens; private calls remain capped at 180 seconds, concurrency one, with bursting disabled. Do not interpret these private-test caps as a production operating budget. Keep measured provider cost separate from customer pricing; no gross-margin target has been validated by these configuration changes alone.

## Next telephony connection

Owner-selected live call policy is a 10-minute target / 15-minute hard maximum, stored in `config/voice-call-policy.ts`. It is not yet enforced on live calls because live dispatch is not connected. Do not pad calls to reach the target. End unproductive conversations sooner and reserve the configured customer credits before dialing. Enforce the hard limit at both the provider-agent and carrier levels, with actual-cost reconciliation and no automatic burst spending. The private test remains capped at three minutes.

Next: connect a paid Twilio account and a voice-enabled business number through ElevenLabs' native Twilio integration, then run an explicitly authorized call to the owner's number. Verify call status, transcript, summary, confirmed callback, and actual ElevenLabs + LLM + carrier costs. Twilio phone-number import requires account credentials entered securely in the provider dashboard, never in chat or source code. Contract-link texting and e-signature delivery remain separate integrations and acceptance checks.

## Phone results and durable test callbacks — 2026-09-28

Private voice-test page now imports an ElevenLabs conversation ID without starting a call. A service-only RPC checks the existing expiring capability, limits imports to ten per grant with a five-second admission interval, and returns the same session ID for repeat imports. The result endpoint fetches provider data server-side and verifies both the configured private agent ID and conversation ID before persisting anything.

One atomic session update saves the completed result, verbatim seller notes, stable activity IDs, callback status, and confirmed timestamp. Repeated reads return the persisted result. Provider prose is explicitly labeled as an unverified summary; it never sets listing status, offer authority, or live scheduling. Callback records remain test-only, with no dispatcher. The customer home feed and live seller callbacks are not connected by this change.

Owner reports changing the private opener in ElevenLabs to “Hey, is now a good time to talk about the property?” The source configuration now matches. The source prompt removes the repetitive acknowledgment/question pattern; this prompt edit is not pushed into the provider automatically. Do not run a tuning build just to deploy this result feature.


## Property context acceptance test (2026-09-28)

The private browser test optionally accepts a DealMachine property ID. Starting reserves one of the existing limited voice sessions before any billable lookup. Exactly one GET property request uses `enrich=true`, `contact_audience=none`, and explicit fields. No contacts are purchased and failed/unknown requests are never automatically retried. An unknown lookup consumes the reserved test allowance; inspect it before starting another attempt.

The response is reduced to property facts, estimates, timestamp and provider-reported credit counts, saved to the same service-role-only session, and passed through the ElevenLabs SDK contextual update. No raw contacts, API keys or provider errors reach the browser. Dollar cost is unknown until reconciled with actual billing; vendor credits are not customer credits. Snapshots are private session evidence, not a cross-tenant cache.

At the operator's request, `estimated_value` is used as the preliminary ARV input for screening. The API calls this field estimated market value; the application preserves `sourceField=estimated_value`, `usage=screening_assumption` and `reviewed=false`. A preliminary buyer ceiling uses 70% of this input minus the upper valid repair estimate (or the single estimate if no range exists), before assignment fee. Missing, invalid or nonviable inputs produce no ceiling. It never approves an offer. The existing offer policy still requires reviewed evidence and subtracts the assignment fee.

Open “Use a real property” on the private test page, enter a known property ID, and start the test. Verify that the speaker and address match, ask about repairs, and inspect the saved conversation and callback. The browser context path is separate from imported phone calls: importing does not attach property context retroactively or update the provider agent prompt. No sellers, SMS, contracts or actual callbacks are triggered.

Automated tests use explicit fixtures to cover ID mismatch, missing/malformed values, conservative repair ranges, ARV mapping, offer gating, no-contact requests and no retry after a network failure. A live provider conversation with this context still needs owner acceptance testing.
