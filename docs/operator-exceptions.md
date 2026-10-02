# Read-only owner operations review

This extends the existing support desk at `/support/admin`; it does not add a second support system or execute recovery actions. The server route is `/api/support/admin/operations`.

## Scope and default

`ICASH_OPERATOR_EXCEPTIONS_ENABLED` must equal `true` before any exception-source reads occur. It is absent/default-off in this change. Existing support conversations and cancellation handling are unchanged. Deployment/flag activation is separate from this local implementation.

The route requires the existing, explicitly provisioned `support` operator scope. That scope is platform-wide in the current support model; it is not inferred from a customer email, metadata, or account ownership. Expired/revoked operators are denied before queries and rechecked after the scan. No operator is provisioned and no access grant, schema, policy, credential, or environment variable is changed. A future per-account operator assignment feature needs a separately designed authorization model; this panel does not pretend such assignments already exist.

Every displayed record must bind a valid existing account. Failed account verification hides all affected results. No account impersonation, customer-workspace links, raw message text, recipients, payloads, signatures, provider error strings or arbitrary URLs are returned. Cost operation identifiers are hashed with SHA-256; authorized backend investigation can correlate that digest with the original key without exposing opaque key content in the browser.

## Recorded checks

- Live daily plans marked `payment_failed` or `stop_requested`; test plans excluded
- Reserved/dispatched operations older than 24 hours and settled costs still `estimated`/`unreconciled`
- Outgoing texts and deal emails needing review; stale dispatches and recorded delivery problems
- Held/stale call jobs and call results explicitly marked for review
- Property checks explicitly marked `failed`
- Title reply/date review, follow-up email review, and confirmed title deadlines due within two calendar days or overdue
- Customer-alert records needing review or suppressed/bounced/failed delivery
- Existing support conversations explicitly escalated

Fifteen minutes is a diagnostic stale-dispatch threshold, not proof of failure or permission to retry. Twenty-four hours is a diagnostic held-cost threshold, not an automatic release deadline. A settled customer charge or estimated cost is never described as an actual supplier invoice. Suggested title dates stay unconfirmed. Confirmed title dates follow the existing America/Chicago date-only policy; no holiday-calendar behavior is added.

Each source returns at most 20 records plus one sentinel, oldest recorded time first. Select a category to page; pages are live offset-based reads, not a stable export or global total. The maximum page index is 1000 and Next stops there. Source failures remain visibly unknown, never a healthy empty array. There are at most three concurrent source reads and a ten-second overall deadline. Only explicit opening/refresh/paging runs a scan; no polling, provider calls, billable operations or new notifications occur.

## Safety and recovery

The route exports only GET and uses only database GET requests. It cannot claim work, resend a message, redial, release reserved credits, settle costs, stop/start a plan, change a deadline, dismiss an exception or mark a deal complete. Its next-step text directs investigation of original receipts. Recovery still requires the existing workflow and appropriate authorization.

The browser removes old results immediately when closing, changing category/page, or refreshing, and aborts superseded requests. A stale response cannot restore a previous view. After a request failure, category/previous/first-page controls remain available.

## Verification and rollout

Focused tests cover metadata minimization, fresh vs stale dispatch, no false failed/closed/paid claims, Chicago calendar boundaries, suggested vs confirmed dates, test/live separation, bounded concurrency/paging, failed account binding, partial/unavailable sources, role checks and post-read revocation, default-off/no-store/GET-only behavior, and stale browser responses.

Before enabling: verify the required deployed table columns and support membership, then inspect the authenticated owner panel against real records. This is a diagnostic view, not proof the whole business works unattended. Provider integration health, missing jobs, worker uptime, quarantined inbound mail, invoice imports and safe automatic repair remain outside this bounded panel.

## Local acceptance evidence (2026-10-02)

All 118 suites and TypeScript pass. The first production Webpack build passed; the final rerun compiled and passed TypeScript but was resource-killed while collecting pages with eight workers. The final one-worker retry (`CIRCLE_NODE_TOTAL=2 NODE_OPTIONS=--max-old-space-size=640 next build --webpack`) passed including page generation. No repository or production configuration was changed. Independent read-only review signed off after correcting generic title-deadline labels and maximum-page/error recovery. A read-only information_schema query against the existing icash-x project confirmed all selected columns in the 11 source/account tables. No provider request or mutation occurred.

Actual-component synthetic SSR presentation and stale-response tests pass. Pixel/browser verification is blocked: the cloud browser rejected local loopback with ERR_BLOCKED_BY_CLIENT. No bypass or publication was attempted. An authenticated deployed preview visual check is still required before enabling this panel; synthetic tests do not prove the live owner UI.

The final schema-grounding cleanup restricts property-check queries to the actual `failed` state. All 118 suites, a nonincremental TypeScript check, and a one-worker Webpack production build were rerun serially afterward and passed against the frozen source. A local built-route HTTP smoke could not start because the sandbox denies Next network-interface enumeration (`uv_interface_addresses`); no bypass was attempted and no runtime-HTTP result is claimed.
