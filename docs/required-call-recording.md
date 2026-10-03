# Required recording, local outbound vertical slice

Status: LOCAL / DEFAULT OFF. Rebased on main 3625dd02589c8f3fa894b015dda219a12ed79f9c (core0148e5a plus the additive DNC adapter). Nothing in this patch activates a provider, makes a call, installs SQL, changes credentials, enables recording or changes a customer rate. The existing dispatcher reaches this adapter only after all normal admission guards and reserve/claim, with the recorded lane explicitly enabled and bound to a separate977-cent rate. The disabled default preserves the946-cent lane. Inbound recording is out of scope and requires its own reviewed quote.

## Implemented

- Separate internal outbound adapter, one-time durable dial/start claims, server-reviewed branch/config hash and stop-tool definition, no automatic retry of an uncertain provider mutation.
- Twilio call with Record=false and 600-second total cap. The AI/transcript/purpose/30-day disclosure plays before one speech Gather asks, “Quick thing before we get into it, is it okay if I record this call?” A signed final, high-confidence whole affirmative utterance is required. Silence, refusal, ambiguity or unknown confidence ends the call. Only then does Twilio recording start and ElevenLabs register-call connect. ElevenLabs audio saving stays false.
- Required recording withdrawal ends the call, using call termination first. An unconfirmed end returns503 and keeps an immediate durable termination retry, even if recording stop succeeds. No unrecorded AI continuation or restart tool.
- Existing callback/handoff routes lazily verify canonical ElevenLabs agent/branch/version/user/call/phone identity before binding the recording session to the existing owned live conversation and capability. Their normal DB authority still runs. Provider readback failures remain held. No identity or consent comes from model assertions.
- Service-only SQL, immutable owned call/recording bindings, consent-only evidence and append-only metadata audit. Audio bytes are held only by Twilio.
- Private authenticated account-scoped audio proxy; fixed provider URL constructed from the bound ID; no provider media URLs or credentials delivered to clients. Exact expiry blocks playback before any provider read.
- 720-hour audio expiry anchored to provider recording start. Independent leased maintenance/deletion, with retries and verified provider deletion. No dependency on wallet, account pause or launch flag. Transcript retention is not changed.
- Cost receipt UI distinguishes recorded duration/provider receipt, observed and estimated costs, reservation maximum and settled charge. A recording is not proof of provider cost.
- Recording-aware existing billing collector/queue and carrier-only no-AI settlement. Missing supplier prices remain unknown; no fake ElevenLabs receipt. Recorded collector requires a separate versioned policy identified from immutable rate.version; legacy zero-add-on policies cannot settle recorded rates. Completed recording metadata remains usable for delayed billing after audio deletion.

## Approved quote and assumptions

User selected 30-day audio retention and approved a $9.77 recorded outbound hold. Existing weighted base $7.881, plus raw recording/storage allowance $0.031 and one speech-Gather estimate $0.020, at 5x and 20% buffer: ceil-to-cent((7.881 + .051 * 5) * 1.2) = $9.77.

The consent step is inside the 600-second total cap; Basic Twilio TTS is explicitly selected and no extra transcription/analytics is enabled. Playback/deletion overhead still requires production-volume validation. Storage is a conservative allocation, not an invoice observation. Unrecorded prices and inbound quotes are untouched. No rate rows are installed by this patch.

## Routes and deployment boundaries

New internal callbacks: /api/internal/voice/recording/{consent,status,stop,terminal}. Maintenance: GET/POST /api/internal/voice/recording/maintenance authenticated with existing CRON_SECRET. vercel.json includes an independent minute cron; the reviewed SQL must be applied BEFORE deploying this code so its first invocation has a schema. Verify the actual scheduled invocation before capture. The schedule remains active when capture flags are disabled. Expired playback is denied even if deletion is delayed. Deletion failures stay visible and require alerting; no provider-purge timing guarantee is invented.

Customer reads: /api/work/recording?conversationId=<owned application conversation UUID>, /api/work/recording/audio?id=<owned application recording UUID>. ICASH_RECORDING_RECEIPTS_READY remains false until the schema exists. It is a schema/presentation gate, not participant consent. ICASH_RECORDED_OUTBOUND_READY and a complete pinned RECORDED_OUTBOUND_REVIEW_JSON are both required by the adapter; neither is supplied/enabled here.

## Remaining activation work, not claimed complete

1. Complete independent review of these frozen bytes. Apply the exact reviewed SQL before code deployment. Create separate977-cent rate rows, prepare the full immutable billing policy and review config, and validate the independent cron. The dispatcher and billing queue are already wired locally; do not bypass their normal contact, opt-out, quiet-time, budget, provider, offer and market checks.
2. Add alerting for held termination, deletion and identity-binding work. Validate volume limits and infrastructure allowance. Existing unrecorded policy/rate IDs must stay available for earlier calls. No runtime policy may silently reuse zero recording overhead for a recorded rate.
3. Verify actual provider branch/tool permissions, no additional recording/analytics copies, live call/stream time-limit behavior, final speech Confidence availability, prompt/tool overrides, synchronous signature behavior, real-time conversation metadata for callback/handoff binding, private media authentication and deletion. Missing confidence or metadata must fail closed.
4. A separately approved, consented sandbox phone test must establish the complete flow, including refusal, stop failure, expiry/deletion, and actual costs. No such test was performed.
5. New inbound quote/routing and additional-participant/transfer handling require their own reviewed scope. This candidate only supports the bounded two-party outbound lane. No third-party participant consent is inferred from owner approval.

## Validation

Node/component suites, TypeScript, webpack build, exact-SQL state/ACL/ledger tests and a complete local HTTP/dispatcher/queue/ledger simulation. Covered lost dial response (one dial), accepted/refused/withdrawn paths, delayed identity/price receipts, callback races, off-flag termination/deletion and post-deletion billing retry. Fixtures are synthetic and never contact a provider. PGlite does not prove concurrent PostgreSQL session locking. Full authenticated browser UI and live provider flows are not verified: the cloud browser rejected the local synthetic preview with ERR_BLOCKED_BY_CLIENT; no alternate route was used to bypass it.

Sources checked 2026-10-03: Twilio Recordings API https://www.twilio.com/docs/voice/api/recording ; Gather https://www.twilio.com/docs/voice/twiml/gather ; Say https://www.twilio.com/docs/voice/twiml/say ; pricing https://www.twilio.com/en-us/voice/pricing/us ; ElevenLabs register-call https://elevenlabs.io/docs/api-reference/integrations/twilio/register-call ; conversation details/list https://elevenlabs.io/docs/api-reference/conversations/get and https://elevenlabs.io/docs/api-reference/conversations/list .

See required-call-recording-rollout.md for exact deployment order, environment names, read-only provider preflight and the separate one-use owner-test constraint.
