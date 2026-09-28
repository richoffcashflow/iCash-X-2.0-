# Supabase operating foundation

Project: ofjbbpwugyjfxbhqfguh (icash-x), us-east-1.
API URL: https://ofjbbpwugyjfxbhqfguh.supabase.co

## Implemented and verified in the database
- Auth-user-linked account with persistent per-account assistant name; idempotent server provisioning creates wallet and notification preferences. Name pool is not globally unique.
- Tenant-scoped deals, conversations, messages, callbacks and source-backed activity.
- Composite foreign keys prevent mixing records between accounts or properties.
- Authenticated users have read-only access to their own rows; anonymous clients have no table access.
- Service-role-only RPCs for credit posting, reservation and settlement, with wallet row locks and stable operation keys.
- Integer USD cents for customer credits; separate precise provider-cost ledger.
- Duplicate funding/settlement protection, rolling 24-hour spending caps, pause checks at reservation, no spending below reserved balance, no charge above a reservation.
- Append-only credit ledger; refunds use compensating entries.
- Configurable credit packs, all disabled until payments are integrated.
- Internal decision, outcome and economics records, separate from customer data.
- Disabled-by-default deal and retention recommendation engines. These return recommendations; they do not call providers.
- Deal rule protects signed contracts, deadlines and callbacks, respects available balance and daily budget, and applies an admin-set minimum gross margin. Missing margin defaults to 100%, blocking normal work until configured. Prospecting yields to contracts with pending work due within 48 hours.
- Retention rule prioritizes Needs You, respects pause and in-app preferences, requires verified queued work and insufficient balance, suppresses prompts when budget/margin would still block work, and enforces at least 24 hours between recorded funding prompts.
- Internal economics view separates purchased credits, refunds, consumed credits, provider costs, usage contribution, contracts and confirmed closings. This is not GAAP revenue recognition or a complete CAC/LTV forecast.

## Verification
SQL scripts in supabase/tests run inside transactions and roll back all fixtures. Passed funding idempotency, conflicting retries, overspend prevention, over-reservation settlement rejection, unused reservation release, tenant isolation, blocked customer credit mutation, idempotent provisioning, paused/disabled engines, contract priority and prompt cooldown. Simultaneous multi-connection stress testing is not yet performed. Security advisor reported no warning/error findings; INFO-only missing-policy notices on deliberately server-only private tables. Performance INFO notices are unused indexes in the new empty database.

## Integration still required
The app is still a demo. The execution workspace was unavailable during this database work. No app environment variables, checkout, auth UI or worker connection were changed.
1. Configure SUPABASE_URL and server-only SUPABASE_SECRET_KEY in Vercel/Railway secure settings. Never put service credentials in NEXT_PUBLIC variables or GitHub.
2. Configure public URL/publishable key for Auth. Verify the authenticated user on the server. Call icash_create_account with that verified identity, never a browser-supplied user ID.
3. Verify payment signatures, successful status, amount/currency, account ownership and payment object ID before icash_post_credit. Evidence text alone is not verification. Bind idempotency to the payment object, not each webhook delivery.
4. Validate authorization, suppression, contact hours and freshness; claim a canonical-contact lease and operation atomically; reserve credits before dispatch. Recheck pause/human takeover immediately before sending. A reservation is not a dispatch lease.
5. Use icash_finish_credit after reconciling provider status. Do not auto-release ambiguous in-flight reservations: uncertain sends must be reconciled first. Charge cannot exceed reserved amount; reserve worst-case cost and cap provider execution accordingly.
6. Persist actual provider invoices/events to provider_costs and actual events to activity/outcome tables. No simulated events in live rows.
7. Durably queue callbacks, verify time zones, and implement signed contracts/title evidence before changing stages. Text evidence columns do not validate documents.
8. Engine functions currently return recommendations only. A worker must atomically deduplicate/claim, log decisions and commit prompt timestamps before display/delivery. Preference fields do not send messages. No cross-customer contact lease or notification delivery is implemented.
9. Outcome learning needs enough measured outcomes and offline evaluation/holdouts before changing ranking. Do not claim automatic training or highest LTV from these initial rules. Minimize aggregate data and exclude identifiable seller transcripts.
10. Payment packs and engines remain disabled until these integrations pass end-to-end tests.

## Growth objective
Optimize retained customer value and contribution margin, not credit depletion. Track activation, useful engagement, verified milestones, credit purchases/reloads, usage cost, refunds, complaints, D1/D7/D30 retention, contracts and confirmed closings. Compare experiments on sustained gross profit with customer outcomes and complaint rates as guardrails. Do not use fake urgency, fake deal progress, automatic consent or unapproved reloads.
