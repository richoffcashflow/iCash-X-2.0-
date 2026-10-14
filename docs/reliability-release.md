# Reliability release — October 14, 2026

Production targets: Vercel `i-cash-x-2-0`, Railway `iCash X / worker / production`, Supabase `icash-x`.

## Evidence and monitoring

The existing maintenance cron refreshes a private, shared workflow snapshot once per minute. The worker writes a heartbeat at most once per minute. Missing or stale telemetry is not healthy. `/api/health` exposes only database, authentication and workflow status; details remain in the authenticated platform-owner overview at `/admin`.

Owner alerts cover uncertain text/call dispatches older than five minutes, contract preparation older than five minutes, failed preparation/delivery requiring review, contract texts without delivery confirmation after ten minutes and expired screening leases older than two minutes. Archived properties, closed/cancelled deals and retired text threads are excluded from active contract/text reminders. Unknown in-flight call dispatches still require reconciliation. Counts describe observed records; accepted is not delivered and delivered is not signed. Recent message/contract metrics use the past 24 hours of created records, not a promised conversion rate.

The snapshot is shared across dashboard reads. Indexed unresolved states and recent-record indexes bound normal query cost. Owner overview's independent reads now execute concurrently. No paid API calls, messages, contracts, charges or automatic resends are initiated by monitoring.

## Recovery

Provider sends remain one-use claims. Once a provider returns a text ID, the receipt save may retry once after 200 ms. The database accepts repeated identical receipts without replacing IDs, crossing accounts or overwriting a terminal delivery result. If both saves fail, a filtered fallback preserves the known ID for review. Ambiguous provider outcomes never trigger automatic resend. Early authenticated delivery callbacks are reconciled when the receipt is saved.

Worker health also detects an event loop that stopped completing iterations for three minutes. Its telemetry timer is independent of customer work and cannot prevent queue processing if telemetry fails.

## Verification and release

`pnpm run build:verified` runs focused workflow regression tests, including local PostgreSQL receipt/monitor checks, saved seller agreement conversations, signing/link identity, duplicate/uncertain sends, worker recovery, pause/billing recovery and private owner access. Paid provider simulations remain disabled.

`pnpm run test:browser` exercises the built owner's dashboard in desktop Chromium and mobile WebKit using intercepted fixture API responses. It covers incident visibility, refresh failure/recovery and loss of authorization; it does not prove live provider delivery. It starts its local server without production credentials and blocks nonlocal browser requests.

The GitHub workflow runs these checks, an isolated bounded-concurrency regression, and desktop Chromium/mobile WebKit scenarios on pull requests and main. Production releases additionally wait for the exact main commit's successful `Reliability checks` workflow: Vercel runs the gate before building and Railway runs it before starting the new worker. Missing, failed, cancelled, or timed-out checks block the release. See `production-release-gate.md` for configuration and failure handling. This is deployment enforcement; repository branch protection is not configured by this release.

The bounded concurrency test verifies duplicate dispatch/receipt/settlement handling across two synthetic accounts and coalescing of health probes. PGlite uses one database connection, and providers are stubs. Its timings do not establish production capacity. See `bounded-concurrency-smoke.md` for the tested bounds.

Apply the additive workspace-experience/incident migration before releasing the application. Private, bounded interface counters record only event/stage enums bound to the authenticated account. The owner overview displays these signals separately from deal completion or churn. A production-only incident dispatcher uses the verified owner's email and a verified sender, persists deduplicated detection/recovery notifications, and leaves uncertain provider outcomes for review. Provider acceptance is not delivery. A separate scheduled GitHub health probe detects outages even if application maintenance stops; notification delivery follows the repository's existing Actions notification settings.

## Operational response

The platform owner reviews the reliability panel. A stale worker heartbeat requires checking Railway status/logs. Stale maintenance requires checking cron execution and authorization. For an uncertain text/call/contract, inspect its persisted provider ID and delivery callbacks before considering another send. An accepted contract text still needs a delivery callback; a signed contract needs signing evidence. Keep the original incident evidence, add a regression scenario and release the fix. Do not clear real incidents merely to make health green.

Keep a known working release available and avoid changes immediately before webinars. For rollback, revert the application/worker commit and redeploy; this migration is additive and its receipt function remains backward-compatible, so leave it in place. Never roll back settled payments or customer data.

Live conversation quality, recipient receipt and whole-deal completion still require ongoing production observation. Any new paid development test needs the owner's explicit capped spending authorization under AGENTS.md. This release makes no 99.9% availability or zero-bug claim.
