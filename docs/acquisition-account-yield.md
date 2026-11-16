# Acquisition account lock contention

The November 16 production timeout context identifies the research selector
waiting on an account row in `icash_continue_stalled_research`, reached through
`icash_prepare_research_efficiency`. It already owns the shared dispatcher and
operating-budget locks. While that account is busy, independent work cannot
claim the dispatcher. This is distinct from unknown provider costs and does not
explain every pending account.

The acquisition selector previously locked only each selected discovery config
with `SKIP LOCKED`, then waited for its account inside preparation. It now locks
the same candidate account and config together with `FOR UPDATE OF d,a SKIP LOCKED`.
This changes one selection clause. Every predicate, ranking term, five-candidate
limit and later admission check remains byte-identical. A locked account keeps
its original due time and age and can be selected when its holder releases.
Current account controls remain locked through the selected transaction.

## Verification

PGlite runs the actual selector, issuance and fairness functions and verifies
source/ACL/security/manifest drift rejection, outer migration-ledger rollback,
unchanged money and provider evidence, current Pause/funds/configuration/budget
controls, and the existing two-continuation/one-ordinary ordering. The migration
changes exactly the selector and three manifest hash fields; all other function
bodies, privileges, activation receipts, counters and policy fields are preserved.

A native PostgreSQL 17.6 reproduction holds six older account rows in another
transaction. The original selector times out with `57014` while holding the
shared advisory lock, and an independent recovery poll cannot issue. The repaired
selector reaches a later unlocked account within the same 500ms timeout (22ms in
the local run), retains its account lock until transaction end, permits independent
recovery afterward, and selects an older account after its holder releases. Late
Pause and a separately locked config still exclude selection. This uses the
actual production selector and source-bound preparation account-lock projection;
it does not run provider work or the complete research-preparation handler.
Synthetic timing is not a production throughput or customer outcome claim.

## Installation and release

After exact-head canonical checks and independent review, apply
`20261116031138_acquisition_account_yield.sql` once using the normal migration
ledger. It requires the current budget-yield selector hash
`15426cf63cce56d98db8f14e66fb0675` and produces
`babca17c5b3e89dac4931c803ba61405`. Under the existing scheduler/budget locks it
updates only the acquisition hash slots in continuation, preflight-step and
acquisition-headroom policies, with exact before/after assertions for every
non-target field. The same SQL is retained in `config/acquisition-account-yield.sql`.
There is no new activation, provider configuration, UI or financial policy change.

Verify the installed source/hash, private privileges and unchanged policy fields,
then complete exact-main web/worker release checks. Observe ordinary completed
work and future account-lock timeouts separately. Passing this regression does
not settle historical originals or establish zero stalled accounts.
