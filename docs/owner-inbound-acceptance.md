# Owner inbound audio acceptance: local integration candidate

**Code publication pending. Database installed disabled; no live-call verification.** This candidate adds a durable isolated test path; it does not release business voice, outbound work, seller invitations, or the consumed outbound owner-test authorization.

## Entry points

- Owner page: `/owner-inbound-acceptance`
- Authenticated API: `/api/owner-inbound-acceptance`
  - GET reads status without mutation
  - Same-origin JSON POST `arm` requires the exact confirmation plus current config ID, USD cap and reviewed rate evidence hash
  - POST `cancel` consumes the run; only an untouched armed run releases its reservation
  - POST `reconcile` fetches provider evidence for the bound run; it never accepts receipt/transcript/cost bodies from the browser or re-admits a call
- Existing exact-Bearer `/api/internal/voice/inbound` routes only the pinned owner/ingress/agent combination to the separate test path. Other callers retain all existing global/business guards. Disabled test paths do not fall through to a business agent
- Fresh-install SQL template: `config/owner-inbound-acceptance.sql`. The reviewed production migration `20261001221349_disabled_owner_inbound_acceptance` is already applied with no configuration rows. Do not repeat it
- The independent release switch is `ICASH_OWNER_INBOUND_TEST_ENABLED`; no environment value has been set by this work

## Pinned scope and fresh review

The target is account `48dfb798-8c1a-404f-88c0-c396cc067062`, owner user `592171a0-2bb9-484e-8c9a-dd5d2b43b5f7`, caller `+12142185280`, leased source `+14243948384`, ingress `+17816093521`, Twilio account the privately configured `TWILIO_ACCOUNT_SID`, matched against the reviewed database configuration and its installed exact-account CHECK, agent `agent_7801m3qsygdwfv5tggatf7w68y3d`, isolated branch `agtbrch_8901m3sw5tn6fvkae4d334netswh`, and inbound phone `phnum_9501m3qxddgne8gtr99wcce2h0gn`.

These are route bindings, not evidence that the configuration is currently safe. A new explicitly reviewed config must supply a **fresh** version/hash, branch name, regional endpoints, cost evidence and expiry. The historical outbound hash/version and outbound phone are not reused. No branch, phone binding, provider, credential, campaign, invitation or production setting was changed. Official versioning guidance makes call_limits shared across versions, and queueing is per-agent. The isolated branch may inherit Main queueing; changing shared settings is a separate approval and must not be smuggled into this test.

The existing canonical branch-review function validates the exact branch, zero global traffic, authentication, recording disabled, 60-second maximum, no external tools/MCP/knowledge base/procedures, and only the existing narrow inert Start workflow or no workflow. Only the inert end-call builtin is permitted. The new inbound-v2 reviewed configuration hash includes conversation config, privacy/auth/overrides/workflow/procedures, call limits and queueing configuration. Mechanical preflight requires platform_settings.queueing_config.enabled=false and call_limits.bursting_enabled=false; missing or legacy queue fields are rejected. The old outbound hash cannot serve as this new review. A matching historical hash is not substituted for review.

## Lifecycle and trust boundaries

### Private account configuration

The Twilio account identifier belongs in private deployment configuration, not in source or synthetic test fixtures. Server code takes the existing `TWILIO_ACCOUNT_SID` as an explicit trusted input. It validates the complete value and compares it with the reviewed database configuration and independently fetched provider receipts. Missing, malformed or mismatched input prevents arming, admission and settlement. It does not hide cancellation controls for an existing reservation. The installed database's validated literal account CHECK independently preserves the original exact account pin; this change does not alter that constraint or install environment values. Runtime availability of the existing variable still needs verification before activation.

For a separately authorized fresh installation only, `renderOwnerInboundSchema` in `scripts/owner-inbound-schema.mjs` takes the SQL template and an explicit privately supplied, reviewed account SID. It accepts exactly one placeholder and produces an exact literal SQL equality constraint. Unrendered SQL is syntactically invalid. The renderer does not read credentials or environment variables, log the value, write files or execute SQL. Do not commit its rendered output. Local SQL tests supply a randomly generated account identifier and verify a different account is rejected. Existing production installations require no SQL execution for this code change.

