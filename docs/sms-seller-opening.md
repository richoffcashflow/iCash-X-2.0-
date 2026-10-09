# Owner-first seller SMS

Apply `config/sms-seller-opening.sql` once after the current SMS campaign, contact-intake, manual-reply-continuity and unstarted-opener-recovery SQL. This is an additive schema/function release; shipping the TypeScript alone does not change the production campaign opener. No live changes were made while developing this patch.

New campaign conversations:

1. `Hi, I am the AI assistant for [actual business]. Is this the owner of [saved address]?`
2. Only an unambiguous, whole-message ownership confirmation queues `Would you be interested in selling your property for all cash?`
3. Only a separate positive reply to that successfully sent interest question can reach the existing call-invitation flow. This never authorizes an outbound call.

Name greetings require a strict self-introduction from the contact after a successfully sent outgoing message in the exact account/property thread. Only the self-introduced first name is used; the property-record seller name is never used as the contact name. Existing conversations are not automatically restarted. The supported explicit opener queue can greet a returning matched seller when there is no existing opener assignment or recent/pending message; it never fabricates a prior exchange. Already-sent legacy openers keep their original interpretation and are not rewritten.

Missing identity/address, an unsafe or oversized single-segment message, ambiguous ownership answers, or later conflicting replies hold the action. Names and addresses are never silently truncated. Existing consent, do-not-call, STOP, account, rate, timing, budget and atomic provider-claim checks remain in effect. Each additional SMS still requires its own existing price reservation. An expired unconsumed ticket for the second question can be replaced, up to three capabilities total, only while no provider receipt, operation reservation or uncertain outcome exists. Already issued active capabilities and consumed tickets are never replayed. No permissions, campaign release, rates, balances or provider configurations are changed.

The ordinary AI-analysis path also refuses to turn an answer to the owner question into qualification; the deterministic campaign owns the two-step opening.

## Verification

- `node --experimental-strip-types tests/sms-seller-opening.test.mjs`
- `node --max-old-space-size=384 --experimental-strip-types scripts/test-sms-seller-opening-pglite.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js`

The SQL suite uses only an in-memory database, the real production functions and synthetic fixtures. It verifies the two separate affirmative answers, real-history names, replay prevention, missing/oversized address, ambiguous/negative replies, STOP, later corrections, account separation, and pause/release/permission/rate/funding/screening dispatch holds.
