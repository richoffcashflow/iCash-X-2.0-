# One-owner active-phone export diagnostic (candidate, not enabled)

The consumed v3 build hook is retired. V4 is not a build hook and has no default
approval. This patch performs no provider purchase, approval, production change
or release of any existing hold.

## Atomic admission

The separately reviewed SQL candidate `config/owner-export-diagnostic-slot.sql`
claims the exact saved approval and a diagnostic slot under production's shared
organization advisory lock. Any unfinished production export blocks the claim
before even a free provider request. A reciprocal BEFORE INSERT trigger prevents
production exports while the diagnostic is held, rolling back its admission
transaction. Production wallet-reserving owner-batch admission is not reused.

The diagnostic slot is immutable with **no release API**, including after a
successful response or pre-POST failure. Future release requires separately
reviewed original-outcome reconciliation. Do not drop the protection as rollback
while an outcome is unresolved. Stop execution by leaving the manual runner
uninvoked, retaining all existing receipts and holds.

## Live prerequisites (not satisfied by publication)

- Verified terminal/outcome evidence for the original unknown production export;
  age, empty provider history and another owner's success do not qualify.
- Separate SQL review and installation; no migration is applied by this patch.
- Fresh exact saved owner, property, account, screening, source operation and
  timestamp, request hash and reviewed commit; one-hour maximum approval.
- One owner, nonpremium people-only output, limit one, active-phone and DNC
  filtering; no customer wallet, calls/texts, paid retries or above-quota access.
- Exact branch/repository/project/preview gates and fresh shared/provider quota.

The one-credit bound is structural (one person and fixed nonpremium fields), not
a provider-enforced monetary ceiling. Verify current pricing before execution;
post-request credit checks cannot retroactively enforce a cap. At most four
quota-accounted API requests and one export POST. Unknown claim or provider
acknowledgments stop without retry. Artifact inspection only downloads an
original saved export's approved artifact; it cannot create another export.

## Tests and recovery

Runner tests inject DB/transport only. PGlite tests cover both admission orders,
exact CAS/cap/source/expiry guards, one-use claims, immutable holds and service
ACLs without wallet writes. PGlite serializes requests; isolated real PostgreSQL
multi-session contention verification remains required before live execution.

This change was rebuilt after the previous unpublished local checkout and patch
were lost during workspace replacement. Its new commit must not be identified
as the old a1afc89 artifact; verification is rerun against the rebuilt files.
