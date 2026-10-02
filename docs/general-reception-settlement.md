# Receipt-bound reception settlement candidate

Status: local candidate for bounded per-call repair only. This does not implement an automatic normal-customer settlement rollout; a reviewed ongoing allocation policy is still missing. No production deployment, database migration, cost approval, wallet debit, reserve release, or provider call was performed by this work.

## What this fixes

Reception completion lives in `icash_reception_private.receipts`, while `icash_settle_voice_usage` requires a separate `icash_live_conversations` record. Fabricating that record or marking the reserve cancelled would lose the real financial provenance. This candidate binds an independent settlement bridge to the actual reception receipt and reuses `icash_settle_complete_costs` and the existing atomic wallet/operation ledger.

The server collector still verifies canonical authenticated Twilio and ElevenLabs GETs, exact CallSID/nonce/user/agent/branch/version/caller binding, bounded duration, and terminal completion before attempting settlement. There are no new provider writes or new credentials. The owner endpoint remains a fixed, no-argument, owner-authenticated POST.

## Required evidence and review

A database-owner reviewer must insert exactly one immutable, per-receipt `cost_reviews` row after inspecting the authoritative cost evidence. The application service role cannot insert, change, delete, or read that private table. The settlement RPC can only consume a review whose full attestation exactly matches the current collector input. Do not install a synthetic test fixture as a live review.

The attestation binds the receipt ID, operation key, account, CallSID, nonce, configuration hash, agent, branch, reviewed version, conversation, profile, rate, duration ceiling, customer cap, actual duration, and both provider USD amounts and receipt SHA-256 hashes. All 16 cost categories need explicit evidence and a `verified` or `estimated` basis. Twilio and ElevenLabs require actual verified receipts. The separate LLM component must be verified zero because the accepted ElevenLabs receipt is inclusive; do not double-count it.

Other zero entries require reviewed not-applicable/included evidence, never missing-data defaults. Documented estimates for infrastructure or allocations are permitted only when separately approved for usage billing; their settlement stays `estimated`, `allInCostVerified=false`, and `providerMarginVerified=false`. The database uses the operation's snapshotted multipliers. It never substitutes the planning rate's costs.

Current quick-test planning rate reported by the parent is `incoming-us-local-60s-estimate-20261001-v1` (expires 2026-10-07), with a 20% reserve buffer and 65-cent cap. Its nonprovider planned values total 40,000 USD micros: GitHub 1,000; Vercel, Railway and Supabase 3,000 each; payments and acquisition 10,000 each; support/overhead and refund/dispute reserve 5,000 each. These eight allocations still need actual evidence or a documented approved usage-allocation policy. Five other zero categories (DealMachine, messaging, email, title/signing, other) need applicability evidence. The LLM zero needs the inclusive-provider evidence. Neither the 91,200 ElevenLabs estimate nor 12,900 Twilio estimate can replace the missing actual receipts.

## Safety and behavior

- No review, unknown provider price/units, mismatched evidence, invalid reservation, or above-cap computed charge keeps the hold intact.
- The owner quick-test stays capped at 65 cents. The normal receipt retains its separate existing 430-cent cap and 600-second profile.
- Non-null `customer_price_micros` is rejected, avoiding a silent charge override by the fractional-billing wrapper.
- Settlement passes the reviewed manifest and stable evidence reference through the existing complete-cost/credit ledger. Replays must be identical and do not debit twice.
- Existing margin checks and budget-overrun shutdown remain in force. No rates, caps, budget values, activations, or paused flags are relaxed.
- Terminal receipts and reviews remain immutable. The bridge takes budget then operation locks, and no configuration/receipt lock, so it does not reverse admission's configuration-before-budget lock order.
- A timed-out or malformed settlement response is reported as unconfirmed (`settled:null`), not as a successful settlement or an assured remaining hold. Retry the same evidence; do not issue a compensating refund.
- Previously reviewed settlement is read back from the ledger before provider credential checks or access, so retries do not depend on mutable provider metadata or availability. Full provider-payload SHA-256 hashes are otherwise intentionally conservative: a provider receipt change after review causes a hold. No automatic reapproval. Future canonical projection/hash changes require separate review.

## Exact live approval scope

