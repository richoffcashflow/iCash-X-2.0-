# Atomic SMS claim refusals stay held

An ordinary seller opener's final database admission returned HTTP 400, SQLSTATE `P0001`, and the fixed legacy message `Text already dispatched`. The application discarded that classification, returned a generic database failure from automation, and temporarily put the worker into infrastructure backoff. A later ordinary poll restored worker health; the original refusal was not evidence of a provider outage or a completed send.

That SQL exception means the current atomic operation gate returned false. It can reflect an earlier operation or a changed control, rate, reservation or seller response. The repair does not infer which reason applies, count a send, release money, reset the message or create another attempt.

The database error mapper now recognizes only that exact HTTP status, SQLSTATE and message from `icash_claim_text` or `icash_claim_customer_text`. The text service catches the resulting typed error only around its final claim and returns the existing `message_held` outcome. The existing automation route records a held attempt with `p_success=false`; it does not report message acceptance or completed work. The worker can then poll for another fresh capability without infrastructure-failure backoff.

Other paths, HTTP statuses, SQLSTATEs, body changes, malformed responses and transport failures remain generic database failures. Errors before the final claim are not classified by the text service. Any error after provider entry still leaves the original delivery in review and cannot authorize another send. No SQL, final-admission predicate, financial rule, customer control, sender configuration or retry limit changes.

## Verification

`tests/text-claim-refusal.test.mjs` first reproduced the old 503 through the actual base claim in PostgreSQL, HTTP error mapper, text service, automation route and worker. Its fixture changes final admission after the service preflight and checks that PostgreSQL rolls back the attempted reservation. The corrected result retains the original message and no provider ID, records only a held capability, makes zero provider calls and permits a fresh independent capability without outage backoff. It also verifies strict classification boundaries, lost database/completion responses, one-use capabilities, ordinary admitted sends and provider uncertainty without replay.

The real base text claim is taken unchanged from `config/text-messaging.sql`; final financial admission is an explicit local fixture. This test does not reconstruct every production SQL wrapper or prove a live customer's current eligibility. All network responses and provider actions are offline fixtures.

Existing inventory admission, deferred text, journey preflight, database response/cleanup, text receipt/routing, channel admission, automation failure isolation and sender-volume suites passed, together with TypeScript. Register `text-claim-refusal` in the shared local release list; the ordinary all-tests runner already discovers it. No database migration or policy activation is required. Production verification remains with the release owner.
