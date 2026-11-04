# Empty owner exports and shared capacity

On November 4 an original owner-export request completed with HTTP 400,
`invalid_request`, and the exact no-records/active-phone-filter rejection.
Its receipt had no export ID or cost. The global unfinished-export slot
blocked all 61 accounts observed with no completed work, despite available
research request capacity. Existing automatic recovery covered only exact
500 and 504 responses, so this newer provider rejection could never recover.

`empty-idle-v1` adds a separately disabled source policy for that exact
response. It binds the original request, account, completed handler, batch
error receipt and unchanged export evidence. A live lease, artifact, unknown
response, differing error or any contradictory identity keeps the hold.

The existing maintenance service then claims three separately quota-admitted
free inventory/status GETs. A valid nonempty terminal history and empty
pending and processing lists must all be received within their original
bounded windows. Empty rejections may create no history row, so this family
alone does not require an export created after the rejection. Fresh probe
receipts, quota headers, valid timestamps and all other inventory checks
remain required; the 500/504 families retain their original history rule.

Only a verified capacity-review binding changes. Original export/request/batch
receipts, missing costs, customer holds and owner fences stay intact. There
is no export replay, inferred zero charge, customer unpause or historical
outreach. Existing immutable attempts, backoff and late-evidence checks apply.

The guarded base migration installs `empty_enabled=false`. The follow-up
freshness migration requires that switch to remain disabled during installation
and binds each response's original provider Date/Age headers to the probe's
database timestamps. The maintenance transport requests cache revalidation and
saves those headers without substituting local time. Missing, invalid, stale,
future or cached responses remain held; older terminal history is sufficient
only alongside all three fresh responses for this exact empty-result family.
HTTP 500/504 retain their post-incident terminal-history requirement.

Activate only after the native concurrency fixtures, full exact-release CI and
matching production application/worker verification pass. The live maintenance
service must include the Date/Age capture before activation. Original-operation
invariance, the automatic capacity review and ordinary subsequent work must be
observed separately from installation; no provider demonstrations are needed.

Verification covers competing claims, three one-use probes, late source and
policy changes, malformed/unknown errors, historical inventory only for 400,
unchanged original money/owner evidence, and private ACLs. No paid tests.
