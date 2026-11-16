# Workspace page read efficiency

The initial workspace activity read awaited both counts, then the property page,
then the inbound page. Those reads use the same authenticated account and do not
depend on one another. A slow count unnecessarily delayed both page reads.

After input validation and the existing outcome refresh, collect the original
reply-page IDs when the selected view requires them. Then read counts, properties
and inbound leads together, with no change to their queries, limits, sorting or
feature gates. This changes three serial read stages to one concurrent stage for the
ordinary mixed workspace. Text/unread pages retain their reply-ID prerequisite.
Four requests run together for an ordinary page; the bounded six-entry text page
can use at most eight, below the existing ten-request attention stage. Later
metadata and attention processing retain their previous ordering and bounds.

Every concurrent result is observed before using the stage. Any rejected read
returns the existing unavailable response and prevents dependent queries; failed
reads never become empty successful results. Authentication stays in the calling
routes, and outcome refresh must complete before any of these reads. Owner
inspection remains read-only. There is no shared cache, response reuse across
accounts, added query, financial/provider action, SQL migration or UI change.

`workspace-page-concurrency.test.mjs` reproduces the former waterfall with held
database promises, validates the concurrency bound and unchanged page/source
ordering, and checks all outer failures plus a nested inbound failure. Existing
workspace activity, archived attention and owner-inspection route suites check
the complete response, tenant scope and authorization boundary. The new test is
included in local release verification and automatic all-test discovery.

This is a bounded latency optimization, not measured production savings. It does
not reduce DealMachine credits or establish live latency, zero stalled accounts
or lower supplier bills. Release through the existing exact-head/main CI and
production web checks; no worker/configuration activation is required.
