# Current-schema outcome evidence report

GET `/api/work/learning` authenticates through `workAccount`, scopes every read to that account, returns private/no-store aggregate JSON, and performs no writes, dispatch, provider calls, strategy changes, or promotion. The report is observation-only, not a trained model or a daily improvement guarantee. It is an API report; no new dashboard UI or scheduled job is included.

The versioned report reads the current `icash_live_conversations`, `icash_deal_files`, `icash_operation_spend`, and `icash_signing_envelopes` records. Call operation IDs deduplicate records; conflicting duplicates fail. Calls must bind to the same account's non-practice deal screening and a dispatched/settled operation with dispatch time. Missing or excluded bindings are counted separately. A completed conversation record is not proof of connection, qualification or a sale. No model analysis, transcripts, contact details, or raw provider evidence are returned.

Signed purchase and assignment totals count distinct current non-practice deal IDs only after the persisted live provider document passes the existing envelope/terms-hash/recipient/order/signature verification. They are separate totals, not attributed to call strategies and not conversion rates. Closed deals remain null because this report does not ingest verified title/closing evidence. No verbal yes, draft, sent document, or test signing counts as a completed contract.

Call costs come from the bound settled operation with amount, settlement evidence, timestamp and explicit cost basis. Verified and estimated costs remain separate. Unresolved costs remain a count, never an implied zero-cost operation. These are call-operation costs only, not complete acquisition or closing costs. Cost per closing and improvement scores are intentionally absent.

Reads use stable keyset pagination, 200 rows per page and a maximum of five pages per source. Reaching the cap marks the result incomplete and counts partial. Reads are not a transactional database snapshot; `asOf` is the report time, not a guarantee of cross-table snapshot consistency. No data is cached. Account checks repeat in the aggregator and loader; cross-tenant rows fail closed.

## Remaining ingestion gap

At the October 7 audit, the legacy `icash_learning_cohorts(account_id,deal_id)` foreign key references `icash_deals`, whereas current signing references `icash_deal_files` and live calls reference `icash_screening_jobs`. Do not synthesize legacy deal IDs, fabricate historical assignments, or write current IDs through that foreign key.

The next distinct delivery needs a reviewed immutable opportunity identity with account-scoped references to screening/current deal IDs; a strategy/version assignment before exposure; provenance-bound adapters for dispatch receipts, verified responses, signed documents, title-confirmed closings and reconciled provider costs; exact replay idempotency/conflicting replay rejection; and a daily observation report. Initial ambiguous history must stay unassigned. Multi-channel and buyer/seller activities need explicit attribution rules rather than one mutable strategy per deal.

Only after that feed is verified should controlled experiments on opening price, objection response or follow-up timing be proposed. Require comparable mature cohorts, fixed holdouts, adequate sample size, complete costs, opt-out/complaint guardrails, reviewed changes and rollback. Existing spending, offer-ceiling, consent, pause and quiet-hour rules remain authoritative. This release does not promote policies automatically.

## Verification

`tests/deal-learning-report.test.mjs` covers tenant isolation, no writes, authentication before reads, evidence binding, practice/test exclusion, future records, replay deduplication/conflicts, unsigned/mismatched evidence, unknown closing count, estimated/missing costs, bounded pagination, private output and promotion disabled. The normal test runner discovers this test automatically.