1. Apply `config/general-reception-settlement.sql` to the existing database after validating the named ledger dependencies. It creates one private RLS table, two private validation/guard functions, two triggers, and one narrowly granted service-only settlement RPC plus one read-only settled-outcome RPC. It changes no existing data and runs no backfill.
2. Publish only the application/test changes and migration/test/docs additions on top of current main. This source snapshot was copied from the general-reception checkout; do not publish the entire copied checkout or overwrite concurrent freemium/diagnostic fixes.
3. After authoritative provider cost readback succeeds, approve the specific call's complete 16-category review with its exact attestation and evidence. Insert that single approved review as the database owner. This is a separate financial-evidence decision; no executable insert with fictional values is included.
4. Invoke the existing owner reconciliation control for that same receipt. It may debit the computed authorized charge (at most the receipt cap), release unused reserved credit atomically, and record the corresponding actual/reviewed cost and evidence. Verify the exact operation, wallet, credit reservation, ledger, and budget afterward.

Permission to deploy a diagnostic does not by itself authorize steps 1, 3 or 4. Do not release the current 65-cent hold before the provider and other cost evidence is complete.

## Validation

- `node --experimental-strip-types tests/general-reception-settlement.test.mjs`
- `node --experimental-strip-types tests/general-reception-reconcile.test.mjs`
- `node scripts/test-reception-settlement-pglite.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js`
- `node scripts/test-all.mjs`
- `./node_modules/.bin/tsc --noEmit --incremental false`

PGlite executes source-extracted real wallet, reserve, claim, complete-cost, margin and settlement functions with synthetic local records. It cannot establish independent PostgreSQL-session contention behavior. Independent read-only production catalog verification matched eight core dependency bodies, required columns/constraints and restricted ACLs. An isolated official PostgreSQL 17.11 server additionally passed four genuine two-session schedules (114 total assertions): duplicate settlement produces one debit, conflicting evidence makes no financial change, and both admission/settlement lock orders finish without deadlock; pg_blocking_pids confirmed actual blocking. The server was stopped afterward. Full live provider costs and real post-settlement verification remain required before claiming live repair.

Reference checks: Supabase database-function guidance requires narrow function grants and empty search paths for security-definer functions (https://supabase.com/docs/guides/database/functions). Current changelog review found no relevant breaking change to this JSONB/row-lock/trigger implementation (https://supabase.com/changelog). Production diagnostic readback established numeric ElevenLabs USD cost with 18 fractional digits. The known USD numeric value is normalized with decimal half-up rounding to the nearest integer micro, including exponent notation, with an explicit `elevenLabsUsdRounding` evidence label. The original provider-payload hash is preserved. ElevenLabs defines this field as USD (https://elevenlabs.io/docs/changelog/2026/7/6); Twilio documents delayed price availability (https://www.twilio.com/docs/voice/api/call-resource). Null Twilio prices, unknown units, credits, and nonnumeric ElevenLabs values remain unavailable; this does not establish a complete provider subtotal.

## What is still needed for routine customer operation

This bridge deliberately requires a separate immutable review for every receipt. It is a bounded repair mechanism, not the complete unattended product.

Next, design a versioned reception usage policy that is reviewed once for an exact profile/rate/effective interval and applied automatically to newly completed, exactly bound receipts. Reuse this bridge's original reservation, quote ceiling, snapshotted multipliers, atomic ledger, and exact-once protections. Add an authenticated completion-triggered collector and durable fair retry queue for late provider costs; do not depend on the owner's latest-receipt button, which cannot service a customer backlog. Price-shape diagnosis must establish the provider's actual USD field and units before changing the parser. Provider credit units must never be guessed to be dollars.

Required decisions and evidence before that rollout:

- Verified actual Twilio and inclusive ElevenLabs USD costs for the exact call, with canonical provider provenance and defined receipt stability. If a supplier requires duration-based estimates, that is a separately reviewed policy change; this bridge currently requires actual verified provider receipts.
- Explicit approved per-usage allocation amounts/formulas, evidence, and validity windows for GitHub, Vercel, Railway, Supabase, payments, acquisition, support/overhead, and refund/dispute reserve. A planning-rate entry alone is not that approval.
- Evidence that DealMachine, messaging, email, title/signing, and other are not applicable or included for this reception operation. Inclusive ElevenLabs evidence justifies the separate LLM category at zero. Avoid charging subscription usage again through another allocation.
- Preserve all 16 categories. Any estimated component makes the overall settlement estimated; it does not become verified because the two provider amounts are verified. The customer needs the corresponding price disclosure and authorized original cap.
- A policy for late/missing costs, revoked or expired policies, above-cap usage, disputed receipts, and reversals. Holds stay intact pending evidence; do not reset a reservation to permit another call. Reversals or adjustments require their own reviewed ledger path.
- Staging multi-session duplicate-worker/concurrency tests, retry after committed-but-timed-out writes, tenant isolation, backlog progress, and a genuine end-to-end completed-call/ledger readback before unattended release.
