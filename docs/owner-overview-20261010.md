# Owner overview

The platform owner opens **Admin** from the workspace to see a single overview at `/admin`. The page reads `/api/admin/overview`, which verifies the current authenticated user before calling the service-only `icash_owner_overview` reporting function. No accounting, contact, or automation writes occur in this flow.

## Display

- Today, 7 days, or 30 days, using Central calendar days through the report timestamp.
- Unique inbound seller submissions, including the number needing review.
- Usage charged, recorded usage costs, and usage margin.
- Searchable, paginated seller leads with expandable contact and assignment details.
- Owner usage excluded by default, with an explicit switch to include it. This switch does not filter inbound leads.
- Estimates and missing cost records remain visible. The overview does not call an incomplete margin zero or a verified profit.

## Accounting boundary

The revenue-side metric is **posted usage charges from work credits**, less platform-covered overruns, for operations settled in the selected period. It does not count credit purchases or unused credits as earnings. Fractional customer prices are not counted again before their cents post. Promotional credits may fund posted usage, so this is a usage margin report, not cash receipts or a withdrawable balance.

Costs use the recorded operation cost and its explicit verified/estimated classification. Missing or unreconciled costs suppress the cost total and margin; the known portion is shown separately. Dispatched operations awaiting settlement are counted separately. Estimates remain labelled. Subscriptions, assignment proceeds, and standalone advertising costs are outside this report.

The owner account is opt-in. Accounts with paid test-mode funding and no paid live-mode funding are excluded. Untagged legacy records cannot be conclusively classified as simulations; the report does not guess from names or amounts.

## Privacy and resilience

Authorization uses the established owner user ID, not browser-supplied IDs or editable user metadata. API responses are private/no-store. The SQL function is a security invoker, uses an empty search path, and grants execution only to the service role. A second actor check lives in SQL. It exposes a limited lead projection, not raw provider payloads, tokens, or contract prices.

Reads are bounded and do not overlap. Filter changes abort and invalidate earlier reads. A failed refresh keeps a labelled previous view only for the same filters. Losing authorization erases private rows and stops automatic requests. Marketing measurement does not initialize on the admin route.

## Verification

- Seven local Postgres scenarios: charges/coverage/fractions; owner and test exclusion; DST/date boundaries; unknown costs, unknown charges and negative margins; literal search/deduplication/pagination; SQL grants and actor validation; empty periods.
- API checks: no authorization bypass via metadata or query inputs, safe filters, private caching, complete response validation, provider failure handling and 12-hour Central timestamps.
- Five UI scenarios: filter races, failed refresh/retry, loss of authorization, stalled reads without duplicate requests, and malformed responses.
- Existing workspace request-recovery and paid-provider-stop suites pass; TypeScript passes.
- Production migration readback confirms the expected service-only grants and successful customer/owner-scope reports.
- Local Turbopack build is blocked by this workspace's external `node_modules` symlink. The Vercel build is the deployment gate.

All scenarios use local fixtures. No paid provider simulations, calls, messages, purchases, or billing changes are part of verification.
