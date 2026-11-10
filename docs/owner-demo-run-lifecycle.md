# Owner self-demo run lifecycle

A new request ID from the exact presenting owner and their self-demo phone is a new run. An exact retry returns the original intake before registration. The separate identity and sender-ranking changes must be installed with this lifecycle in one atomic migration; do not release cross-request deduplication separately.

## Run boundary

- Registration is private, source/account/phone-bound and append-only. It cannot enroll an old intake or renew a call-now receipt.
- The newest submitted run activates through the existing contact-preparation path. It waits while a predecessor has active or unknown provider work. It may retire only exact prior self-demo screens, threads, permissions and unstarted pending work.
- Existing dispatch, provider, lookup, credit, account Pause and opt-out gates remain. Retirement does not update budgets, operation spend, reservations, provider receipts, consent, request times, call records, deal terms or signing envelopes.
- Completed or already-issued signing envelopes retain their links, terms and late-webhook identity. Creating/uncertain signing operations still block retirement. Active AI analysis and its issued/consumed tickets also block retirement.
- A predecessor finishing after the new request must be terminal and settled before the new call can dial, within the original five-minute request. The existing final serialized owner-call gate rechecks this. No expiry is renewed. Historically terminal calls keep the previous financial-hold semantics.
- Superseded ready/held calls without any operation, recording or provider identity are canceled. Unknown attempts are never cleared or rebound. Original active/uncertain recording fences include pre-dial rows without a terminal receipt.

## Text routing

Retained same-number history cannot identify which run an incoming “yes,” price, or repeated property address answers. Such text stays unbound and reviewable. For an exact isolated, activated self-demo pair, it gets no route revision, creates no automatic reply, and does not set a pair-wide hold or invalidate the current new run. Existing STOP ingestion executes first and remains global.

A unique explicit address can identify a different current property only when it matches exactly one current/historical delivered thread. The same address across two runs is ambiguous. Active owner-buyer tests retain their existing explicit route priority. Ordinary seller, foreign-account, other-role or already-held ambiguity retains ordinary full routing holds.

Late delivery webhooks continue updating only the original provider-ID-bound message. Quarantined replies cannot be rebound by recent-owner-question recovery because their revision is null.

## Verification and rollout

The metadata-only fixture captures actual current production functions on 2026-11-10, including the current owner-buyer resolver wrapper and contact preparation. Strict preflight hashes reject changed definitions for contact preparation, final owner-call admission, the public resolver and message-route trigger. The atomic integration bundle owns the original submission/finalizer and sender prerequisites.

`node --experimental-strip-types tests/owner-demo-run-lifecycle.test.mjs` passes 23 offline PostgreSQL scenarios, including actual contact preparation across eight same-address runs on one sender, exact retry, retired history, active/unknown/STOP isolation, serial calls, old replies and late webhooks, actual owner-reply recovery, unique-address and buyer routing, completed/issued signing history and private ACLs.

Final release still requires the combined identity/lifecycle/ranking fixture, native concurrent submission/admission tests, aggregate checks and independent review. No provider tests or live workflow mutations are part of this verification.
