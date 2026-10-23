# Production request timeout repair

The October 23, 2026 incident included a PostgreSQL restart at 14:48:23 UTC and automatic crash recovery at 14:48:24 UTC. Runtime authentication, workspace events and recording audio requests timed out around that period. Database logs also showed contention on `icash_operating_budget`. The reason for the database process restart is not established by the available logs.

Live-update requests now share a 55-second deadline across authentication, workspace authorization and streaming, within the 60-second server limit. Streams close on their independent lifetime timer and cancel pending revision reads even if a poll hangs. Recording audio shares a 25-second deadline across authentication, membership and media retrieval, within its 30-second server limit. Transient failures return 503; denied or missing recordings remain 404. Authentication outages preserve sessions and never replay refresh requests.

The scheduler migration changes the outer advisory lock to a try-lock. An overlapping poll returns no ticket, leaving selection to the active poll and subsequent scheduled polls. Existing budget reservation, authorization, ticket selection and service-role permissions remain in force. This reduces queued scheduler connections; it does not claim to eliminate all budget-row contention or prevent infrastructure restarts.

The workflow health alert is separate: 159 historical text failures have provider receipts reporting an unavailable sending line, plus other review items. Those receipts are retained. This repair does not mark failed texts delivered, replay messages, clear uncertain calls or report full workflow health as recovered.

Validation uses local mocked requests and an isolated PGlite scheduler fixture, plus TypeScript and the Next production build. The PGlite test exercises actual uncontested advisory locking and a simulated contested-lock result, not multi-session PostgreSQL load testing. No paid calls, messages or customer charges are used as tests.
