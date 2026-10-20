# Owner enrichment: local preview deferral

## Scope

This change retries only a definite rejection by the local DealMachine request
limiter before the free-preview HTTP request. The TypeScript service throws a
scope-bound `OwnerPreviewRateLimitError` only for the literal database result
`false`. The automation route verifies its account, screening and operation key,
then asks the database to park the exact consumed capability atomically.

HTTP failures, timeouts, invalid receipts, unknown limiter results, prior
reservations and all paid-stage failures remain reconciliation holds. Matching
an error string is never a retry grant. Retries keep the original
`owners:<account>:<screening>` operation identity and receive a new one-use token.

Retry bookkeeping is separate from the legacy three-issuance counter. Backoff,
expiry, evidence pinning and the existing account/property/source/duplicate,
manual-control, membership, wallet, prospecting and paid-claim gates remain
server-owned. Waiting does not reserve credits, buy contacts, enable a config,
remove Pause or raise a budget. The migration itself repairs no historical ticket.

## Deployment order

1. Review and apply `supabase/migrations/20261020012200_owner_enrichment_deferral.sql`
   through the normal migration process. It verifies exact predecessor function
   hooks and rolls back if they differ. Do not manually replace a failed hook with
   an approximate query. The identical config file is for review/test fixtures.
2. Verify the functions, restricted privileges, immutable recovery audit table,
   cap triggers and scheduler hook are present. Deploy the matching application
   code. Never test the change by making a paid provider request.
3. Freshly inspect only the specifically approved historical tickets. Keep their
   private identities, original evidence and approval records outside the source
   repository, issue body and public logs. A generic reconciliation outcome alone
   does not prove that a ticket stopped before transport.
4. For an explicitly reviewed ticket, verify a unique exact production warning at
   the local `free_preview` / `PROVIDER_RATE_LIMIT` stage with no HTTP status and
   correlate it to the original request and completion. Any ambiguity, paid-stage
   evidence, prior operation/reservation, partial receipt, saved contact or changed
   screening must block recovery.
5. Compute hashes in SQL with
   `icash_owner_enrichment_ticket_hash(ticket_row)` and
   `icash_owner_enrichment_screening_hash(screening_row)` immediately before
   recovery. The screening hash covers the full row, including result and
   completion, not only its snapshot. The ticket hash excludes the newly added
   `owner_preview_*` bookkeeping columns. Do not print capability tokens.
6. Invoke the privileged `icash_recover_owner_enrichment` RPC separately for each
   approved original operation, passing the exact ticket/account/screening/operation,
   both expected hashes, a private reviewed source reference and its SHA-256,
   `p_code_stage = owner_preview_pre_provider_local_rate_limit_v1`, and the approved
   per-operation maximum customer charge in integer cents. The private reference
   should link both the reviewed production evidence and the owner's authorization.
   Re-read a failed or uncertain result; never broaden the selection or substitute
   an error-message pattern. Re-running a completed recovery is a safe no-op and
   cannot extend a deadline, rotate a token, change the evidence or raise the cap.
7. Verify the exact approved set has audit rows and the intended held/retry state;
   compare all excluded tickets to their baseline. Allow only the existing
   scheduler to resume them as current limits permit. Verify outcomes from saved
   operation/provider receipts, not from queue changes. Do not dispatch a test,
   edit balances, enable configs, clear Pause, extend stale snapshots or force a
   reservation to accelerate recovery.

The approved per-operation charge bound is durable and applies before credit
reservation, when operation spend changes, and at final paid claim. A later rate
increase does not enlarge the approval. Actual receipt-backed settlement remains
the only basis for charging completed usage.

## Local verification

- `node --experimental-strip-types tests/owner-enrichment-service.test.mjs`
- `node --experimental-strip-types tests/owner-enrichment-deferral.test.mjs`
- `node --experimental-strip-types tests/owner-enrichment-deferral-sql.test.mjs`
- `pnpm test`, `pnpm exec tsc --noEmit`, `pnpm test:release`, `pnpm build`

Tests use local fixtures and no provider traffic. PGlite verifies SQL behavior but
serializes execution; it is not proof of real PostgreSQL multi-session lock
interleavings. Review lock order and test those interleavings on an isolated native
PostgreSQL instance before claiming concurrency validation.
