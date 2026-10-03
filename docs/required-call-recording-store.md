# Required audio recording: local store contract

Local, disabled-by-default candidate. No installation, provider action, rate change, or deployment is performed by this SQL. Existing unrecorded dispatch semantics and rates are preserved; the dispatcher and billing collector include a separately gated recorded lane. Applying this file alone never enables recording.

## Security and identity

`public.icash_call_recordings` is RLS-enabled. PUBLIC, anon and authenticated have no privileges. `service_role` has SELECT and named RPC EXECUTE only, never direct DML. Mutations are SECURITY DEFINER with an empty search path, fully qualified tables and strictly validated payloads. Append-only private audit events capture state/version/action and timestamps, not audio/transcripts. Database owner access remains an administrative trust boundary.

Immutable row bindings: `id`, `account_id`, `operation_key`, `voice_job_id`, `permission_id` or `operational_contact_id` (exactly one), `screening_id`, `party`, `call_context`, `provider_account_sid`, `call_sid`, `to_phone`, `from_phone`, `contact_key`, `agent_id`, `branch_id`, `version_id`, `rate_id`, `charge_cap_cents` (977), `max_total_seconds` (600), `nonce_hash`, `stop_token_hash`, `disclosure_version`, `pricing_policy`, creation/consent deadline. Operation/account has a composite FK. Each operation, provider call and recording SID is unique. `conversation_id` and `recording_sid` bind once. This is audio-only: no transcript field, media URL, access token, raw nonce, or audio bytes.

Mutable metadata: `state`, `row_version`, `consent_at`, compact `consent_evidence`, `dial_claimed_at`, `start_claimed_at`, `provider_started_at`, `ended_at`, `duration_seconds`, `audio_expires_at`, `deleted_at`, `end_requested_at`, `call_ended_at`, nullable `provider_recording_price_micros`, `price_is_estimate`, reconciliation/deletion attempts and leases, `next_reconcile_at`, `next_delete_at`, `last_error`, `last_action`, `updated_at`. Provider start is immutable; expiry is exactly that timestamp plus 30 days, never callback arrival plus 30 days. Missing price stays NULL, not fabricated zero.

## RPCs

All rows are snake_case JSON. CAS/no-match/replay returns NULL, never permission to repeat a provider start. Malformed inputs raise an exception. Worker claims return JSON arrays.

### Create

`icash_create_call_recording(p_account uuid, p_operation text, p_provider_account_sid text, p_call_sid text, p_nonce_hash text, p_stop_token_hash text, p_disclosure_version text, p_pricing_policy jsonb, p_context jsonb)`

`p_context` has `{fromPhone,branchId,versionId,maxTotalSeconds:600,callContext?}`. Optional callContext has exactly `{principal,assistantName,firstMessage,prompt,strategyKey,voiceId?}`; text lengths are respectively 1..160, 1..160, 1..2000, 1..24000 and strategy is cash_interest or flexible_timing. No token/credential fields are accepted. The authenticated service supplies reviewed provider/account/from/branch/version inputs, never request-body authority. SQL derives destination/contact/agent/rate/permission/job from the existing database. It requires the matching dispatched operation, 977-cent seller/buyer rate, dispatching/dispatched voice job, a current bound legacy permission or operational eligibility record (which is never recording consent), unpaused account and enabled/current matching voice configuration. New dial/start claims recheck stop and permission state. Cleanup never uses these gates. Create accepts NULL CallSid before dialing; a known job CallSid must match when supplied. Neither returning a new row nor replaying create authorizes a provider POST. claim_dial is the one-time provider dial authority. Operation/account and call uniqueness fail closed; identical retries return the existing row. This RPC does not reserve money or dispatch a call.

`p_pricing_policy` exactly `{version:"required-audio-30d-speech-v1",retentionDays:30,recordingMicrosPerMinute:2500,storageMicrosPerMinuteMonth:500,recordingAllowanceMicros:31000,speechGatherMicros:20000,estimate:true}`. These are staged estimate terms, not a provider invoice. Future activation must review rates and provider settings separately.

