# Separate property research from contract capability

This change removes a contract-template dependency from property-only discovery and discovery provisioning. The configured ZIP/state still must exist, and the downstream signing service and SQL continue to require a current reviewed template for the actual state, document kind, signer count and mode. It does not create legal review, recipient consent or outreach authorization.

## Exact production delta

- `lib/discovery-service.ts`: the existing configured-market check applies in both independent and full-work release modes.
- `lib/discovery-channel-readiness.ts`: the property branch reports research readiness independently of contract-template availability. The contacts branch is unchanged.
- `config/research-contract-separation.sql`: source-defined replacement of `icash_provision_before_voice_template(uuid)`, applied after the existing funded voice and market contract SQL. It restores configured research-market allocation without contract coverage, preserves existing configurations/pauses, and retains service-only execution. It does not expand the shortlist or invoke provisioning for any live account.

The SQL is idempotent. It changes no other function or existing row. Do not reapply `market-contract-coverage.sql` afterward: that older configuration represents the superseded contract-before-research dependency. Deploy the reviewed SQL and application together; keep account pause state unchanged. Any account refresh remains governed by the existing authenticated account workflow.

## Preserved boundaries

- Existing enabled rates, paid funding, data-rights deadlines, exact operation keys, atomic wallet/company reservations, daily and lifetime limits, and unknown-outcome no-replay.
- Existing voice wrapper and reviewed production voice configuration.
- Existing contact/STOP/DNC, authority, recipient, signing and contract-state gates.
- Existing inventory cooldown and cross-account claim rules.
- No new flags, rate cards, funding, permissions, customer terms, provider calls, or mass searches.

## Coverage limit

This release is not all-50-state discovery. The current shortlist contains 15 ZIPs in TN, AL and TX, and arbitrary valid customer ZIPs remain held until configured. The existing separately scoped free market-research worker can discover ZIP metadata beyond the shortlist, but its tenant-scoped results do not grant paid-search eligibility or populate the provisioner.

A separate expansion should use the existing provider's authoritative location lookup to resolve the exact requested US ZIP/state, cache provenance and expiry in a service-owned geography registry, and use that registry for research readiness/provisioning. Keep the shortlist as default allocation priority rather than legal coverage. Never derive contract jurisdiction from ZIP alone: signing still uses the verified property/contract state. No paid record should be requested without the unchanged per-account budget and data-rights checks. Ambiguous/missing location results must remain held.

Provider reference: https://api.docs.dealmachine.com/api-reference/locations/list-locations . HUD-USPS ZIP crosswalk is an alternative authoritative dataset, but adds a separate API token/account setup: https://www.huduser.gov/portal/dataset/uspszip-api.html . Do not add new credentials implicitly.

## Validation

- `npm test`: includes the actual research/signing service boundary test.
- `node --experimental-strip-types scripts/test-research-contract-separation-pglite.mjs /absolute/path/to/pglite/dist/index.js`: isolated actual SQL/service test. Applies SQL twice; compares every other public iCash function byte-for-byte; simulates funded TN research with no TN template; checks preserved holds and rejects a TX signing template on a TN deal through both service and raw SQL. No external requests.
- `node --experimental-strip-types scripts/test-discovery-admission-pglite.mjs /absolute/path/to/pglite/dist/index.js`: independent discovery/one-use scheduler/regression simulation.

Full customer-journey simulation currently has an unrelated voice fixture failure (`property_context_override_review_required` versus expected `provider_outcome_unknown_no_retry`) reproduced on the unchanged base snapshot. Do not report it as passed.