1. Server owner session and strict same-origin JSON boundary. The owner sees and explicitly approves a one-time USD wallet cap. Current config is compared in full under a database lock
2. The database reserves the full cap against the existing wallet and daily budget, while business work remains paused. One unresolved run per account and one run per reviewed config. Five-minute expiry is set by database time
3. Server creates a random eight-digit challenge. Only salt/hash persist. Plaintext is returned once in the private no-store owner arm response and kept in page memory until expiry/navigation/cancellation. It never enters prompts, dynamic variables, receipts, URLs, logs or audit
4. Exact authenticated webhook + caller/route eligibility atomically binds globally unique call/conversation IDs and transitions `armed → inspecting` **before** any provider read. This burns the attempt even when a GET times out or the process dies. It does not prove caller identity or authorize business actions
5. Regional read-only adapters independently fetch the Twilio call and reviewed branch/phone configuration. Pre-init Twilio evidence must prove call/account/caller/ingress/source; the exact authenticated ElevenLabs webhook binds the conversation ID under a unique database constraint. Missing Twilio receipt fields mean deny and retain the reservation for review
6. Pre-init does **not** require the already-effective conversation branch/version to be the selected test branch: branch selection has not yet happened. Instead, it independently preflights that branch and returns the officially supported top-level `branch_id` in the personalization response only after durable claim. Terminal proof must establish that selection actually took effect
7. The entire selected branch is a private no-business-data, no-business-tools audio test even before challenge validation. The model never receives the answer and never claims identity verification. The AI conversation duration cap is exactly 60 seconds; carrier setup/queue time is not inherently bounded by that field
8. Completion uses only freshly fetched terminal records. Exact chosen branch/version, call/account/phone IDs, start window, no recorded audio, no tool calls and both durations ≤60 seconds are required for audio pass. Only exact digit utterances (or unambiguous digit words) among the first three user turns can match. Agent speech and a fourth guess never pass
9. Receipt-bound cost settlement is separate from audio success. A rejected zero-second call can still have an authoritative bill; it can settle without passing the audio test. Mismatched or unknown costs never become a zero-cost refund. Explicit owner reconciliation may re-read unresolved costs but can never retry admission or re-arm

### Initiation and terminal evidence

The official personalization contract documents `conversation_id` and response `branch_id`; it does not guarantee that an independently fetchable conversation record with the required phone metadata exists before the webhook returns. Consequently this integration does not request an early conversation GET. The authenticated provider webhook supplies the unique conversation ID, independent Twilio GET proves the active call and route, and independently fetched branch configuration supplies the safe no-tools response. Exact ElevenLabs call/branch/version/transcript proof is mandatory before any terminal audio pass. No early receipt is fabricated, and caller ID alone is never sufficient.

Twilio `forwarded_from` must independently equal the leased source for admission/audio proof. Its presence and preservation by the real forwarding chain remain unverified. A direct call to the ingress is not accepted as proof of the source forwarding path. Failed-call cost reconciliation may still match exact provider call IDs/account/phones without falsely certifying source forwarding.

## Budget, settlement and refund semantics

- Service-only RLS-protected configuration, run and append-only audit tables; functions are security invoker with no public/anon/authenticated execution
- Reviewed worst-case rates, quote cap and validity are required before arm; the reservation and existing daily budget are locked atomically
- Regional Twilio terminal `price` is a USD connectivity debit; ElevenLabs `metadata.cost_fiat` is USD. Legacy ElevenLabs `cost` credits are never converted
- Exact decimal USD values become integer micro-USD without rounding. Unknown, malformed, nonterminal or >6-decimal values remain unknown. This is provider receipt evidence at reconciliation time, not a promise that a supplier will never issue a later billing adjustment
- Database charge is `ceil((Twilio micros + ElevenLabs micros) × reviewed multiplier / 10000)` cents. This is a wallet charge, not a claim that suppliers bill whole cents
- The adapter’s subtotal does not include arbitrary forwarding charges, taxes or add-ons. Arming requires separate reviewed assertions that all costs are covered, forwarding has no incremental charge, and extra provider services are disabled. Unknown extras block release. Queueing is independently checked off in current provider configuration. Carrier setup/hangup overhead still needs a separately reviewed all-in bound; an estimate alone is insufficient
- If authoritative costs exceed the approved cap, the run stays on review with its reservation held; no over-cap wallet debit or automatic retry occurs. The application cannot independently guarantee that an external supplier will never bill beyond its reviewed rate/cap
- Unknown/partial receipts retain the reservation. Known authoritative cost/receipt pairs cannot be revised downward through replay. Definitive zero is distinct from missing cost
- Cancel/expiry refunds only a never-observed armed run. Canceling an observed/active call does not stop the provider call. It consumes the grant and retains its reservation for explicit settlement

## Remaining release blockers

