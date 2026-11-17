# Automatic data-credit waits

The November 17 investigation found one original owner export with a completed
HTTP 402 `export_limit_exceeded` response and explicit zero monthly and additional
data credits. It had no export ID. The original-ID recovery correctly excluded
it, but no existing capacity-source family recognized that response. Its global
export slot consequently remained occupied. Ordinary property searches also
continued receiving credit refusals because API request limits and data-credit
balances were treated as the same availability signal.

The original response's `usage.credits_used` is a billing-period total. It is not
the charge for that request. Neither that value, the configured allowance, nor an
idle inventory permits settlement of the original operation.

## Two independent conditions

A source-bound private credit wait stops new paid data requests after an exact
finished credit refusal. Free metadata, estimates and original receipt work stay
within their existing separate admission rules. Maintenance claims at most one
authenticated, quota-admitted `GET /v1/usage` per fifteen-minute interval. This
detects an early refill without waiting blindly for the reported cycle end.
It does not buy credits or modify the provider plan.

The check retains the original bounded body and freshness headers. A positive
balance may clear only the matching credit-wait generation. A newer refusal,
malformed or stale response, or an unconfirmed request keeps the wait intact.
The usage request never records cumulative `credits.used` as its own charge.
Lost acknowledgments may repeat only identical evidence writes, never the GET.

Organization export capacity still needs the existing separately admitted
inventory, pending and processing proofs. The new source family preserves the
original request and response binding and every existing freshness, pagination,
terminal-inventory, owner-exclusion and financial guard. It cannot create an
export ID, mark the original terminal/completed, release money or replay it.
Replenished credit and verified idle capacity allow later ordinary work to
recompute current account, contact, financial and provider eligibility.

The authenticated maintenance result reports `provider_credit_exhausted`,
`provider_credit_available`, or an explicit check failure/hold. Provider credit
exhaustion is separate from a failed maintenance process or customer Pause.

## Release and verification

The source-pinned database prerequisite is installed and remains disabled, as
recorded below. Release matching web and worker code through the usual
exact-head/main checks. Activate the new policy
with `icash_research_private.activate_dealmachine_credit_wait(exact_main_sha)`
only after the matching hosts are verified. The prerequisite is
`supabase/migrations/20261117191836_provider_credit_wait.sql`; its source is
`config/provider-credit-wait.sql`. No historical receipt is rewritten
and no paid provider demonstration is required.

Offline tests cover the exact refusal and its negative variants, immutable
request binding, stale-positive/newer-refusal ordering, bounded claims, free
checks, and source/privilege drift. Service tests run actual request and
maintenance code with mock transport, including early refill, unknown responses,
body limits and lost acknowledgments. Production verification uses ordinary
saved evidence; a cleared capacity wait is not proof of a delivered contact or
universal account recovery.

Run the transport suite with
`node --experimental-strip-types tests/dealmachine-credit-wait.test.mjs` and
the PGlite suite with
`node --experimental-strip-types tests/provider-credit-wait-db.test.mjs`.
The explicit native entry point is `scripts/test-provider-credit-postgres.mjs`;
it requires a fresh disposable PostgreSQL 17 fixture named `icash_reliability`
at `127.0.0.1:55451`, with the fixed fixture-only credentials in the test. It
does not read a hosted connection string. The canonical reliability workflow
runs it in `outreach-preparation-contention` against a separate fixture service.
Native checks cover sixteen parallel
usage claims, sixteen blocked paid admissions, and both serialization orders
of a positive balance racing a newer refusal. They also verify that idle or
contended maintenance never waits on the shared request-budget lock.

Provider references: [Credits](https://api.docs.dealmachine.com/concepts/credits)
describes the live usage balance, request-credit distinction and per-response
`credits.used`; [API quickstart](https://dealmachine.com/guides/api-quickstart)
documents HTTP 402 and `export_limit_exceeded`. The response and source checks
remain authoritative for the specific request; general documentation does not
authorize a zero-cost settlement.

## Verified installation — November 17, 2026

The corrected source head `9f9b0ee0c4e223087db7496fa793b624ed94d87c` passed
all seven canonical jobs in run `44154406866`. The prerequisite was installed
once, disabled, as `20261117191836_provider_credit_wait`. Its migration and
`config/provider-credit-wait.sql` are byte-for-byte identical. The single hosted
ledger entry records SQL MD5 `8cd3ceb416bc60bffe7bd0664f89d429`; SQL SHA-256 is
`e59191c64b6f1b0e52ae47f217a26490e0c4496ac2fabe71b12ef803204c6608`.

The read-only pre-install verification at 19:18:31 UTC passed all twelve checks.
The post-install verification at 19:18:41 UTC passed all twenty checks, including
the twenty-one function definitions and security metadata, the exact twenty-entry
manifest, and the disabled policy. One source-bound original seeded the credit
wait; the free-check count remained zero, the original hold and cost were
preserved, and no duplicate installation was found.

Do not replay this prerequisite. Installation does not authorize activation or
prove restored customer work. PR817 carries this change together with PR816's
contact-source gate after the separate core PR803 release. Require fresh checks
for the combined follow-on, then the matching exact-main web and worker releases
before the single policy activation described above. Keep the original unknown
operation and all final admission checks intact.
