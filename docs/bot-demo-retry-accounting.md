# Demo retry accounting

The authenticated owner demo route preserves the original `bot-demo:ip:` and
`bot-demo:id:` buckets and their five-new-intent/hour budget. It never resets
existing counters or creates a replacement allowance namespace. A separate
`bot-demo-attempt` IP/user limit bounds total transport attempts at sixty/hour.

`icash_submit_limited_bot_demo_intake` is service-only. It locks the operating
budget before the request identity, matching the demo lifecycle/direct-submit
order. Only an absent request ID takes the original two allowance buckets.
These charges and the underlying submission are one database transaction. A
denial raises uncaught `PT429` before any intake insertion; validation failures
also roll both counters back. The caller cannot choose limits or actor buckets.

Existing IDs always pass through the original submit function's account,
guest, source, consent and payload comparison. Existence alone grants nothing.
A validated retry from a different IP is still the same admitted intent and
does not change the original receipt, timestamps, budget window or allowance.
An uncertain earlier commit is resolved by the same transaction and identity,
not a new request or replayed allowance. The original consent and downstream
operation claims continue to govern provider work.

Readiness GET establishes the existing secure guest cookie before the form can
submit. POST refuses a missing or malformed cookie before accounting, intake,
call-now grants or after-response work. Losing the POST response therefore does
not also lose the only cookie that could validate the retry. No guest check is
weakened or silently rebound. The client already waits for readiness GET.

Only the exact wrapper path, HTTP429, SQLSTATE `PT429` and known refusal message
produce the typed rate-limit error. All unknown database outcomes remain503.
The route returns fixed safe429 text and `Retry-After: 3600`; arbitrary upstream
diagnostics are never echoed. A refusal schedules no pipeline work.

## Installation and verification

Include `config/bot-demo-retry-accounting.sql` in the same atomic owner demo
restart bundle as distinct-intent and lifecycle changes, then deploy the route.
This component does not install itself, run production SQL or create a separate
migration. Existing controls, source checks and downstream spend gates remain.

Offline checks:

- `node --experimental-strip-types tests/bot-demo-retry-accounting.test.mjs`
- `node --experimental-strip-types tests/bot-demo-retry-route.test.mjs`
- `python3 scripts/test-bot-demo-retry-accounting-postgres.py`

The native check uses only the disposable localhost reliability database and
rebuilds its public schema. It verifies concurrent exact retries, conflicting
payloads and distinct intents across IPs. Exactly five new IDs may commit.
The focused fixture uses the existing original submit body; the final bundle
must additionally exercise the wrapper around the integrated lifecycle body.
No providers, calls, texts, signing, charges or live account changes are tested.
