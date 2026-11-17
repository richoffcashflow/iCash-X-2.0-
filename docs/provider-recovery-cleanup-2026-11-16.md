# Preserve original recovery outcomes during transport cleanup

Offline fault injection reproduced a shared failure: awaiting response-body
cancellation after an already known read/write outcome can prevent original
receipt persistence, queue finalization or subsequent title work. A late cleanup
failure can also replace that known outcome. Cancellation now starts once,
observes rejection, and does not hold the original outcome's continuation.

The affected automatic paths are:

- Owner contact preflight creation/count/cleanup and its original request journal.
- Active owner export response reads and original saved export downloads.
- Reviewed and automatic free export-capacity receipt collection/finalization.
- Meta lead receipt retrieval and original inbox pending/acceptance handling.
- Signing request error handling, already-authorized signature/expiry completion,
  and verified completed-agreement PDF downloads used by title workflows.

Original response bytes, JSON, CSV, provider IDs, quota receipts, request limits,
byte limits, content validation, final financial/contact/signature admission and
unknown-outcome holds remain authoritative. Complete signing responses are not
consumed by cleanup before their caller reads them. No new provider read, write,
paid retry, replacement document or historical replay is introduced.

Tests use fictional databases/providers and native streams with pending,
synchronously failing and asynchronously rejecting cleanup. They assert exact
original evidence, one request per admitted operation, rejection of invalid
responses, valid-response continuation and observed late failures. The same
failure fixtures fail against predecessor source. Counts of fixture combinations
are test coverage, not separate production incidents or recovered customers.

There are no database migrations, provider settings or activation steps. Release
through the existing serialized controller, require all exact-head and exact-main
Reliability jobs and matching application/worker deployments, then perform a
bounded read-only check. Do not trigger a paid action to demonstrate recovery or
clear existing uncertain originals merely because the new code is deployed.
