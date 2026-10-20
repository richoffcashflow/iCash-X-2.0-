# Seller details and outreach visibility

Newer property research could push saved owner details and actual outreach beyond the first page. The default eligible-leads view also hid contacted records after 24 hours. Support checked setup and credit without verifying contact or communication records, so it could incorrectly tell a customer to wait and close an unresolved report.

This change ranks signed work and real seller responses first, followed by actual outreach, saved owner details and newer research. Contacted eligible properties remain visible after the research freshness window. Tenant scope, search, opt-outs, manual controls and explicit response filters remain in force.

Research scheduling, held-ticket resumption and final spending admission give existing first-contact work priority. Research must leave enough capacity for the existing minimum first-call quote, with owner lookup capacity also required for new discovery. This leaves capacity unspent; it does not debit, grant or reserve wallet credits. Existing contact, calling-hour, channel, membership, provider and spending checks still govern dispatch. Unknown provider outcomes remain held.

Support reads account-bound aggregate contact, text-receipt, reply and call data. It distinguishes researched prospects from incoming requests, explains budget holds and keeps the original complaint open through short follow-ups. A passing readiness check is never evidence that outreach started or that the customer can see the records. Bot status and the workspace assistant use the same budget status.

Deployment follows `config/restore-fifty-percent-prospecting.sql` from the preceding release. `config/seller-work-progress.sql` matches its forward migration and checks existing function hashes before replacing them. It preserves the restored 50% policy, VIP pricing, balances, funding snapshots and historical usage. It sends no messages or calls and does not rewrite support history.

Local regression coverage uses PGlite and synthetic records for pagination, older contacts, real responses, tenant isolation, scheduler and retry priority, final admission, minimum call capacity, immutable balances and unknown holds. Support and route fixtures cover verified receipts, missing evidence, pause, repeated questions, unresolved complaints, authentication and account binding. No paid provider tests are used.
