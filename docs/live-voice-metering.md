# Live call metering candidate: NOT ACTIVATED

This branch is a disabled implementation candidate, not a production release or
a claim that provider spending is guaranteed to stop at the wallet balance.
It changes no live price, wallet, reservation, provider configuration or past call.

## Intended behavior

New eligible inbound and outbound seller calls would receive a short, internally
funded carrier deadline instead of starting with the full business-duration cap.
The wallet's `reserved_cents` remains unchanged. Internal exposure accounting
prevents other calls or work from spending money already needed by an active call.
The customer balance falls only as cumulative estimated usage is provisionally debited.

Provisional usage is an estimate, not an invoice. A complete, bound final provider
receipt still uses the operation's original cost multipliers and quote ceiling.
The ledger charges or credits only the difference from the cumulative live debit.
Repeated ticks and final receipts cannot double-charge. A missing final receipt
does not become a zero-cost call, a refund, or a fabricated completed receipt.

Historical calls do not acquire meter rows. Their unresolved authorization caps
remain read-only exposure for safe new admission. No manual balance release or
historical repricing is part of this change. Outbound buyer calls stay disabled.

## Blocking pricing evidence

The existing ten-minute ElevenLabs quote is not an enforceable short-interval
cost ceiling. Its LLM component was an expected-token estimate, and current
inbound configurations include different models. Output-token limits alone do
not bound input history, tool context, retries, fallback models or inference count.

Official references checked October 15, 2026:

- [ElevenLabs cost calculator](https://elevenlabs.io/docs/api-reference/agents/calculate)
  describes expected usage, not a maximum spend guarantee.
- [LLM pricing](https://elevenlabs.io/docs/eleven-agents/customization/llm)
  depends on model and token usage.
- [Agent billing](https://elevenlabs.io/docs/help-center/product/eleven-agents/how-much-does-eleven-agents-cost)
  uses connection duration with silence rules; LLM costs are separate.
- [Twilio Call API](https://www.twilio.com/docs/voice/api/call-resource)
  supports `TimeLimit` and `Status=completed`. Successful write acknowledgement
  is evidence of the submitted command; Call GET does not echo a `time_limit`.

Do not populate a live policy with `912000 / 600`, a historical observed maximum,
an arbitrary percentage buffer, or an unverified evidence string. Activation
needs a configuration-bound, enforced inclusive liability envelope, including
in-flight LLM work and shutdown exposure. A provider-enforced budget or a separate
cumulative token/inference-budget integration could supply it; neither is built
or authorized as an implicit provider/model change here.

Without that envelope, the existing integration can provide estimated live usage
and an approximate time-based cutoff, but not strict prepaid enforcement. This
candidate must remain disabled. There is no approved platform overrun allowance.
The private enforcement capability deliberately returns false: a policy flag or
well-formed evidence string cannot turn this scaffold on. Replacing that gate
requires a reviewed implementation of the missing provider control.

## Safety design

- Initial carrier limit is 120 seconds, preserving the existing application
  minimum. Later funded limits increase in 60-second segments, never beyond the
  current business maximum (600 seconds, or 120 for limited intake).
- Reviewed fixed costs stay fixed. Per-time components use their own rounding
  and minimum units. Provisional cent rounding is cumulative, never per tick.
- The next segment is protected in one database transaction before the carrier
  is asked to extend it. Unknown provider writes retain that exposure.
- A lease or ticket expiring never releases money, repeats a dial or proves a
  call ended. Only canonical terminal evidence and final reconciliation resolve
  the remaining obligation.
- Metered final shortfalls require review; they do not invoke the legacy
  automatic platform-coverage grant.
- The dedicated worker lane targets ten-second intervals with an eight-second
  pass deadline, at most 20 claims and four concurrent endpoint requests. It
  does not wait for ordinary automation; a saturated pass reports held. A provider-side
  hard limit remains effective if the worker or database is unavailable.
- Initial carrier acknowledgement is required before recording or AI starts.
  A canonical GET or callback is not proof that the duration command succeeded.
- Unbound admissions cannot starve bound calls in the due queue. Abandoned
  outbound admissions can be cancelled only when locked authoritative state
  proves they were never dial-claimed, bound, started or used. Bounded stale
  recovery uses the same proof; age alone is insufficient. Wallet and ledger
  stay unchanged. Claimed/unknown outcomes and inbound carrier exposure remain
  protected pending real receipts.
- Metering capabilities are short-lived, one-use and bound to a known operation.
  The endpoint accepts no account ID, prices, elapsed time or provider URL.

## Candidate files and verification boundary

`config/live-voice-metering.sql` contains the disabled accounting scaffold.
`config/live-voice-metering-tickets.sql` and the read-only account-disclosure
wrapper in `config/live-voice-metering-disclosure.sql` depend on it. No live
policy rows are provided. Server integration also requires `ICASH_VOICE_METERING_READY=true`;
this branch does not set it. These config files are not an applied migration.

Focused tests:

```sh
node --experimental-strip-types tests/live-voice-metering-database.test.mjs
node --experimental-strip-types tests/voice-live-metering.test.mjs
node --experimental-strip-types tests/voice-metering-worker.test.mjs
node --experimental-strip-types tests/voice-metering-route.test.mjs
node --experimental-strip-types tests/required-call-recording.test.mjs
node --experimental-strip-types tests/recorded-reception.test.mjs
node --experimental-strip-types tests/provisional-voice-usage-disclosure.test.mjs
node --experimental-strip-types tests/provisional-voice-usage-disclosure-database.test.mjs
node --experimental-strip-types tests/voice-metering-draft-deployment.test.mjs
```

Tests use local database fixtures and mocked provider transports. They do not
validate live tariffs, provider control latency, the actual deployment, or paid
calls. PGlite serializes transactions and is not proof of cross-process lock
contention. Before any production activation, native PostgreSQL race tests,
worker capacity/latency validation, deployed customer-facing disclosure checks,
all enabled rate/model bindings and final receipt collection must be completed
and reviewed. No partial test pass waives the blocking pricing requirement.

## Draft publication and local verification limits

The exact branch `codex/draft-live-voice-metering-20261015` is blocked by the
existing Vercel ignored-build command so publishing the draft cannot serve an
automatic preview. Main and other branches retain their existing behavior.
No project settings, production environment flags or provider credentials change.

The workspace notice appears only for actual unsettled provisional debit entries
belonging to the authorized account. It explains pending final receipts and
original-rate difference-only reconciliation. No precise live amount is inferred
from a separately read balance. Existing unmetered, test and settled-only
snapshots and customer prices stay unchanged. See
[disclosure design](live-voice-metering-disclosure.md).

This environment has no available native PostgreSQL binaries, local database
socket or container runtime. PGlite tests exercise both serial claim/cancel orders,
not genuine cross-process contention. The cloud Chromium process could not start
under the available sandbox; browser layout/screenshots are not verified. No
software installation, hosted database, provider call or production mutation was
used to work around those limits.
