# Outbound call result recovery

At 1:46 PM Central on November 5, production calling had resumed after the
ElevenLabs plan recognition repair. Fresh provider metadata reported available
credits on the upgraded plan. Carrier IDs and exactly bound AI conversation IDs
continued to arrive. This was not a continuing total dispatch outage.

Result recovery was still falling behind. The database contained 156 due recording
checks, with the oldest due about twelve minutes earlier. Newly bound conversations
had waited 14–16 minutes after call creation. The shared oldest-due queue mixed new
calls with historical unknown receipts, some with thousands of previous attempts.
Processing only twelve records per minute could not catch up. Those older records
are unresolved evidence, not permission to release money or replay a call.

The authenticated recording maintenance route now drains up to four sequential
batches of twelve original receipts in its existing shared 45-second provider
window. It still runs at most three rows concurrently and claims at most five
retention deletions once. It claims another batch only after the preceding batch
finishes, and stops at a partial batch, expired deadline, or failed persistence.
Thus later records are not leased far ahead of processing, and an infrastructure
failure remains visible after already-claimed independent records finish.

Original SQL selection, SKIP LOCKED, 120-second leases, per-row backoff, account and
provider identity validation, retention handling, call termination, and financial
settlement are unchanged. The single missing-call discovery and carrier diagnostic
allowances apply across the entire invocation, not separately to each batch. There
is no new dial, provider configuration change, credit purchase, historical retry,
or schema migration. Incoming reception remains on its independent maintenance path.

The regression first reproduced the twelve-record ceiling. Offline tests exercise
48 distinct results, a shorter queue, a failed early receipt followed by later
successful batches, cancellation between batches, persistence/claim failures,
retention work and the actual authenticated route. Existing exact-provider-binding,
recording retry and SQL backoff tests remain required. Canonical exact-commit CI,
production deployment and fresh ordinary recovery receipts determine release status;
offline fixtures alone do not prove live recovery latency or successful seller calls.

This repair addresses result-processing capacity. It does not establish zero future
outages, resolve historical missing provider evidence, replenish provider credits,
or prove every funded account and deal workflow is progressing.
