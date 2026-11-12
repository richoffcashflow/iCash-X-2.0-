# Deal supervisor

The November 12, 2026 request is for deals to progress end to end with real evidence. The first release gives engaged deals a durable next step across the existing seller, signing, buyer and title workflows. It does not establish a new general intelligence capability or prove a live closing.

## Runtime behavior

The authenticated, existing minute journey cron calls the supervisor before its normal handlers. Production, live-work and live-signing gates apply. A failed supervisor check does not prevent the existing handlers from running; the response reports degraded health.

Private `icash_deal_supervisor` records retain the latest milestone, supported next step, source IDs, compact seller facts, exact signature/closing/proceeds evidence, last local action, check deadline and unchanged-versus-changed revision. They add no customer UI. Cold outgoing openers and practice deals do not create engaged opportunities.

Source changes append wakeup events. One nonblocking runner handles at most 10 overdue records plus 15 newly changed deals per invocation, reading at most 100 event rows. Five-minute checks cover actionable work and one-hour checks cover unchanged waits/holds. Completed/cancelled records retain a daily backstop. Deleting only the exact event IDs seen at selection preserves source transactions that commit later, including lower sequence IDs. Events and periodic checks share bounded capacity so one cannot completely starve the other.

The supervisor can:

- Create one absent reply job for a fresh, receipt-backed seller message whose current conversation and existing progress gates permit it. The source must postdate activation and be less than 24 hours old. It never resets a failed, issued or unknown job, repeats a model call, manufactures ownership, or changes an accepted offer.
- Queue an absent fulfillment job after canonical purchase signature verification and current journey authority. Existing workers retain every spend, contact, marketing and final-provider claim.
- Advance a due, current buyer journey through its existing source-keyed preparation. Signing, texts, deposit evidence, title email and follow-up still use their original handlers and once-only claims.
- Distinguish seller/offer holds, original signature receipt review, buyer next steps, title delivery, verified closing and received proceeds. Only ordered, matching signature receipts count. A closed label, sent title email or reported disbursement cannot become received proceeds.

Pause, manual takeover, unresolved handoffs, opt-outs, stale contact evidence, practice/test boundaries and unknown operations remain in force. Existing account/recipient/spend checks run again before any provider action. The supervisor performs database work only and makes no provider request. Independent per-deal failures roll back that deal's local repairs and save a fixed SQLSTATE with a bounded retry; other deals continue.

## Release and rollback

Install `config/deal-supervisor.sql` through its matching Supabase migration, initially disabled. No historical draft scan or message replay runs at installation or activation. Verify exact-head Reliability checks, the exact main-push checks, production web deployment and the compatible production worker before enabling the setting. Save the actual production SHA and current timestamp in `release_sha` and `activated_at`; do not backdate the cutover. Normal subsequent source events begin supervision.

Disable `icash_deal_supervisor_settings.enabled` to stop new supervision. Preserve all records, events and original worker jobs/receipts. Disabling does not revoke already legitimate work from its existing workflow. Never clear an unknown provider operation to make a check pass.

## Validation and proof boundary

The reviewed database migration was installed disabled as `20261112195442_deal_supervisor`, followed by `20261112200426_deal_supervisor_activation_guard`. The activation constraint explicitly rejects a null release SHA (SQL CHECK otherwise permits an unknown result). Readback confirmed zero events/records, a disabled runner, and no anonymous/authenticated read or execution privileges. Local native PostgreSQL contention checks and the production build passed before release; these installation checks do not establish activation or live outcomes.

`deal-supervisor-database.test.mjs` executes the actual supervisor SQL, existing seller-progress SQL and canonical signature/outcome functions in isolated PostgreSQL. Synthetic scenarios cover missing routing, duplicate checks, stale sources, Pause/manual/opt-out/contact gates, unknown AI operations, forged completion labels, the seller-to-purchase-to-buyer-to-title-to-proceeds sequence, amount mismatches, tenant boundaries, failures and batching. Downstream journey/provider boundaries are explicitly simulated; these tests do not prove live negotiations or closed deals.

`test-deal-supervisor-postgres.py` uses separate native PostgreSQL sessions to verify nonblocking runner contention, one missing reply job, original unique preparation and events committed during processing. Service/route tests verify authorization, release gates, failure isolation and no uncertain-RPC replay. Existing seller, signing, buyer and title suites continue to test those handlers.

Read-only production validation must confirm migration/activation receipts, real source wakeups, bounded supervisor errors and compatible deployments. Report canonical signed purchases, signed assignments, verified closings and received proceeds separately. Changes to conversion or revenue require subsequent real cohorts; queued repairs are not sales.
