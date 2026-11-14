# Original accepted-message evidence collection

An accepted message can outlive its sender's current lease. The receipt worker
previously skipped the exact original provider message GET whenever the current
leased-number request failed or omitted that sender. This coupled historical
evidence collection to current sending readiness and consumed a bounded recovery
attempt without obtaining the original message evidence.

Failed network, server or malformed canonical reads now report
`receipt_read_unavailable` even when the failed observation was saved correctly.
Write failures retain their separate status. A missing/gone original message
(404/410) or a readable lease list without the original sender remains an ordinary
evidence hold. Other claimed originals still finish, including when the lease
read fails; failed lease authority can never establish delivery.

Keep the existing lease lookup and diagnostics, then independently request the
original message ID with `?tracking=true`. Save both observations in the same
original attempt. This uses only authenticated GETs and the existing three-message
batch, eight-attempt limit, deadlines and backoff. Do not reset exhausted schedules.

The SQL application gate is unchanged. Missing current lease identity still holds
the message, including a response with matching terminal tracking. Top-level
`delivered` without matching terminal tracking is insufficient. This patch neither
proves historical sender ownership nor enables a number, changes a conversation,
replays a send, releases money or creates historical follow-up work. Preserved
canonical evidence supports the separate identity and provider investigation.

Tests replay the actual service through existing SQL and message observers with
missing sender identity, a failed/forbidden/malformed lease lookup and matching
terminal message evidence. Assert unchanged accepted state, financial records,
original message ID, retry count and historical follow-up suppression. Existing
tests retain source/body/recipient/timestamp/attachment/terminal-state rejection,
late callback handling and private permissions. All provider responses are fixtures.

Release in the same incident PR #727 through the existing controller; this
receipt-collection change needs no SQL migration or policy activation. Require exact-head full CI,
review, exact-main push checks and affected production versions. Rollback is the
normal application revert, retaining collected receipts and all original holds.
Observe naturally scheduled recovery only. A saved receipt is not delivery proof
or completed customer work, and this does not restore disabled sender service.
