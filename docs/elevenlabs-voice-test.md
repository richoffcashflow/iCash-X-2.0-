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
