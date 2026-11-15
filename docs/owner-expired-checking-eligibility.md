# CHECKING eligibility performance

The native PostgreSQL 17.6 release test reproduced a stalled selector: 1,000
active CHECKING sources with valid original denial/baseline evidence but an
insufficient original quote took 5,519.8 ms to reach the later eligible original.
That exceeded the existing 3,000 ms gate. Their rate/cap rejection occurred only
after each expensive request-history proof.

`20261115150210_owner_expired_checking_eligibility.sql` moves that exact existing
current config/rate lookup and rejection earlier in
`icash_research_private.expired_preflight_ticket_current(uuid,uuid)`. It leaves
the initial ticket `FOUND` check immediately after the ticket lookup and keeps
the waiting delegation first. No eligibility predicate changes. Accepted
CHECKING sources still require the unchanged original-request proof, cleanup
evidence, source hash, recovery and continuation exclusions. The STABLE wrapper
uses the same calling-statement snapshot; existing locked rechecks remain.

The guarded upgrade requires the exact predecessor wrapper, owner, execution
privileges, volatility and search path, plus both full function/trigger
manifests. It takes the existing budget lock before policy locks and changes
only the wrapper key in each manifest. Enabled flags, release/activation
receipts, counters, original requests, journals and financial records remain
unchanged. It supports both the pristine disabled predecessor and an already
activated policy; it never activates or reactivates either. In this release,
apply it fourth after the deadline, continued-owner scheduler and wait-admission
migrations. The normal migration runner owns its transaction and ledger receipt.

| Evidence | Result |
| --- | --- |
| Predecessor function MD5 | `0f0026b490932675588ecb802740b142` |
| Updated function MD5, PGlite and native PostgreSQL | `d4d626dd408cbf8264a95a5b86bc4d9c` |
| Native 17.6 before, 1,000 active cap rejections | 5,519.8 ms; failed unchanged 3,000 ms ceiling |
| Native 17.6 after, same scenario and eligible target | 283.1 ms; passed unchanged 3,000 ms ceiling |

The shared PGlite/native rehearsal compares old/new eligibility for valid
CHECKING and waiting sources, null/equal/higher/lower/zero/negative original
quotes, missing config/rate, unknown extra eligible requests, Pause, expired
deadlines, changed source hashes and missing tickets. A fixture-only erroring
proof confirms rejected caps short-circuit while eligible CHECKING sources still
require the proof. Current rates remain subject to their original positive-value
database constraint.

Tests also cover complete migration-ledger rollback, source/manifest/trigger/ACL
drift rejection, exact activation/history/financial preservation, and a late
restrictive cap that wins the budget lock. Native testing retains the original
three-stage installation/activation races, 12 repair and cleanup claimants,
quota-before-attempt behavior, late Pause, unknown receipts, cleanup and durable
rollback fences. No provider operation or production mutation is part of these
fixtures. These timings establish the reproduced case, not a guarantee that
every account or provider workflow has completed.

Run `node tests/owner-expired-checking-eligibility.test.mjs` and the existing
disposable-native `scripts/test-owner-expired-checking-postgres.mjs` harness.
