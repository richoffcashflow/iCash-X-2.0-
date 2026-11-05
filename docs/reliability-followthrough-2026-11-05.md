# Reliability follow-through — November 5

The current worker and website are verified on main `3e56939e87ec1eb63e127e2c6e9966494a834204` after PRs #583, #586 and #587. All six canonical main-push checks passed. Railway deployment `ad93c6e5-d11f-4342-8835-293f0e758899` is SUCCESS; the live website resolves to READY deployment `dpl_9VgCXHpo2q8QrHVpSz6sD8LPs7cU` on the same commit.

At 16:30 UTC, the preceding thirty minutes contained 244 completed seller-opener tickets with provider acceptance, 93 completed call-start tickets, and 34 saved conversation results. These are separate stages, not delivered texts, unique interested sellers or signed contracts. No paid development tests were run. The 16:31 monitor still flagged seven accounts without completed work and 87 accounts with old pending operations. No unexpected customer pauses or expired configurations were flagged. These findings do not establish uninterrupted work on every account.

Ordinary research capacity was exhausted: 8,847 of 9,800 local requests had been counted, leaving 953 protected starter requests. The recorded next local window is November 5 at 6:13 PM Central (November 6 00:13 UTC). Provider allowance differs from the local ledger; neither counter was changed. The earlier idle-seller quota repair prevents new idle admission consumption but does not rewrite earlier counted requests.

## Confirmed reporting failure

Production logs show repeated `icash_owner_outreach_report` timeouts. A read-only EXPLAIN of the real Today query took 14.32 seconds, beyond the report's existing 12-second deadline. The report read 50,727 screening rows and 18,082 call rows. Repeated extraction from stored JSON documents accounted for substantial time and buffer reads. The interest helper also repeated the exact call-disposition scan already materialized by the report.

`config/owner-outreach-decoded-projection.sql` decodes each screening document into typed fields and retains the original source, test-account, practice, property and date predicates. In particular, an explicit JSON-null seller request remains excluded exactly as before. Non-object or malformed field shapes retain their original results.

The original interest scan becomes one shared private parser. The canonical public helper still checks the actual complete disposition before calling it. The report may call the parser only after its existing materialized same-result disposition and opt-out checks. There is no caller-supplied override, new contact authority, classifier change or copy of the parsing rules to maintain. Public function identity, volatility, invoker security, search path, deadline and ACLs are retained; the parser is service-only in the existing private schema.

The migration checks all three full predecessor definitions and every replacement before updating functions in one transaction. It changes no customer/provider records, balances, holds, queues, limits, routing or historical evidence. The existing 12-second deadline is unchanged. It creates no index or table and requires no blocking table build or historical migration replay.

## Validation and release

The actual report fixture compares complete before/after results across owner inclusion, all periods/statuses, pagination, literal searches, old holds, delivery dates, tenant/source mismatches, explicit JSON-null requests and malformed document shapes. Canonical interest equivalence covers natural affirmations, refusals, wrong-owner answers, automation, opt-outs, ambiguous questions and malformed transcripts. Instrumentation of the unchanged real classifier verifies elimination of its duplicate call. Private permissions, read-only service execution, predecessor drift, transaction rollback and repeat-install refusal are checked.

Publish only after the exact candidate's canonical Reliability checks pass. Install the guarded function-only migration, record its actual ledger version and exact statements, and verify the installed function bodies and permissions. Keep ordinary production receipt observations separate from the report benchmark. A faster report cannot settle unknown provider charges or manufacture work progress.

For rollback, inspect current definitions first and restore only the exact saved report and canonical interest definitions from `tests/fixtures/owner-outreach-projection-before.json` in a guarded transaction. The now-unused private parser can remain until separately removed. Do not roll back unrelated source, support, scheduler or voice fixes.

The targeting report's separate timeout and original unresolved provider receipts remain open. Do not label the product gap-free from deployment success or the improving outreach count alone.
