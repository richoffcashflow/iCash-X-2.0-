# Independent bounded contact lookup

`ICASH_CONTACT_WORK_READY=true` admits only the existing `contacts` automation ticket and the reviewed bounded owner-contact adapter. The flag defaults OFF. Property discovery retains its separate flag; voice, contracts, text AI and outreach permissions are unchanged.

The owner account response reports contact lookup readiness and the current server-owned planning reservation. Readiness reuses `icash_enrichment_candidate`, reruns the actual financial screening, rejects an existing operation for that candidate, and applies the shared wallet, rolling daily, lifetime activation, paid funding, current rate and configured source-rights checks. The existing auto-enabled scheduler and authenticated Resume control are used. This release adds no route, SQL, activation, permission or synthetic evidence.

The independent reservation exception accepts only the configured `owner_enrichment` rate, exact account/screening operation key, fresh owned eligible screening and current configured rights. The generic dispatch helper refuses this operation; the contact adapter must use `icash_claim_owner_enrichment`, which atomically rechecks the reviewed snapshot/configuration/manual control and invokes existing billing claim checks before the paid request.

The adapter makes a free property preview with `enrich=false`, selects at most the configured 25 distinct returned person IDs, and makes one `people/ids` request with `enrich=true` and `include_properties=false`. It retains the existing complete receipt validation and no-replay rules. Saved phone metadata remains permission-unverified and every saved result has `outreachAuthorized=false`.

The inspected configuration quotes a $1.74 planning reservation for at most 25 people, with a $0.01-per-credit operator cost assumption. Rates remain server-owned and the UI displays their current values. The scheduler can continue within the account limits; the button does not promise an automatic one-shot stop. A finite observed production cycle uses existing activation cap, pause and auto-enabled controls managed by the operator. This patch does not change those controls.

Tests cover actual service/reservation/atomic-claim execution under full-work OFF/contact-only ON, exact automation and Run boundaries, candidate/budget/source holds, wrong operation/screening rejection, generic-dispatch exclusion, and unchanged sibling gates. Synthetic PostgreSQL/provider fixtures make no real provider call or customer contact.
