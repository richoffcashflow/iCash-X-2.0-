# Health response cleanup responsiveness

An offline reproduction found that a successful authentication-health HTTP
response could leave the public health check waiting on unused-body disposal.
The same dependency existed for failed database, authentication and workflow
probes. The shared in-flight promise then retained every concurrent health
caller even though the HTTP result was already known. This is a monitoring
resilience defect, not evidence of a particular customer operation failing.

Health probes now start unused-body cancellation once without awaiting it and
handle immediate and eventual cleanup failures. Known probe results no longer
depend on disposal. Successful database and workflow payloads still require
their complete original validation; HTTP status alone cannot pass those checks.
The schema, parallel probes, shared pending promise, short cache, private output,
five-second request deadlines and unavailable/malformed/freshness rules are
unchanged. No authentication permission or customer-work gate changes.

The existing `service-health.test.mjs` adds twelve native unfinished-stream
cases across successful auth health and rejected auth/database/workflow probes.
It covers pending, rejecting and synchronously throwing cancellation, concurrent
callers, retained cache behavior, exactly one disposal and no repeated request.
The first case fails on the predecessor. Existing missing-configuration,
malformed-workflow, database-row and fetch-failure regressions remain required.
No real database, authentication service, provider or customer is contacted.

Keep this a separate change from worker diagnostic cleanup. Use the existing
serialized release controller, exact-head canonical checks, exact main-push
checks and production web verification. No database migration, configuration,
policy activation or paid development test is needed. A reliable health response
does not establish receipt recovery, zero pending work or completed customer work.
