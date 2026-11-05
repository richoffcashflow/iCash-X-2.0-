# Owner self-call routing after reset

The November 4 inbound rejection was reproduced as `ambiguous_account` for the owner's self-demo phone. Twenty-six archived seller sources remained callback candidates alongside the current demonstration. Two revoked buyer tests still counted as buyer-role conflicts because their delivered receipts were deliberately retained. Removing either blocker alone would leave the other rejection.

`owner-self-callback-history.sql` excludes archived screening sources only for the existing, exact owner account/user/self-phone binding. It excludes a buyer receipt only when its exact owner buyer test is revoked, its bound thread retired, and its property archived. Current seller controls, active buyer conflicts, other owner contacts, other customers, cross-account evidence, provider identities, financial admission and call-role conflicts retain their existing behavior. No history, credits, suppressions or pauses are changed.

Direct reception also saves the callback route for a known caller on the base account. Previously only a customer child configuration saved it, so an owner callback could lose its current property when there was no incoming-text focus. The existing recording/context/final-registration checks now validate this source too. An unknown caller retains general reception. A reset after admission cannot move the existing call to the next demo.

## Verification

Run `node --experimental-strip-types tests/owner-self-callback-database.test.mjs`. This uses the real resolve, reserve, recording transitions and property-context functions with local synthetic carrier receipts. It repeats the customer and receipt-only regression cases, reproduces the 26 archived sellers/two revoked buyers, and checks current property context, call-only context, ambiguity, paused/manual/retired sources, suppression, funding, buyer identity, cross-account evidence and changed-source rejection. It makes no paid calls or texts. Ordinary caller identity does not authorize a contract or a financial action.

## Release and rollback

The migration is compatible with the currently deployed callback service: no web/worker or provider configuration prerequisite is introduced. Apply after focused verification and review, read back the owner route and compare other recent customer routes, then complete the normal exact-head CI/automatic-release process. Do not infer a successful live conversation from a matched database route.

Both function patches assert their exact insertion points and preserve existing function privileges and locks. If either has drifted, the transaction aborts without partial application. Rollback replaces those two insertion points with their pre-migration text, then removes the two private helpers. Do not delete provider receipts, reset accounts or alter existing sessions as rollback. Any still-open session with a saved source continues through the existing current-source checks.
