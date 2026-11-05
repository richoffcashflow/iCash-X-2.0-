# Confirmed contract text delivery

A purchase signing envelope could be created while its text remained ready
with no provider ID or operation. If the original financial screen required
payoff clarification, a later call could record payoff, accept the supported
offer and confirm the agreement, but general SMS admission still required the
earlier screen to be financially eligible.

The guarded migration adds an exact agreement-based admission alternative for
that text only. It binds the existing delivery, message, thread, signer,
envelope, current deal terms, seller confirmation, accepted/quoted price and
unchanged property snapshot. Withdrawal, pending facts/payoff, changed terms,
cancellation and signer mismatch remain blocked. Original screening evidence
is retained. All existing contact, sender, Pause, takeover, pricing, funding
and one-use dispatch checks still run.

Recovery also recognizes a prior exact `sent:false,status:held` result when its
same message is ready, has no provider ID, and has no operation under any
account. It retains the existing 24-hour request expiry and requires current
authorization. The existing worker reuses the one envelope and message and
rechecks the provider signer before dispatch. Started or unknown provider work
is never retried. No call, signature, replacement agreement or paid test is
created by the migration.

Verification: the isolated PostgreSQL fixture reproduces both original
failures, then checks 49 scenarios including unchanged evidence, one dispatch,
source/terms/signature order, withdrawal, unknown spend, contact controls,
tenant isolation and private function permissions. Native CI runs 16 competing
recovery claims and dispatches against the same original records. Existing
signing, agreement recovery and delivery suites remain required.

Release: SQL-only, compatible with the deployed agreement recovery worker.
Require current predecessor hashes and successful exact-head Reliability
checks, apply the migration and verify its ledger/hash, then observe ordinary
authorized delivery. Do not fabricate a receipt or reset an unknown send.
Register the completed PR for automatic release after the database prerequisite
is verified. Application/worker runtime code is unchanged.

Rollback: forward-replace only these two patched function bodies from their
captured predecessors after checking for intervening changes. Retain every
agreement, confirmation, recovery result, operation and provider receipt.
