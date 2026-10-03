# Optional saved DealMachine national-DNC observations

This module is a local review candidate. Apply after both `config/operational-contact-eligibility.sql` and `config/operational-sms-eligibility.sql`. Applying `config/dealmachine-dnc-observations.sql` creates one **disabled and expired** source policy. It makes no provider request, purchase, contact, or policy-enablement change.

## What the evidence means

The adapter derives an observation only from an existing owned `icash_owner_contacts` result, its exact `owners:<account>:<screening>` dispatched/settled operation, the matching owner-enrichment rate/reservation, and all four saved DealMachine provider-credit observations. The normalized OwnerResult count/person-ID invariants are also rechecked. Immutable fingerprints include original operation/reservation/dispatch provenance; legitimate later settlement and reconciliation fields are excluded. The input RPC accepts only account, account-owner, and screening identifiers. It does not accept a phone number, DNC status, timestamp, hash, or arbitrary evidence.

The saved phone must explicitly report boolean `doNotCall=false`. Missing, null, string, unknown, and true values stay held; any conflicting duplicate status also stays held. Imported ownership/permission flags are unchanged.

DealMachine documents `do_not_call` as national registry status. Its documentation does not supply a registry version or provider-check timestamp, and the standalone DNC endpoint expressly excludes state-level lists. This module makes no paid call to that endpoint. [Response format](https://api.docs.dealmachine.com/concepts/response-format#phones), [DNC endpoint scope](https://api.docs.dealmachine.com/api-reference/phones/check-dnc).

- `checked_at` is a compatibility field containing the existing request-start lower bound from `result.fetchedAt`. It is not a claimed provider check time.
- Provenance records the original database save time separately from ingestion time.
- `providerCheckedAt` and `registryUpdatedAt` remain null.
- The source result's canonical JSONB hash is preserved. The reference is explicitly an application-derived idempotency key, not a fabricated provider-issued receipt ID.
- This establishes no independent legal verification, recipient consent, or state-list clearance. The trail is application-stored evidence, not a cryptographically signed provider attestation.

## Proposed activation, requiring a separate decision

Before any live activation, the root reviewer must inspect the SQL, privilege changes, source scope, and local test results. Separately decide whether this national-only saved observation is acceptable for the intended operational use and whether other required checks are satisfied.

If authorized, an appropriately privileged database operator would select the one source row with `evidence_kind='national_provider_observation'` and `observation_provider='dealmachine'`, review `max_observation_age_seconds` (disabled default: 86,400 seconds from request start), choose an explicit source-policy expiration, and enable that exact source. The application service role cannot enable or modify source policies or write arbitrary evidence. No activation is performed by this module or its scheduler wrapper.

The automatic wrapper ingests at most 100 previously unprocessed saved source records per pass, deriving account-owner IDs from current account rows, before invoking the unchanged core workflow. A retry never moves the original freshness bound forward. Previously ingested or quarantined source/result bindings are immutable. Invalid saved sources are quarantined once; processed and rejected bindings are excluded before the batch limit. Operational observations are explicitly rejected by the legacy independent-review approval and SMS-current-review paths. Policy disablement or expiration blocks final eligibility without changing any saved consent or review record.

## Local verification

Run `node --experimental-strip-types scripts/test-dealmachine-dnc-observations-pglite.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js`. All source and activation examples inside that test are synthetic in-memory fixtures, never production changes.
