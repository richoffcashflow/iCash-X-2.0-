# Ended owner gate calls with a pending carrier price

Base: `eb9d3b36bbb5c5475ffa9954cfafed6aac70e5f8`.

This is a narrow orchestration exception for the isolated owner acceptance tests. It preserves the lifetime limit of three attempts, 60 seconds each, and a $3 provider budget. It does not change the immutable owner/phone/provider review, quote, approval window, expiry, historical evidence, or any customer wallet. No test is initiated by installing it.

## Admission

A previous unsettled run qualifies only when every condition below is true:

- State is failed and its existing reconciliation reason is specifically `owner_carrier_price_pending`.
- The call is bound and canonically ended, with a confirmed answer time.
- No consent, recording-start claim, recording, AI-registration claim or conversation ever occurred. Audio/cost metadata is absent. No contact opt-out exists.
- Its entire $1 reservation remains untouched and no settlement exists.
- Immediately before a later start, authenticated server-side Twilio GET returns the exact bound call/account/from/to/direction, completed status, matching start time, integer-string duration of at most 60 seconds, USD currency, and explicitly null price. Undefined, malformed, known price, bad binding and all other provider failures stay held.
- A private append-only attestation records only that validated receipt. SQL requires it to be no more than 30 seconds old and match the prior row's current version. No request-body flag, generic error string, estimate, operator assertion or UI display can substitute for that evidence.

Status reads may show readiness after the same fresh read-only checks, but they do not write attestations or admit calls. The start path rechecks and writes the service-only attestation; SQL remains the final authority.

Budget arithmetic continues to use actual settled cost, or the FULL original reservation when unsettled. The first pending dollar is never reused or marked as spent/settled. A later attempt receives its own dollar. Three held attempts consume all three dollars and all three attempts. A prior AI/recording attempt, unknown dial or unconfirmed end still blocks subsequent starts.

## Races and overruns

Attestations, claim and transition functions use a config-first lock order. Claim locks all existing run rows before counting costs/attempts. A changed row version invalidates prior proof. This serializes starts with each other and with observed cost settlement.

An observed cost above any attempt's reservation blocks every future start and durably requests END on active owner attempts. The collector immediately attempts those known terminations, with existing maintenance recovery and the carrier's 60-second call cap as fallback. If an overrun arrives while a dial is in flight, the adapter binds the already-known CallSid against refreshed CAS state and honors END; it does not redial. Unpersistable binding triggers an immediate termination attempt on the exact validated newly dialed CallSid and remains held.

The budget check is an admission safeguard. A late unexpected vendor charge can reveal an overrun after an earlier reservation; the system records the real charge and stops further usage rather than truncating the receipt or pretending a vendor-guaranteed cap exists. The reviewed gate-only planning maximum is $0.1145 ($0.0945 connectivity plus $0.02 for one Gather); the full $1 remains reserved even though that estimate is smaller. Provider estimates are not settlement receipts.

## Release and verification

Apply only `config/owner-recording-retained-reservation.sql` before deploying the reviewed code. It adds the private attestation table/helper/service-only RPC and replaces only owner claim/transition orchestration. It does not invoke or change production funding/bootstrap functions, reset the old probe, alter the configuration, or rewrite old run facts. Existing cleanup and reconciliation continue.

Local checks cover exact-SQL three-dollar reservations, no old-fact changes, fresh/stale/version/foreign proofs, ACLs, unrelated errors, one active call, late overrun, dial-in-flight and competing binding races, plus the original owner full flow. Independent review exercises native two-session PostgreSQL admission and settlement ordering. All provider activity in these checks is synthetic.
