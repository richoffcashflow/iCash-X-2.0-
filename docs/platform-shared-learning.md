# Platform learning

`20261021181150_platform_shared_learning.sql` introduces private aggregate rollups and durable prospective assignments. Existing provider permission, budget, idempotency, pause, suppression, quote and contract gates still decide whether any work may run. A score only selects among existing reviewed alternatives.

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

The worker refreshes at most two due accounts per 15-second tick, separately from paid-work lanes. Changes enqueue a refresh within a minute; an hourly pass matures pending outcomes even without a new webhook. Failed accounts back off five minutes and appear in the owner report. Decision queries exclude snapshots older than six hours. Initial existing accounts are queued by the migration; refreshing reads saved receipts and never calls paid providers.

Shared decisions require at least three contributors and mature samples. Each account contributes at most 200 weighted observations per approach; the larger of total, contract and closing trials determines the cap. Owner totals remain unweighted actual counts. Contracts use complete 30-day cohorts; closings use 60-day cohorts. Live signature verification binds provider ID, envelope ID, terms hash, exact recipients and signing order. Closings additionally require a sender-verified title reply, a confirmed past/current closing date and verified purchase/assignment signatures. Closing is distinct from receipt of proceeds. Counts are observational, not proof of causal lift.

Raw source records remain account-bound. New rollup, assignment, queue, revision and conversion-cache tables have RLS enabled and no anonymous/authenticated access. Server-only RPCs expose aggregate cohort data; the owner report checks the owner on both HTTP and database boundaries. Reports never return contributor account IDs, contacts or transcripts. Support requires verified resolution feedback before it can establish successful outcomes; a closed ticket is not treated as success.

## Change notifications

The existing Railway worker serves `/workspace/events`. An authenticated Next route mints a five-minute account-scoped HMAC token, domain-separated from other credentials. Browser requests carry it in the Authorization header, never the URL. The worker accepts only the production app origins, polls account revisions in batches of 100 and emits only a revision string. No account data is pushed. Stream limits, expiry, slow-consumer handling and bounded reconnects prevent unbounded resources. Paused/hidden tabs disconnect. The heavy progress and activity endpoints load on changes with a 60-second fallback, retaining saved work and unsent drafts.

Set the server-only `ICASH_WORKSPACE_EVENTS_URL` to the worker's HTTPS `/workspace/events` URL after the worker is deployed. If absent or unreachable, the fallback remains functional. The owner pretend/demo view does not mount the live workspace or subscribe.

## Release and rollback

Apply the additive database migration before deploying the app and worker. Keep existing disabled recovery/filter variants disabled. Deploy the worker from the same reviewed commit, then set the event URL for the app build. Verify the owner report, queue health, anonymous access denial, production app health and Railway terminal SUCCESS. No paid test calls, messages, lookups or purchases are needed.

If the event feed fails, remove the event URL and redeploy; fallback refresh continues. Rolling back the app/worker leaves additive schema and saved assignments intact. Do not delete assignments, reset cursors or replay uncertain paid operations. Database learning-policy rollback must restore the prior functions in a new reviewed migration; changing a score never authorizes mutation of past receipts.

Validation: isolated PGlite migration/receipt tests, pure policy tests, worker stream authentication/isolation tests, existing regression suites, typecheck, production build and browser rendering of the owner panel.
