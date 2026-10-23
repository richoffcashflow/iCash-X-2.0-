# Parallel calling expansion — October 23, 2026

The owner requested more parallel calling. Fresh provider subscription and agent
reads now allow ten total calls, capped at the plan's published allowance. Up to
eight may be outgoing; two slots remain available for incoming calls. The two-slot
incoming agent is unchanged. Per-account funded admission remains one to three
calls. Final claims keep the common budget lock, recipient exclusion, Pause,
spending permission and all unresolved-provider holds.

The outgoing agent's per-agent concurrency setting moves from two to eight.
The original reviewed branch, version and full configuration fingerprint remain
stored. Only that identity may match the separately approved 2-to-8 substitution;
the entire remaining configuration must still reproduce its original hash.
Generic/incoming comparison, daily limits, burst mode, recording, prompts, tools,
provider billing and historical approvals do not change.

Deploy the SQL migration and app first. After the exact main commit passes CI and
is live, set production `ICASH_PARALLEL_CAPACITY_COMMIT` to that commit and redeploy
it once. The explicit migration script is behind the production CI gate, requires
the reviewed outgoing identity, ten plan slots and unchanged non-burst settings,
and can run only October 23–24, 2026 UTC. It reads main before a minimal per-agent
PATCH, then verifies the reviewed branch. Unknown writes are read back rather than
retried. Clear the temporary deployment variable after readback. Other commits,
normal builds and imports do not mutate the provider.

Verify fresh capacity rows (10 workspace, 8 outgoing, 2 incoming), telephony
preflight and worker heartbeat. Offline PostgreSQL and provider fixtures cover
both arrival orders, incoming reserves, account limits, lower plans, expiry,
unknown outcomes, restricted permissions, minimal writes and configuration drift.
No paid test calls or simulations are authorized by this release.
