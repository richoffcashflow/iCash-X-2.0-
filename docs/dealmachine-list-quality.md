# DealMachine list quality

This rollout adds vacant-plus-absentee, out-of-state absentee with a recorded sale
over ten years ago, and off-market with estimated repairs of at least $25,000 to
the reviewed experiment choices. The latter two use new immutable definitions.
All retain single-family, at least 70% equity and the existing financial gates.
Last sale and estimated repairs are provider data, not verified tenure or an
inspection. Existing audiences retain half the available sourcing slots.

Future owner exports request the six documented two- and twelve-month phone usage
output fields. They do not expand the audience or add a separate provider credit
charge. Old requests, preflights and original downloads remain recoverable without
a second purchase. Exact receipt totals, CSV hashes and tenant/source bindings
remain authoritative. Missing usage stays blank/unknown. JSON owner receipts retain
provider phone match confidence when present; the CSV contract does not invent a
confidence column or buy another lookup to obtain one.

When the separate quality switch is active, DealMachine operational SMS eligibility
requires a mobile/wireless phone from the exact saved owner source. One immutable
number is selected per provider person across properties and accounts: known match
confidence first, recent usage second, provider order as the tie-breaker. Zero
confidence is distinguished from missing confidence. Pre-rollout outgoing attempts,
including unknown dispatches, take precedence over ranking. Valid existing human
conversations retain their original number. STOP, rejected contacts, disabled
senders and refreshed lists cannot cause automatic selection of another number.
This selection grants no contact permission and does not weaken any existing DNC,
Pause, sender, time-window, source, money or final-dispatch check.

The owner report shows interested sellers, opt-outs, verified wrong-number results
and customer cost per interested seller when costs are complete. Wrong numbers
require original received SMS identity or a completed provider call's recipient
words, after an actual attempt. Quotes and negations are excluded. Carrier reports
are not inferred from missing incoming messages.

Future sourcing pauses an audience after at least 20 attempts and at least three
opt-outs above 5%, or at least three wrong numbers above 10%. These are internal
operating thresholds, not carrier policy or proven statistical performance. Winner
allocation still needs the existing mature, cost-complete comparison and confidence
bounds. New phone metadata does not establish better seller interest.

## Activation

Apply the independent exclusion-sync and verified-query-binding migrations from
main, plus `20261109015640_dealmachine_list_quality.sql`. Phone quality installs
disabled; usage-output compatibility and outcome/report fields are additive.
Run the focused database, export-settlement, targeting and native concurrency tests,
the required Reliability checks, and verify the exact main SHA on Vercel and Railway.
Use `config/activate-dealmachine-list-quality.sql` with that actual release SHA.

Keep the old `exclusions_enabled=false`. Enable only the separately reviewed free
synchronization switch for the exact original ready provider list. Await original
provider acknowledgments for all pending exclusions. Authenticated maintenance drains
at most four original free batches, ten seconds apart, stopping on quota, unknown
results or a minute budget; it cannot use protected starter requests. Then use the existing guarded
`activate-targeting-verified-query.sql` plan. Enable the three combined property
audiences through `icash_configure_targeting`; do not enable every historical
experiment or mark the untested provider `mobile_only` export flag verified. Mobile
SMS filtering here uses the returned phone type and needs no paid test purchase.

Pause future quality selections with its private switch under the common budget
lock; preserve immutable selections and receipts. Pause experiments through the
existing owner control. Once an experiment has purchased a ZIP, its exact-list
protection remains required even when paused. Never clear unknown operations or
pending exclusion rows to claim readiness. No paid development calls or messages
are part of this release.

Provider contracts: [export output fields](https://api.docs.dealmachine.com/api-reference/people/export-people),
[phone response metadata](https://api.docs.dealmachine.com/concepts/response-format),
[property filters](https://help.next.dealmachine.com/en/articles/17263375-property-search-filters-the-complete-list).
