# Cost efficiency release

Application builds run `pnpm build:verified`: critical local privacy, billing/paid-test guards, worker and cache fixtures, then the normal Next build. They do not configure external providers. Provider configuration is an explicit `pnpm providers:configure` operation with the existing reviewed production environment. Run it only when changing provider policies/configuration, inspect its readbacks, and preserve its paid-simulation prohibition. A successful application build does not certify a provider change or activate a held call branch.

Vercel skips only documentation, test and worker-only changes when a valid previous deployment commit is available. Runtime, configuration, dependency, migration, mixed and unknown changes always build. Missing/shallow comparison history also builds.

Four minute-based recovery jobs share `/api/internal/maintenance`. Each existing handler still authenticates and runs independently at the same cadence. Other crons are unchanged; planned invocations fall from 9,504 to 5,184/day. Provider failures are reported per lane, without replaying actions. Recording retention and call termination remain independent of new-work gates.

Worker empty queues back off from 15 to 30 to 60 seconds and resume normal cadence when work is found. Database claims and one-use dispatch tickets remain authoritative. New work may wait up to one minute after sustained inactivity. Immediate intake/webhook paths and one-minute seller/journey crons are unchanged.

Photo fallback metadata uses a service-only, account-and-screening scoped cache. Positive entries expire after 15 minutes; misses after one minute. A 45-second lease prevents concurrent instances repeating a lookup. Cache outages fail closed for the optional photo. Unused entries are pruned after seven days in bounded batches. No paid contact data is shared between accounts.

Idle conversation reads back off to 30 seconds. Changed conversations, recent messages and unresolved sends keep five-second checks. Hidden tabs do not fetch; terminal manual calls stop their status polling.

Owner overview now exposes all-platform pending-cost age and unreconciled provider-observation counts. The existing billing cron refreshes the monitoring snapshot. Neither monitoring nor cache cleanup changes charges, balances, receipts or reconciliation flags. Historical unknown costs still need authoritative provider evidence; this release does not label them settled.

Validation: local Next production build, TypeScript, local release suites and isolated PGlite migration/role/lease/aging tests. No paid provider simulations or customer messages are part of verification.

Known baseline: `discovery-channel-admission` and `contact-channel-admission` still contain pre-existing assertions requiring wallet reservations/daily caps. Their original main-branch fixtures fail the same assertions. Production billing remains consistent with the current AGENTS actual-usage/no-cap rules; the full legacy test suite is not claimed passing.
