# Bounded seller-opener selection

The November 3 follow-up preserves the thread-history index from #538. There
were no worker scheduler timeouts in the inspected 05:00–05:38 UTC window, but
new 57014 failures appeared at 05:41, 05:42 and 05:46 under #539. PostgreSQL
stacks placed the first two inside the seller-opener selector's expensive
recipient checks. The third was in research-waiting selection, a separate path.

`seller-opener-bounded-scan.sql` keeps the original cheap predicates, then
materializes at most 32 ordered candidate IDs before the original recipient
hours and full source checks. A service-only cursor advances under the existing
scheduler advisory lock. Successful issuance, rejected final queue attempts and
skipped locked rows advance the scan; an exhausted upper range resets it for
the next sweep. Earlier holds are revisited, while new lower UUIDs cannot keep
restarting the sweep ahead of later accounts.

The migration preserves prior-lane priority, the existing one-second issuance
cadence, all account/recipient/history/financial predicates, row locks, final
queue function and one-use tickets. It changes no customer budget, permission,
provider receipt, existing task or financial hold. The guard checks the exact
current function definition before installation. There is no duplicate index.

The offline database fixture reproduces 1,024 expensive checks in the original
selector, then checks the 32-candidate bound, generic-plan reuse, wrap, blocked
and successful large-account backlogs, progress across later accounts, global
history exclusion, expired screening, pauses, reserved balances and private
permissions. Supplemental coverage installs the captured current opener/text
queue functions and routing, price and opener-observation triggers unchanged.
The native PostgreSQL CI hook tests cursor contention and late guards with
separate connections. Neither fixture contacts providers.

The existing selector can create a ready draft if Pause or a balance reservation
changes after its statement snapshot. A queued draft is not a provider send or
a financial operation. Native tests compare that old/new behavior instead of
inventing a stronger final-queue guard, and the captured final-send function
rejects Pause under its account lock. Complete financial dispatch remains
covered by its separate fixtures; this change does not weaken or bypass it.

Read-only production sampling measured about 214 ms for the cheap ordered
32-row source and 244 ms for the bounded recipient query without its locking
source helper. These are sampled plans, not a completed production rollout or
a throughput guarantee. A sampled full research-waiting call took 144 ms; that
path is unchanged here. Verify production timeout rates, completed work across
accounts and settled receipts after migration/deployment before concluding
recovery. A healthy worker alone does not establish progress.
