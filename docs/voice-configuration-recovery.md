# Recovery after an outbound configuration repair

Jobs held with `production_agent_review_required` can remain blocked after the
provider configuration is repaired. The existing queue does not create another
first-call job for these contacts, and the budget resumer does not handle
configuration failures.

Production maintenance now reuses its existing global outgoing-agent GET. Only
a complete current approved-agent match, available provider credit metadata,
and enabled production releases can request database recovery. No extra provider
request, paid simulation, changed approval, or provider configuration write is
introduced.

`icash_recover_voice_configuration` queues up to 20 ordinary seller jobs per
check. A job must have exactly one completed configuration-rejection ticket and
no reservation, operation, recording, call SID or conversation. Source/account,
membership, channel, Pause, wallet, current target, fresh underwriting, hours,
recipient spacing and capacity are checked. Source-specific callbacks, SMS
requests and Meta sequences retain their own handling. Recovered recipients
cannot duplicate another ready or active job.

Each recovery has an immutable private audit row and occurs at most once per
job. The original ticket stays closed. The ordinary scheduler issues a fresh
capability and dispatch rechecks all eligibility, financial, provider and
recording controls before placing any call. Unknown outcomes, original receipts,
customer balances and expired contact evidence are never rewritten.

Install `20261030183441_unstarted_voice_configuration_recovery.sql` and
`20261030191436_voice_configuration_recovery_schema_access.sql` before the
matching application release; installation itself queues nothing. The latter
allows the backend role to reach its explicitly granted audit table; other
private tables and functions retain their existing permissions. Tests execute
recovery as that backend role, including the original missing-schema failure.
The existing
production Git/CI gate remains required. Inspect maintenance's
`capacity.recovery` and new original provider call receipts after release. A
requeued count is not evidence of a completed or answered call.

Offline validation: `voice-configuration-recovery`,
`voice-configuration-recovery-database`, existing live dispatch, actual
operational-contact validation, capacity/credit, configuration comparison and
incoming reception suites. Paid development calls remain disabled.
