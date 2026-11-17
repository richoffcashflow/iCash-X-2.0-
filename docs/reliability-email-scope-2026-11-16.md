# Reliability email scope

The owner requested a reset of resolved workflow flags and clear explanations of
critical-priority emails. A critical incident can come from three affected
accounts or one unhealthy background component. It does not establish that the
whole application is down. Pending original receipts and absent recent completion
records also do not prove that every task in an account stopped.

The ordinary owner email now puts the observed scope in its subject and explains
what needs attention, which background checks respond, the account categories,
the evidence time and the next action. The incident-record flag count and reasons
read when claiming the notification are labeled separately from the subsequent
current snapshot. Freshness is checked
independently for the snapshot, component checks and account observations; stale,
future, missing and malformed evidence cannot imply healthy service or recovery.
Past 24-hour activity remains distinct from present service availability.

These ordinary checks do not test website access, sign-in or every call/text
provider. They therefore cannot confirm a whole-platform outage. The independent
monitor's fallback likewise reports unverified impact after repeated failed
checks, including simultaneous core dependency failures, rather than claiming
every customer feature has stopped. Its complete payload stays identical within
the UTC hour for the existing cross-replica idempotency key, while displaying the
window in Central time with AM/PM. No new probe or request is introduced.

Recovery email describes the recorded clear window and the latest observation
separately. A newer failure or unavailable snapshot prevents a claim that current
health is clear. The existing 15-minute observed recovery rule, severity policy,
notification claims, recipient verification, cooldowns, uncertain-send holds and
receipt-only retry remain unchanged. Provider acceptance is not inbox delivery.

Reset only an exact finding whose original source evidence proves resolution.
Healthy worker/maintenance checks, successful deployment, a fresh snapshot or a
smaller count do not resolve an uncertain provider operation. No reset is part of
this code change, and unresolved flags, financial holds, original receipts and
work queues remain intact. The existing presentation-only acknowledgment path is
not proof that blocked work completed.

Offline tests cover critical account-only alerts with healthy background checks,
single and multiple component failures, independent stale/future/missing evidence,
changing incident/current counts, recovery followed by new issues, and repeated
application/database/combined fallback failures. They retain provider-attempt,
recipient, preview, privacy and hourly payload invariants without live sends.
Release through the existing exact-head and exact-main Reliability checks and
verify the web, worker and independent monitor versions; no migration or provider
configuration change is required. Production success requires its own receipts.