### Transition

`icash_transition_call_recording(p_id uuid,p_account uuid,p_operation text,p_expected_state text,p_action text,p_payload jsonb)`

Every call matches all three immutable identities and the exact expected state under a row lock. Action payloads:

- `claim_dial`: `{}`; consent_pending and unbound/never dial-claimed, atomically claims one provider POST. Only the winning result permits dialing.
- `dial_unknown`: `{}`; keeps consent_pending, marks unknown response, schedules reconciliation. Never permits redial.
- `bind_call`: `{callSid,providerAccountSid,fromPhone,toPhone}`; one-time bind after dial claim, exact immutable from/to/provider match. Service must verify a canonical provider GET before binding, including the callback path.
- `consent`: `{nonceHash,source:"twilio_gather_speech",utterance,confidence,disclosureVersion}`; only before consent deadline, with bound CallSid, numeric confidence 0.9..1 and matching nonce/disclosure. Only a final speech result from a verified signed Twilio Gather is eligible. SQL normalizes trim/lowercase and removes terminal .!; exact allowlist: yes; yeah; yep; sure; yes please; yes that's okay; yes you can record; yes i agree; i agree; i consent; yes you may record. No generic okay or substring matching. Stores only this short affirmative utterance/confidence as consent evidence, not a conversation transcript. Repeated consent returns NULL.
- `decline`: `{reason:"declined"|"timeout"|"ambiguous"}`; consent_pending to declined, only before any start claim. Service ends call; no AI registration.
- `claim_start`: `{}`; consent_pending with affirmative consent to starting, atomically writes start_claimed_at. Only the winning response allows one provider start attempt.
- `start_unknown`: `{}`; starting stays starting, records uncertain provider outcome and schedules reconciliation. NEVER retries Create Recording.
- `started`: `{recordingSid,providerStartedAt}`; starting/recording/stopping/processing (and failed after a start claim). Late evidence does not move stopping/processing backward.
- `stop`: `{stopTokenHash}`; starting/recording/stopping/processing/available/failed to stopping; durably requests full-call termination and schedules immediate retry. Service validates the exact signed call identity before this action.
- `call_ended`: `{callSid,providerAccountSid,status}`; canonical terminal provider evidence confirms the requested full-call termination. Failed termination remains separately pending across audio completion and late conversation binding.
- `processing`: `{recordingSid,providerStartedAt}`; starting/recording/stopping to processing.
- `available`: `{recordingSid,providerStartedAt,endedAt,durationSeconds,providerRecordingPriceMicros?}`; valid provider evidence from starting/recording/stopping/processing/failed. If expiry has already passed, becomes expired, never playable.
- `absent`: `{}`; starting/stopping/processing/failed to absent only after provider reconciliation establishes no recording; no fresh start permitted.
- `fail`: `{reason}`; nonterminal states to failed; reason is a short machine code. Unknown attempted starts must use start_unknown or keep reconciliation pending.
- `bind_conversation`: `{conversationId,toolTokenHash}`; recording/processing/available/expired/deletion_pending/absent/failed with affirmative consent, recording SID and callContext. Inserts or verifies the existing live-conversation binding using owned screening/party/agent/operation/contact/strategy; atomically updates the same voice job. tool_expires_at remains original dial/creation +600 seconds even for late post-call binding, so expired tools stay unusable. Service must verify canonical ElevenLabs agent, branch, version, user_id and phone CallSid first. Mismatched existing binding raises a conflict and rolls back. Buyer strategy is buyer_followup. No other conversation can replace the bound one.
- `expire`: `{}`; due audio to expired. Deleted rows never resurrect.

Started/available evidence binds immutable provider recording/start metadata, cannot change the CallSid/AccountSid, and cannot extend retention. Recording may be confirmed only after affirmative consent and a start claim. A service must verify Twilio event identity/signature or authenticated fetch before any provider-evidence transition.

