# Exact phase admission before export-wait bookkeeping

The actual scheduler reproduced an existing gate conflict: an original live
list had a valid due source, two available requests and an eligible continuation
turn, but `record_export_wait` saw the coarse `quota_wait` state first. It recorded
a wait, moved the account's next run by 60 seconds and returned without issuing
the original ticket. The three-request and ordinary-turn controls behaved as
expected. Testing a replacement wait boundary had missed this interaction, so
the connected scheduler fixtures now install the real wait function.

`owner-wait-admission.sql` returns from wait bookkeeping only when the unchanged
`owner_preflight_step_due` function explicitly returns true. That function still
owns source, phase, capacity and fair-turn eligibility. It rejects genuine busy
export capacity. A cleaned original still needs three requests; an ordinary
two-request turn remains held. Final acquisition, provider, financial and
receipt guards are unchanged.

The old wait function also ran the complete ranked contact selector merely to
test whether it returned an ID. With 200 eligible synthetic screenings, this
evaluated 200 opportunity scores and discarded the selected ID. The correction
derives a boolean existence query from the exact pinned candidate definition,
retaining its materialized source CTE and all eligibility predicates while
removing only projection, ordering and limit. The wrapper retains outreach
priority, current rate, quote and affordability predicates. Actual job ranking
continues to use the original ranked selector.

This removes unnecessary ranking work while the existing operating-budget row
is locked. It does not remove that lock, change timeouts, add provider capacity,
or establish that every historical database timeout had this cause. Production
logs showed acquisition timeouts and receipt writers waiting for the shared
budget row; historical blocker ownership was not proven.

## Release and verification

This is the third migration in the deadline/dispatch release, after
`owner_expired_ticket_deadlines` and `continued_owner_scheduling`. It verifies
the exact predecessor functions, execution permissions, activated policy
receipts and four-entry source manifest. The new `owner_wait_hashes` field records
the two boolean helpers, wait function and unchanged ranked/wrapper sources.
Existing policy hashes, activation receipts, turn counters, wait ages, requests,
balances and original provider evidence are preserved.

Future eligibility or wrapper predicate changes must regenerate both boolean
clones and refresh the five-entry manifest together. The equivalence tests compare
them with the actual ranked source; the boolean helpers are not separate policy.

Use the migration ledger after exact-head and exact-main checks and matching
production release verification. Read back definitions, ACLs and manifests.
Do not replay an ambiguous migration response; inspect its ledger receipt and
installed source first.

The actual-function tests reproduce the old two-request block and discarded
scoring, then verify connected issuance, the full turn/capacity/source matrix,
busy and unknown holds, equivalent eligibility, zero ranking calls for wait
metadata, original wait-age preservation, rollback and unchanged financial
evidence. Native concurrency tests use only a disposable local database.
Production verification must observe natural original-ticket progress and
completed outputs. An expired original stays expired; this upgrade does not
renew its authority.
