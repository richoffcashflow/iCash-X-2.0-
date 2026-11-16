# Contract payoff and repair continuity

An owner-reported contract failure stopped before agreement creation. The live
call saved a mortgage answer and an accepted price but omitted the caller's
answer to the immediately following other-debt question. The offer therefore
remained conditional. No new signing envelope or contract text existed; the
initial conversation text had been delivered.

## Behavior

Recover a complete, source-bound payoff exchange from the authenticated call
history even when the voice model skips the separate report-change action.
Preserve unknown answers, subsequent corrections, material changes, current
research, account/call binding and original quote receipts. Missing debt is not
zero without the actual answer. Seller-reported balances never establish title
clearance or guaranteed proceeds.

Updating payoff evidence can change a quote revision. Any narrowly supported
continuity between the original and recovered revision must preserve the exact
price and spoken acceptance after the debt exchange, and pass the existing
versioned database save boundary. Changed prices, other revisions, withdrawals
and uncertain debt do not inherit acceptance.

The call also omitted the exact calendar closing date and written inspection
period from its final readback. Those missing confirmations remain required.
The existing agreement service returns the precise missing readback instead of
creating a contract from model-authored confirmation flags. The historical call
cannot be treated as a completed signing authorization.

A connected quote-to-agreement inconsistency allowed an offer based on an
explicit seller repair budget when the provider had no repair estimate, then
rejected creation because the original screening had no ceiling. Agreement
preparation may now use the exact freshly recalculated, accepted price only for
the same account, deal, screening, phone and snapshot, with no existing or pending
agreement. Original research, price limits, identity, text permission and final
terms checks remain in place.

## Verification and release

Use anonymized call replays with the actual offer, evidence and agreement
services, plus the original offer-save SQL in an isolated database. Cover missing
tool calls, old/new quote receipts, changed or unknown debt, competing versions,
snapshot drift, missing readback, single-envelope reuse and repair calculation
scope. External signing and messaging transports are simulated.

This is an application-only change. No database migration, provider policy
rewrite, historical call replay, bulk hold clearing or paid development call is
required. Release through canonical exact-head Reliability checks and the normal
main deployment gate; verify the production commit before claiming the fix live.
Offline success does not establish a real delivered contract.
