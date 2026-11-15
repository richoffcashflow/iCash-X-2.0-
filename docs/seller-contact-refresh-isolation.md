# Isolating one reviewed contact-refresh cost discrepancy

The November 15 owner request authorizes recovering eligible follow-ups while
preserving original uncertain charges. One completed November 8 phone check has
contradictory `used=2`, `people=1`, `deduplicated=1` credits; its independent
request ledger also reports two used credits. The original one-credit settlement
validator correctly refuses it. This release does not reinterpret the receipt,
settle the operation, charge a customer, renew a contact or resend any message.

The prior scheduler stopped all new contact checks for this one unresolved
record. A new private policy allows a single operator-reviewed historical
discrepancy to remain isolated while unrelated, currently admitted work proceeds.
The original account remains excluded until its operation has a real settlement
amount, timestamp and evidence. Missing HTTP outcomes are never eligible for
isolation. Any additional unknown request, saved response awaiting cost
processing, or cost discrepancy stops new checks.
The policy cannot accumulate a second exception or automatically rearm itself.

The review freezes the complete refresh, independent request, original operation,
original contact, immutable rate and current data-cost settings. Routine
`estimate_checked_at` is the sole omitted operation field because maintenance
updates it without resolving billing. Every subsequent admission revalidates the
snapshot. Changed source, rates, cost settings or missing reserved exposure
restores the global barrier. The existing one-minute pace, candidate fairness,
customer funding, membership, Pause, suppression, ownership, financial-screen
freshness, provider quota and final sender checks remain authoritative.

Activation adds a company-only planning reserve for the reported extra unit at
the original recorded unit-cost estimate plus its original buffer. With the
reviewed production snapshot, that is 12,000 micros ($0.012). This is not a
verified invoice or settled supplier cost. The original 60,000-micro reservation,
customer quote, wallet and raw receipts remain unchanged. The existing platform
`require_company_reserve` mode is preserved; in cash-reserve mode, activation
also requires its current cash and daily availability. The current customer-funded
mode does not establish funded company cash. The extra reserve survives rollback
and any later original settlement until a separately reviewed reconciliation.

## Release and verification

1. Run the ordinary isolation test plus the native localhost concurrency script.
   The fixtures execute the real monetary reservation and refresh claim bodies;
   contact ancestry and quota are explicit synthetic boundaries with their own
   existing regression suites. No paid development requests are permitted.
2. Install the matching migration inactive. Its exact deployed-claim predecessor
   hash must match. No records, requests, charges or exceptions are created by
   installation.
3. Privately inspect the exact original snapshot and calculate its SHA-256 using
   `contact_refresh_isolation_snapshot(refresh_id)`. After review, call the
   private `review_contact_refresh_isolation(refresh_id, expected_hash, reference)`.
   It captures only one pre-November-15 completed discrepancy, still inactive.
4. Require canonical exact-head and exact-main CI plus matching production web
   and worker release. Then call the private
   `activate_contact_refresh_isolation(expected_hash, release_sha)` as the
   operator. The SQL binds the reviewed snapshot and current claim body; the
   release SHA's deployment evidence is verified by the release operator, not
   inferred by the SQL function from its shape. Normal service credentials have
   no execution or table-write access to these private controls.
5. Verify unchanged original evidence and reserve plus the one additional
   planning reserve. Observe ordinary production claims, settlements and actual
   reminder delivery separately. An isolation activation or a claimed check is
   not proof of a delivered message, recovered seller or improved conversion.

Rollback sets only `contact_refresh_isolation.enabled=false` under the operating
budget lock. It retains the immutable review and extra reserve and cannot rearm
that activated exception. No historical receipt, contact, gap or pending send is
replayed. This repair only restores the existing prospective check lane; old
unsent introductions, stale underwriting and disabled senders still need their
own valid source evidence and final admission.

## Installation receipt

Migration `20261115063019_customer_results_contact_refresh_isolation` was installed
inactive on November 15, 2026. No exception row was created by installation.
The deployed claim hash is `940542393d4b8ce51cf36f50aea6f0e6`; normal service
credentials cannot write the policy or execute its review/activation functions.
Offline PGlite and native PostgreSQL 17.6 concurrent-admission checks passed.
Activation still requires the exact release verification described above.
