# First-entry walkthrough

After the workspace acknowledgment, new members see “First, watch the course.” The primary action opens the existing private course and saves the next tour step. They can also choose “Show me around” to highlight bot controls, properties, and the account menu. Tour controls do not activate any workspace actions.

The course offers “Continue workspace walkthrough.” Progress is stored per authenticated account in `icash_workspace_walkthroughs`, independently of recorded video playback. Next, dismissal, completion and replay are saved. Dismissed tours show a small resume card; completed tours stay closed. The account menu always offers “Take a walkthrough.” Existing acknowledged accounts receive the `available` state during migration, so rollout does not interrupt their work or claim they completed the course/tour.

The API derives account and user IDs from the verified session, requires active workspace access, and validates origin, input size, step, state and rate limits. The table and save RPC are service-role-only with RLS enabled. The RPC also binds the account owner. Loading or saving failures never prevent using the workspace; failed saves offer Retry. Pending browser writes are canceled when the account view unmounts.

Verification: `node --experimental-strip-types tests/workspace-walkthrough.test.mjs` exercises the real SQL with PGlite and the real API handlers. After building, `BROWSER_SCENARIOS=walkthrough node --experimental-strip-types tests/reliability-browser.mjs` checks desktop Chromium and mobile WebKit, course navigation, focus, viewport fit, dismissal, resume, replay, account isolation and failure recovery using intercepted APIs. No live work or messages are created.
