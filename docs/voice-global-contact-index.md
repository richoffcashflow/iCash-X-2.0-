# Global voice contact lookup

Production already installed this exact SQL as migration `20261103190835`
(MD5 `69f2a3333c30bfaebca5993043b45b3a`). This release reconciles that ledger
identity and its tests; do not replay the migration. A later ordinary voice
timeout at 19:12 UTC occurred after installation, so this index alone does not
establish full scheduler recovery.

The November 3 scheduler timeout review found that the existing global
busy-contact exclusion scanned 30,654 operational contacts for each candidate.
The measured read-only target query took 14.148 ms and 1,725 buffer hits. Its
account-leading index could not efficiently locate a contact shared across
accounts. The separate capacity snapshot is captured once per issuer; its
cost must not be described as a per-candidate lookup.

The migration adds one partial index on `contact_key`, including the original
contact ID, account ID and DNC receipt ID, only for `channel = 'voice'`. It
checks the exact live slot-function and contact-view hashes and rejects an
already equivalent leading-key index. It changes no function, view, query,
permission, source binding, receipt or financial record. Cross-account unknown
calls, legacy contact permissions and the original DNC join remain intact.

The offline regression uses the captured function and view, 30,706 operational
contacts, 300,243 jobs and 26 source/hold cases. Its probe retains the measured
production target CTE, rather than replacing the target with a literal that
may produce a different plan. Default and reused generic plans must execute the
new index and reduce operational-contact rows examined by at least twofold.
The measured fixture went from more than 30,000 contact rows to roughly 410. Total-query
buffers and latency are reported rather than treated as fixed guarantees:
other unchanged joins can select a different order. Fixture measurements are
not a production latency promise.

The native PostgreSQL workflow repeats original-query equivalence, plan reuse
through index creation, late uncertainty and rollback, and unchanged function,
view, ACL and historical-row hashes. Native execution must pass in CI before
claiming that verification. The fixture uses a fixed disposable localhost
database and contains no provider transport or customer data. Actual service
release, scheduler/receipt timeout rates and completed work need separate
production verification.
