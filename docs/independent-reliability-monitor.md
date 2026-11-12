# Independent reliability monitor

On November 12, the production-health workflow was configured every five minutes,
but the two latest scheduled runs started at 03:29 and 11:44 UTC. The owner asked
to ship independent detection and automatic recovery. Keep the GitHub probe as
an additional check; it is not the minute-by-minute observer.

`monitor/index.mjs` is a separate, always-on Railway service named
`reliability-monitor` in the existing production project. It starts a bounded
cycle every sixty seconds without overlapping cycles. It probes the public
application and directly runs the existing incident observer/owner notifier
against the database. Web cron delays and a hung paid worker cannot stop this
separate service. Database claims, the existing six-alerts/hour cap, provider
idempotency and uncertain-send holds remain authoritative. The observer has no
customer-job RPCs, provider purchase/call/text credentials, or recovery writes.

Public workflow degradation remains distinct from application/database/auth
unavailability. The ordinary incident messages retain actual account-progress
counts and original-receipt evidence. The monitor never refreshes another
service's heartbeat, marks held work complete, or invents a successful snapshot.
It upserts one private operational observation under
`external_reliability_monitor_v1`. After its first observation, maintenance
detects a missing/stale/malformed heartbeat (three-minute limit) and reports a
degraded monitor cycle while continuing independent recovery and snapshots.

If application or incident observation fails on three consecutive cycles, the
monitor can send a separate bounded outage warning directly to the most recently
verified platform-owner email. Verification is refreshed every five minutes;
explicitly invalid/deleted/banned identities clear the cache. A temporary auth
outage may use that evidence for at most six hours. The fallback sends at most
once per UTC hour, with an identical hour-bound payload and provider idempotency
key across replicas/restarts. Each process consumes the attempt before sending;
an uncertain result is never retried in that hour. Acceptance is not inbox
delivery. A cold start during a total auth outage has no verified recipient and
cannot send this fallback. No customer recipient is supported.

The process exposes its own completed-cycle freshness for deployment readiness,
separately from the observed application's status. A stuck async cycle exits
after three minutes so Railway's ALWAYS restart policy can restore the observer.
The monitor uses a dedicated sending-only key restricted to geticashx.com and
references the existing worker database configuration without disclosing it.

The production readback after the outbound repair exposed the same serialization
change in incoming reception. Its complete approved fingerprint already matched,
but structural validation still rejected `frames: {}` together with
`start_node.parent_frame_id: null`. Accept only that observed empty pair on the
single inert start node; retain every other structural check and the original
complete fingerprint. The regression reproduces the live failed check, confirms
recovery, and rejects executable/nonempty/unknown fields and changed approvals.
No provider setting or approval is rewritten and no test call is placed.

## Release

Require the current-head and exact-main Reliability checks and normal web/worker
release verification. No database migration is needed. Configure a new empty
service with `monitor/Dockerfile`, `/health`, one replica, no sleep, ALWAYS
restart, and the existing `node scripts/verify-production-release.mjs --railway`
pre-deploy gate with a 1,500-second host deadline. Set the explicit monitor flag,
normal reliability email flag/from address, domain-scoped sending credential,
and database references. Attach the same repository's main branch only after
the configuration is ready. Never set fake Git metadata or promote a preview.

Read back the actual commit, running service and successive private observations
approximately a minute apart. Observe ordinary voice/usage receipts and account
progress separately. A deployed monitor is not a claim of zero account stalls.

Offline coverage includes the real existing incident dispatcher, production
identity guards, concurrent-cycle exclusion, simultaneous app/database failures,
cached-owner expiry/revocation, bounded fallback, redaction, rejected customer
operations, and maintenance detecting observer failure while continuing work.
