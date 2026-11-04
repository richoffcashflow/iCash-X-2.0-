# Shared export wait fairness

An occupied DealMachine export slot makes the contact candidate wrapper return
null. Acquisition then reaches its ordinary no-work cooldown and advances
`next_run_at` by 60 seconds. Repeated occupancy erased the scheduler's 5/10-minute
aging escape even though funded, eligible contact work had not received a turn.

The repair preserves the original stored due time in a small private table only
after a selected account is observed waiting on exact `export_busy` with a funded
contact candidate. It retains the original 60-second polling cooldown and
five-account scan. The existing aging sort uses the preserved time; real issuance
or confirmed unrelated ineligibility clears it. Ordinary discovery continues
through the same bounded scan. Candidate errors roll back the transaction.

The table stays separate from discovery configuration so existing review hashes
remain unchanged. Customer Pause, rights, funding, request quota, active tickets,
due-list priority, operating-budget locking, `SKIP LOCKED`, and final export
admission remain in force. The change never clears an export, financial hold,
reservation or source receipt and never makes a provider request itself.

A rejected alternative moved full contact eligibility before `LIMIT 5`. A
read-only production plan over 127 due accounts took 13.28 seconds and 4.7 million
buffer hits, so it is not used. The chosen path evaluates contact eligibility
only inside the existing five-account loop and adds a primary-key wait-table
lookup to account ordering.

Validation: the PGlite fixture executes the exact saved production issuer and
patch, reproduces lost age, exercises repeated busy ticks, checks the five-row
bound, advances discovery beyond five waiting accounts, and proves old accounts
receive normal turns after capacity returns. It also covers a capacity transition
after selection, original control gates, unchanged financial sentinels and private
RLS/ACLs. The native PostgreSQL fixture adds competing issuers and state changes
committed while a caller waits on the original budget lock. Both use synthetic
dependencies and never contact a provider.

Production installation and native CI results must be recorded separately; local
tests do not establish deployment or completed customer work.
