# Contact receipt ranking

The November 9 workflow-isolation release (#631) removed unnecessary global call
capacity and daytime text history reads. Its fresh worker then recorded a separate
`57014` timeout in `icash_next_automation_lane`: acquisition account ranking called
`icash_owner_preflight_due_at`, whose materialized list scan validated raw receipt
JSON before checking whether the corresponding contact ticket was a due retry.
This could stall shared selection while unrelated work was available.

`config/preflight-receipt-ranking.sql` adds a materialized candidate boundary in
that read-only ranking function. Existing account, screening, state and freshness
conditions select lists with a matching held contact ticket, the original retry
outcome, deferral bounds and current retry window. Only those candidates proceed
to the unchanged waiting/ready receipt proof. The original final SELECT remains
byte-identical, including source hashes, customer controls, funds, shared quota,
unknown-operation fences and cohort checks. Final paid admission and dispatch are
unchanged. No receipt, ticket, counter, balance or historical outreach is reset.

The guarded migration requires the captured canonical function hash, retains its
STABLE/security-definer attributes, empty search path, defaults and ACL, and uses
bounded migration locks. It changes no provider request or retry limits. Generic
and custom plans cannot push receipt validation before the materialized boundary.

## Verification

- Actual PostgreSQL functions over synthetic accounts reproduce 64 unnecessary
  receipt validations before the change and zero afterward. Waiting/ready due
  times and screening binding remain identical. Cases cover invalid receipts,
  future/expired retries, wrong tenant/source, unknown operations, Pause, funds,
  capacity and disabled configuration/rates. Original evidence is unchanged.
- PostgreSQL 17.6 contention checks hold a real dependency inside the actual
  receipt validator. The predecessor waits; 32 generic/custom-plan callers for
  completed, future or mismatched tickets return without entering that validator.
  Eligible waiting and ready cases still wait for proof, then return the same due
  times. No paid operations or external providers run.
- Canonical Reliability run `42684971459` passed all six jobs for implementation
  head `c64954cfd5f7b2838048049d8124ef4572e2e9e1` before installation. The final
  receipt-reconciled head must pass the same checks before merging.

## Installed database receipt

Supabase recorded `20261109194729_preflight_receipt_ranking` on November 9 at
19:47:29 UTC. The ledger contains the exact 2,848-byte reviewed SQL; the repository
filename follows that server-issued version without rewriting the ledger. The
installed function matches the expected patched definition byte-for-byte, with
MD5 `5af0c8dd0a364999f031a76ea8fa89a2`. Its STABLE/security-definer attributes,
empty search path and service-role-only application access remain unchanged.

The first attempt hit the existing five-second lock timeout. Readback confirmed
no migration receipt and the unchanged predecessor; one later attempt succeeded
with the same SQL and lock bound. No live query was canceled to force installation.

A single-account read sample took 25.831 ms before and 12.505 ms afterward,
with 2,811 versus 2,277 shared buffer hits. This is a diagnostic sample, not a
platform throughput measurement. Production web/worker release and subsequent
workflow observations are tracked in PR #634 after final-head checks.

## Recovery

If a regression is confirmed, inspect the live definition before any rollback.
The original captured definition is in
`tests/fixtures/preflight-receipt-ranking-before.json`; restore only against a
verified matching installed body through a separate reviewed migration. Do not
overwrite newer changes or rewrite the migration ledger. Existing bounded worker
backoff and receipt holds remain in force throughout.
