# Skip research ranking when the report cannot use it

A saved production-log entry at `2026-11-17T04:02:06.442Z` records a statement
cancellation in `icash_usage_loop_context`, through enrichment selection and the
opportunity/market scoring chain. The entry does not identify the selected
account's configuration, the complete query cost or a recurring outage. This
repair addresses a separately reproduced unnecessary dependency; it does not
claim to explain or eliminate every opportunity-scoring timeout.

The report previously ranked research candidates before checking whether its
configuration and rate could support a research-work result. The final report
already required an enabled, automatic, contacts-enabled configuration, current
data rights, and an enabled, verified, unexpired owner-enrichment rate. An invalid
configuration could still force the complete selector and ranking chain to run,
only for the report to discard that selected candidate.

The same necessary configuration/rate predicate now runs before selection. The
entire original post-selection validation remains unchanged, including the
selected source, financial eligibility, incomplete/practice exclusion, manual
controls, unresolved handoffs, original operations and cancellation checks.
All other report fields, SMS priority and pricing remain unchanged. A precheck
does not authorize work or replace current final validation. No public UI,
provider settings, selector order, ranker, scoring formula or financial/contact
admission changes.

In a static source snapshot, the old and new complete JSON reports are identical.
The report remains a sequence of read-only observations rather than an atomic
guarantee: a configuration enabled after a negative precheck becomes visible on
the next ordinary read. A configuration or rate invalidated during ranking is
still rejected by the existing post-selection check. No persistent, session or
transaction cache is introduced.

## Evidence

The focused fixture installs the captured current report, all three enrichment
selectors and the actual opportunity, ranker, market and buyer-demand functions.
Unrelated source/gate helpers use explicit synthetic boundaries; all data is
local and fictional. Instrumentation counts entry into the actual scoring chain.
For 30 eligible properties with an invalid configuration/rate, the original
report ranks all 30 before returning no research work. The repair ranks none.
Eligible configurations still rank all 30 using the same selector and result.
This is a deterministic call-count result, not a production timing measurement.

Thirty-four complete-report comparisons cover true/false/NULL configuration
and rate fields, missing/expired/future records, stale and incomplete analyses,
financial rejection, practice data, manual control, unresolved original work,
handoffs, cancellation, account Pause semantics and unchanged SMS/VIP/signature
reporting. The tests compare every returned field, including NULL, and verify no
work/evidence mutation. Source, owner, ACL, metadata and result drift and a
failed migration-ledger write all roll back atomically.

Native PostgreSQL 17.11 adds independent transactions. A synthetic blocked
scoring boundary makes the original invalid-configuration report time out; the
repaired report skips that irrelevant boundary. Eligible configurations retain
the same dependency. Config/rate changes committed during scoring are refused
after selection, and later statements within the same reader transaction see
newly committed controls. This controlled lock test is not evidence that the
saved production cancellation was caused by a lock.

The migration test also starts with wider session timeouts, then verifies its
own two-second scheduler-lock bound and eight-second DO statement bound. A
brief holder through the captured ordinary lane entry permits installation when
released. A sustained holder causes complete rollback, as does a failed ledger
insert after a successful wait. Successful commit records one ledger entry and
releases the transaction lock.

## Release

After review and exact canonical checks, install
`20261117180250_usage_context_research_precheck.sql` through the normal migration
ledger. It requires the captured invoker function, owner, service-only execution
ACL, volatility, parallel setting, strictness, leakproof setting and empty search
path. It changes exactly one entry condition and pins the complete resulting
definition and metadata. Every ordinary automation lane uses transaction lock
`726341927`, so the migration joins that same queue for at most the existing
two-second `lock_timeout`. Its complete DO statement retains the eight-second
`statement_timeout`. A sustained lock or any drift fails closed. Runtime lock
calls, polling cadence and timeouts remain unchanged; this is no unattended
installation retry loop.

The function MD5 changes from `846e7e4dec84578b511ec69f62a23222` to
`fc24c125163489d40d275e0b158b6455`. No policy, table, historical migration,
activation, request receipt or workflow flag changes. Verify the exact installed
source/security metadata and one ledger entry, then the ordinary exact-release
web/worker checks. Observe normal read/progression evidence afterward without
running a production selector or sending paid test work.

## November 17 installation

Installed once as `20261117180250_usage_context_research_precheck` after all seven canonical jobs passed for source head `38861dc2b8f92f648cf3d9ce6c07951c40c9dd23` (run `44019049571`) and a fresh independent source review and focused regression. A preceding lock-timeout attempt rolled back without installing a migration. Readback at `2026-11-17T18:02:57Z` verified the target function hash `fc24c125163489d40d275e0b158b6455` and the installed migration entry. Source and private invoker metadata are pinned by the atomic installer. Do not reinstall or replay this migration. The source filename now matches the hosted ledger version. The repair removes irrelevant ranking work; it does not establish that historical pending work completed.
