# Platform learning

The `platform_shared_learning_*` migrations introduce private aggregate rollups and durable prospective assignments. Existing provider permission, budget, idempotency, pause, suppression, quote and contract gates still decide whether any work may run. A score only selects among existing reviewed alternatives.

| Workflow | Shared evidence | Decision |
| --- | --- | --- |
| Seller sourcing | Same ZIP and filter version; attempts, interest, opt-outs, settled charges, verified contracts and closings | At most 60% learned allocation; account-owned cursors, exhaustion and duplicate-waste cooling remain local |
| Market ranking | Research outcomes from the same ZIP | Bounded influence on existing financially eligible rankings |
| Seller calls | Prospective assigned and persisted prompt exposure, separated by reviewed/limited context | Stable interest question; no reassignment of historical calls, new offer terms or scripts |
| Seller texts | Exact assigned body with a delivered provider receipt | Shared selection for enabled existing variants; ownership-first state machine and required STOP copy remain authoritative |
| Seller recovery | Same reason, stage and source channel; first delivered attempt per deal | Replies cannot win; mature verified contracts/closings required; existing enabled flags and opt-out safety rules preserved |
| Buyer search | Prospective deal/revision policy; reviewed ready matches, signed assignments and confirmed closings | Stable first audience then the other audience, bounded by existing page limits; no sharing of buyer/contact records |
| Workspace conversion | Existing global report using mature seven-day exposure and verified paid ledger receipts | Stable account assignment, at most 60/40 allocation for new accounts; all existing accounts retain their view |
| Seller opt-in pages | Existing global source/device cohorts | Existing controlled variants and maturity rules remain active |

A private Supabase Cron job refreshes at most two due accounts every 15 seconds, independently of the app and Railway worker. Each run has a 12-second statement timeout and a one-second lock timeout; queue row locks prevent duplicate refreshes. Its own scheduler history is retained for seven days. Changes enqueue a refresh within a minute; an hourly pass matures pending outcomes even without a new webhook. Failed accounts back off five minutes and appear in the owner report. Decision queries exclude snapshots older than six hours. Initial existing accounts are queued by the migration; refreshing reads saved receipts and never calls paid providers.

Shared decisions require at least three contributors and mature samples. Each account contributes at most 200 weighted observations per approach; the larger of total, contract and closing trials determines the cap. Owner totals remain unweighted actual counts. Contracts use complete 30-day cohorts; closings use 60-day cohorts. Live signature verification binds provider ID, envelope ID, terms hash, exact recipients and signing order. Closings additionally require a sender-verified title reply, a confirmed past/current closing date and verified purchase/assignment signatures. Closing is distinct from receipt of proceeds. Counts are observational, not proof of causal lift.

Raw source records remain account-bound. New rollup, assignment, queue, revision and conversion-cache tables have RLS enabled and no anonymous/authenticated access. Server-only RPCs expose aggregate cohort data; the owner report checks the owner on both HTTP and database boundaries. Reports never return contributor account IDs, contacts or transcripts. Support requires verified resolution feedback before it can establish successful outcomes; a closed ticket is not treated as success.

## Change notifications

The existing authenticated Next app serves `/api/work/events`. The account comes exclusively from the signed-in session; callers cannot supply an account ID. One connection per tab reads a small private revision counter every five seconds and emits only changes. No private records, credentials or account identifiers stream. Connections end after 45 seconds and reauthenticate on reconnect. Hidden tabs disconnect. The heavy progress and activity endpoints load on changes with a 60-second fallback, retaining saved work and unsent drafts.

The Railway worker stays private; shared evidence refreshes directly in the database. No public worker domain or new environment secret is needed. Public practice views do not subscribe to live work; owner inspection retains its existing read-only account boundary.

## Release and rollback

Apply the seven `platform_shared_learning_*` migrations and then `platform_learning_cron_extension`, `platform_learning_schedule` and `platform_learning_history_retention` in timestamp order before deploying the app. Keep existing disabled recovery/filter variants disabled. Deploy the app from the reviewed commit. The existing worker delegates automation to the app, and this feature requires no worker code change. Verify the owner report, queue health, successful scheduler runs, anonymous access denial and production app health. No paid test calls, messages, lookups or purchases are needed.

If the event feed fails, clients automatically back off and fallback refresh continues. Rolling back the app leaves additive schema and saved assignments intact. To pause learning refreshes, deactivate only the named `icash-shared-learning-refresh` Cron job; do not disable the extension or other jobs. Do not delete assignments, reset cursors or replay uncertain paid operations. Database learning-policy rollback must restore the prior functions in a new reviewed migration; changing a score never authorizes mutation of past receipts.

Validation: isolated PGlite migration/receipt tests, pure policy tests, authenticated stream isolation/lifetime tests, existing regression suites, typecheck, production build and browser rendering of the owner panel.
