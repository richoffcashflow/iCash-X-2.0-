# Voice settlement safety patch (review required)

The full-call rate is a reservation ceiling. It is not a usage receipt. Apply
`config/voice-usage-settlement.sql` after the existing estimated-settlement-fairness
and communication-fractional-billing configuration patches. The patch does not
backfill, reprice, refund, or modify any existing financial records. It creates no
rates and enables no calls.

## New behavior

Generic estimated settlement holds seller, buyer, and incoming calls, even after
the conversation completes. Both reservations remain held until reviewed usage
settlement is possible. Existing nonvoice settlement is unchanged.

The pure `voiceCostManifest` adapter requires all 16 categories explicitly:
- Provider-reported USD/micro amounts with evidence
- Reviewed fixed allocations, never prorated by call duration
- Documented unit rates with supplier-specific duration evidence, unit size,
  rounding and minimum units, always labeled estimated

No supplier prices, minimum billable units, subscription allocations or rounding
rules are supplied by this patch. Fixtures are not live rate cards. The carrier
can bill ringing and exceed agent duration. Using conversation duration as a
carrier proxy requires an explicit reviewed assumption in durationEvidenceRef;
it never becomes verified carrier usage. Missing duration/rule/evidence holds.

ElevenLabs requires a bound provider-reported USD observation for the same
operation and conversation. This includes platform and LLM, so the separate LLM
category must be zero. This does NOT prove incremental invoice cash: included
subscription usage may be valued by the provider. Do not also allocate the same
included usage via subscription overhead. `verified` here means the amount was
supported by the provider observation, not that subscription economics were
independently reconciled. Any estimated/fixed allocation makes the full manifest
`estimated`.

`icash_settle_voice_usage` requires a completed account-bound conversation with
numeric nonnegative observed duration, a matching ElevenLabs USD observation,
complete evidence, and the original customer quote ceiling. It calculates the
charge from the reservation's captured cost multipliers, then calls the existing
complete manifest/atomic ledger. Repeated identical receipts are idempotent;
changed receipts after settlement conflict and require a separate reviewed
reconciliation process. No automatic debit adjustment is included.

## Launch requirements / deliberate limits

The server integration now runs after `icash_save_live_result` and when an already
completed conversation is reconciled again. It reads the account-bound operation,
its captured rate ID, and the immutable operation/conversation-bound ElevenLabs
USD observation. The collector builds the complete manifest and calls the new RPC.
The automation route retries one dispatched voice operation on subsequent account
activity, ordered by the persisted `estimate_checked_at` timestamp (nulls first,
then operation key). An account/rate/state/timestamp compare-and-set touches only
that fairness timestamp before any provider reconciliation, including held,
missing-call and error outcomes. A lost claim does no provider work. Held rows
rotate across invocations, so a backlog larger than one page cannot indefinitely
hide later ready calls. Apply `config/voice-pending-estimate-isolation.sql` before
releasing this collector: generic estimate reconciliation must never touch voice
fairness timestamps, or its independent batches could undermine that rotation.

The collector attempts at most one operation/provider reconciliation, with a
20-second total AbortSignal propagated to each database/provider request and a
45-second deadline measured from automation route entry. Cancellation is awaited;
there is no background Promise.race settlement. Billing timeout/failure never
rewrites an already successful primary action. This is not a dedicated billing
scheduler: accounts without subsequent activity still need targeted operational
reconciliation. A late/missing receipt is never replaced by a guessed amount.

Set the **server-only** `VOICE_USAGE_POLICIES_JSON` environment variable to a JSON
array of reviewed policies. Absent, invalid, disabled, ambiguous, incomplete or
out-of-scope policies hold settlement. No live configuration is supplied or enabled.
Each policy requires:

- `enabled: true`, a stable `version` (at least 10 characters), the exact immutable
  `rateId`, and `operation` (`seller_call`, `buyer_call`, or `incoming_call`)
- `reviewedAt`, `validFrom`, `validUntil` as timestamps. Review must precede the
  conversation's creation, which must fall in the effective interval. Preserve old
  versions for reproducible retries; never revise a policy under the same rate ID
- `evidenceRef` with the reviewed rate/allocation source (at least 10 characters)
- `components` with precisely the 15 categories other than `elevenlabs`. That
  category always comes from the bound provider USD observation, never configuration
- Each component is either `{kind:"fixed_estimate", amountMicros, evidenceRef}` or
  `{kind:"duration_estimate", unitSeconds, microsPerUnit, rounding:"up"|"exact",
  minimumUnits, evidenceRef, durationSource:"conversation_proxy", assumption}`
- All integer amounts/units must be safe nonnegative values (`unitSeconds` > 0).
  `assumption` must explicitly document why agent conversation duration is an
  acceptable estimate for that supplier, including omitted carrier ringing where
  relevant. It is never labeled verified carrier usage
- The separate `llm` component must be zero with explicit evidence because ElevenLabs
  is inclusive. Every other zero also requires an explicit reviewed allocation or
  not-applicable explanation. Fixed overhead stays fixed at short durations

Carrier direction, country, media streaming applicability and supplier rounding
must be reviewed for each rate ID. If multiple carrier items share precisely the
same duration and rounding rule, an explicitly documented combined unit rate can
be used. Otherwise do not collapse unlike usage into a single rate; hold for a
reviewed manifest using actual supplier evidence. There is no default Twilio rate,
no inferred direction, and no required invoice upload. Public documented supplier
unit rates and explicit allocation assumptions are supported estimates.

Policies are immutable historical pricing evidence, not quote overrides. The RPC
retains captured markup/multipliers, customer ceilings, budget and all 16 categories.
Changing a settled manifest or its policy evidence causes an explicit conflict;
there is no automatic adjustment. The automation route reports reconciliation
failure rather than claiming a charge succeeded. Database observations are likewise
immutable and reject changed receipts. No schema or environment changes, provider
writes, launch settings, calls, or deployment were performed by these local tests.

Deploy the SQL safety patch before or atomically with the application integration.
Without it, the preexisting generic RPC could still settle at the full ceiling.
Do not enable voice until that migration, reviewed policy configuration, and the
separate provider/launch prerequisites have been approved and verified. Held
reservations require operational review; do not release them or call them a final
zero charge just because evidence is late.

## Verification

- `node --experimental-strip-types tests/voice-cost-settlement.test.mjs`
- `node --experimental-strip-types scripts/test-voice-cost-pglite.mjs /absolute/path/to/pglite/dist/index.js`
- `node --experimental-strip-types tests/voice-usage-service.test.mjs`
- `node --experimental-strip-types tests/voice-billing-deadline.test.mjs`
- `npm test`
- `npx tsc --noEmit`

The isolated PostgreSQL harness uses actual base credit, operation and manifest
functions, including wallet debit, reserve release, immutable retry checks, and the actual
server evidence collector → manifest → RPC → ledger flow.
It does not recreate the current account-margin/fractional wrappers or verify
multi-session races, deployment, provider prices, or end-to-end production calls.
The patch delegates to those unchanged wrappers in deployment.