1. Fresh branch, route, credentials-availability and regional API review through existing authorized access; no credential creation or transfer is part of this patch
2. Prove current Twilio initiation receipt availability and exact schema, source-number evidence, selected-branch behavior, and reject-without-business-fallback behavior
3. Independently verify current forwarding state. This patch performs no forwarding mutation
4. Exact Bearer webhook authentication must succeed under a separately authorized test. Historical 401 and later editor completion do not prove the integration works; no auth was weakened
5. Reviewed actual all-in spending bound, including zero incremental forwarding/extras, and explicit owner dashboard approval. Existing disabled planning rates are not enabled or treated as hard evidence
6. The disabled schema is already installed. Creating any reviewed configuration or activating it still requires separate explicit authorization; no configuration seed exists
7. Run real multi-session PostgreSQL lock/race verification and authenticated browser UI tests against an isolated test database. PGlite is real SQL but serializes calls and is not proof of cross-session races
8. A separately authorized bounded call and provider reconciliation would still be required. No call or provider mutation has occurred

The current business invitation path remains unchanged: no genuine seller invitations were invented, route/hash/rate/campaign holds were not changed, and the owner remains paused.

## Official protocol references

- [Twilio personalization, including response branch_id](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/customising-calls)
- [Shared per-agent settings across versions](https://elevenlabs.io/docs/eleven-agents/operate/versioning)
- [Call queueing and duration semantics](https://elevenlabs.io/docs/eleven-agents/guides/call-queueing)
- [Current queueing_config schema](https://elevenlabs.io/docs/changelog/2026/9/14)
- [Conversation receipt API](https://elevenlabs.io/docs/eleven-agents/api-reference/conversations/get)
- [USD cost_fiat release](https://elevenlabs.io/docs/changelog/2026/7/6)
- [ElevenLabs regional CLI bases](https://github.com/elevenlabs/cli)
- [Twilio Call resource and connectivity cost](https://www.twilio.com/docs/voice/api/call-resource)
- [Twilio regional edge endpoints](https://www.twilio.com/docs/global-infrastructure/understanding-edge-locations)
- [Supabase RLS and table grants](https://supabase.com/docs/guides/database/postgres/row-level-security)

## Local verification

All provider fixtures are synthetic and all receipt adapters are GET-only. No tests use production credentials, databases or calls. See `docs/owner-inbound-verification.json` for the final executed commands/results and remaining unrun checks. SQL local runner accepts the explicit existing PGlite module path; it never downloads a package or opens a network connection.

## Narrow staged release plan (not authorized or executed here)

1. **Review code publication separately.** Inspect the patch and tests; publishing a branch/PR or inactive app code requires authorization. Keep `ICASH_OWNER_INBOUND_TEST_ENABLED` unset/false and every business HOLD unchanged. No provider changes are required merely to review or publish inactive code
2. **Preserve the installed database.** Do not repeat migration `20261001221349_disabled_owner_inbound_acceptance`. Add a new disabled config only after separately authorized fresh identity/branch/version/hash/rate review. It is never copied from the expired outbound grant. Run independent PostgreSQL multi-session and isolated authenticated UI checks. Fresh environments use the explicit private-input rendering process above
3. **Resolve configuration blockers before release.** Establish regional Twilio initiation and terminal ElevenLabs receipt availability and genuine source forwarding evidence. Verify queue/burst settings without assuming branch independence. Any shared-agent change, alternate fully isolated agent, phone binding or other provider configuration needs its own bounded authorization. Do not change Main or globally activate work as a shortcut. Credential editor completion is recorded, but controlled exact-Bearer success still needs evidence; no repeat secret entry is assumed necessary
4. **Review forwarding as its own action.** Obtain authoritative current Contiguity forwarding state first. If a change is necessary, approve its precise source/destination and rollback plan separately; do not infer that messaging failover is voice forwarding or that the lease alone proves forwarding
5. **Only then consider one paid test.** A fresh server config supplies the actual proposed USD customer cap. The owner must approve that displayed cap, wallet reservation and one test before arming. There is no currently configured/approved cap in this patch. The existing 65-cent incoming planning estimate is not adopted. Supplier all-in spend risks and shared settings remain separate from the hard application-level wallet debit ceiling
6. **Reconcile and stop.** One five-minute grant, at most 60 seconds of AI audio, first 3 challenge attempts only. Fetch terminal receipts, settle at/below the approved wallet cap or hold unknown/over-cap costs. Never retry or fabricate invitations. A successful private audio test does not authorize business calling, outreach, seller access or a second call