### Background work

`icash_claim_call_recording_work(p_kind text,p_limit integer DEFAULT 10,p_lease_seconds integer DEFAULT 120)`

`p_kind` is reconcile or delete; bounded limit 1..100, lease exactly 120 seconds. Uses FOR UPDATE SKIP LOCKED and fresh UUID lease tokens. No feature flag, pause, account balance, active-plan or wallet predicate. Reconciliation finds missing callbacks and uncertain starts. Deletion finds every known due provider recording regardless of previous state, plus retryable deletion_pending records. No permanent retry cap can abandon retained audio.

`icash_finish_call_recording_work(p_id uuid,p_account uuid,p_operation text,p_kind text,p_lease_token uuid,p_outcome text,p_payload jsonb)`

Both lease token and wall-clock expiry must match after lock acquisition. Reconcile outcomes: `retry` (`{reason}`), `absent` (`{}`), `available` (same evidence as transition), `started` (same evidence), `processing` (same evidence). Delete outcomes: `deleted` (`{}`; after provider DELETE success or confirmed 404), `retry` (`{reason}`). Failure clears lease and schedules backoff; successful deletion stamps deleted_at and preserves minimal audit metadata. Workers must only DELETE the bound RecordingSid under the bound provider account, never an arbitrary URL.

### Unstarted carrier-only settlement

`icash_settle_unstarted_recorded_call(p_id uuid,p_account uuid,p_operation text,p_receipt jsonb,p_components jsonb,p_evidence text)`

Receipt exactly `{providerAccountSid,callSid,fromPhone,toPhone,status,durationSeconds,priceMicros,currency:"USD",speechGatherUsed:boolean}`; canonical authenticated provider evidence is mandatory. Terminal status completed/busy/failed/no-answer/canceled; duration integer 0..600, price integer nonnegative USD micros. Session must be declined/absent/failed with no start claim, recording SID or conversation in either session/live/job tables. Declined always requires speechGatherUsed true. The 16-component manifest includes EL and LLM amount 0, basis not_applicable; twilio verified amount equals receipt; other amount is 20000 when speech used (otherwise 0) and subitems exactly `{speechGatherMicros:20000|0,recordingMicros:0,storageMicros:0}`. Speech estimate is labeled estimated, never a provider receipt. Other components retain explicit verified/estimated basis and evidence. SQL computes the existing frozen operation multiplier charge, checks reservation cap, stores an immutable exact receipt and invokes the existing atomic complete-cost settlement. Returns `{settled,operationKey,chargedCents,costBasis}` or NULL. No ElevenLabs receipt is fabricated. Exact retries are idempotent; changed receipt/manifest/evidence conflicts. This does not settle calls with an attempted recording start.

### Playback

A route must authenticate `workAccount`, use service SELECT restricted by BOTH id and account, require state available and `audio_expires_at > now`, then proxy bound provider media with no-store headers. No user table grants or public/storage media URLs.

## Verification limits

Run `node scripts/test-required-call-recording-pglite.mjs /path/to/@electric-sql/pglite/dist/index.js`. Tests run exact candidate SQL and role-denial probes locally. PGlite serializes queries; replay/interleaving tests do not prove independent PostgreSQL lock contention. The user approved the $9.77 recorded outbound ceiling; this file does not authorize deployment or enable provider paths. The local adapter now attempts canonical conversation binding on callback/handoff tool requests, with background readback for calls that use neither tool. A provider sandbox must verify that live metadata is available in time. Tools remain held on missing/mismatched evidence, and background binding cannot restore elapsed tool authority.

Before activation, use two disposable PostgreSQL sessions to test consent/start/lease CAS, commit/rollback and expiry while blocked on locks. Real provider signatures, Twilio recording callbacks and successful deletion require separate sandbox verification.
