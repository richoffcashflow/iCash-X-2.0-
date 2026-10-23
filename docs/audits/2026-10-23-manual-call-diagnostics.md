# Manual-call diagnostics and truthful status

Reconstructed on current main ae1cd5beca77c6ec37272dcc707f895840f02d32 after the earlier local artifact was unavailable. Preserves the eight-outgoing/two-incoming capacity release. No capacity, credential, credit, database migration, or call-initiation changes.

## Behavior
- Webhook rejection logs contain static stage/reason and an internal call ID only after signature, database identity, and nonce validation. No phone numbers, secrets, request URLs, provider payloads, or raw exceptions are logged.
- Reconciliation looks for bound child receipts even when the local bridge timestamp is missing. Exact provider/account/recipient/parent/date checks remain. Ambiguous/paged results stay unresolved; empty child lists require the existing 30-second parent-end grace.
- Browser controls distinguish confirmed failed calls from completed calls and unconfirmed final status. Cleanup is immediate, uses the existing end endpoint, and never redials. Old session callbacks cannot change a newer session.

## Verification and limits
Focused mocked service and browser lifecycle tests cover fail-closed authentication/binding, bridge-admission rejection versus exceptions, log redaction, child recovery, grace periods, failed/completed/unknown final status, cleanup, and stale callbacks. Release also requires full local tests, aggregate build checks and exact-commit CI.

This is a diagnostics/status improvement, not proof that the underlying production call failure is repaired. No real calls or paid simulations are included. Provider failure analysis and a separately authorized, spending-bounded end-to-end call remain necessary to prove live recipient connection. Receipt completion alone does not prove a live human answered.
