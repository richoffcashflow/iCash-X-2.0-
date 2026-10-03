# Customer-requested U.S. ZIP research

A funded, authenticated customer's exact five-digit ZIP saved in city/custom-market mode can now be resolved outside the default shortlist. This is a property-research geography lookup, not contract coverage or contact permission.

The account load calls a bounded server resolver after attaching the customer's saved setup. The resolver makes only DealMachine `GET /v1/locations?q=<exact ZIP>&type=zip_code&per_page=100&page=1`. It accepts exactly one matching ZIP, matching provider location ID, a real U.S. state or DC, a bounded location name and a safe nonnegative property count. A positive property count is required before that geography enables research. No neighboring ZIP, prefix inference, arbitrary URL or unverified fallback is accepted. This endpoint consumes no provider credits according to the current [provider documentation](https://api.docs.dealmachine.com/api-reference/locations/list-locations).

Verified geography is held in a service-only, RLS-enabled cache for 30 days. Missing/zero-inventory results hold the market and retry no sooner than an hour. Failures or abandoned requests hold a ten-minute lease. Cache misses are capped at five per funded account/hour and 50 globally/hour, in addition to the existing provider request limiter. No nationwide enumeration or mass paid queries occur.

The source-defined provisioner attaches the saved funded setup before selecting a default, so an explicit unresolved ZIP is not silently replaced by a shortlist market. A successful lookup provisions only the requested ZIP. The original 15-ZIP shortlist remains default allocation priority and is unchanged. Existing configurations are never moved or re-enabled: if a customer has a different existing configured ZIP, research holds pending an explicit configuration change. This release deliberately does not implement in-flight market switching or resolve arbitrary city names outside the shortlist.

Funding, wallet balances, daily/lifetime limits, data-rights expiry, pause and explicit Start remain separate. No lookup reserves paid spend. After the free estimate, a service-only RPC locks the operating budget, account, discovery configuration, saved setup, provider geography and rate. It revalidates the exact ZIP, revision, page, quantity, unit allocation, rate, data-rights expiry and saved market snapshot, then invokes the existing reservation and one-use claim inside the same transaction. Wall-clock expiry checks run before and after claim; a failed claim rolls back any new reservation. The claim commits the authorized in-flight operation; it does not make a later provider request recallable. Contract template selection, signer/terms binding, signing authority, and contact/STOP/DNC checks are unchanged. The cache records provider geography and availability only; it contains no legal-review flag.

## Rollout

Apply `config/requested-property-zip-resolution.sql` after `config/research-contract-separation.sql`, then deploy the matching service and account/readiness changes. Do not subsequently apply an older pre-voice provisioner or the superseded contract-before-discovery patch. The SQL installs empty cache infrastructure and does not query a provider, call the provisioner or change any account row. It is safe to reapply. No new credentials are introduced.

A deployment verification can inspect the installed service-only ACL and call the authenticated account flow for a customer who has actually requested an unsupported-by-shortlist ZIP. Confirm the returned exact provider geography and preserved pause before any explicit Start. Do not seed fabricated provider results, change a real customer's requested market for testing or make paid nationwide searches.

## Tests

- `npm test`: parser/service tests include exact-code matching, bad state/provider ID/count, duplicate/oversized responses, cache reuse and provider failures.
- TypeScript and webpack production build.
- `node --experimental-strip-types scripts/test-requested-property-zip-pglite.mjs /absolute/path/to/pglite/dist/index.js`: actual SQL/service simulation of customer ZIP 94103, one intercepted free metadata GET, cache reuse, funding-time setup binding, one-ZIP provisioning, preserved wallet/pause/operator holds, owner/token/negative-cache/expiry checks, profile mismatch hold and a later explicitly started reserved property search.
- The PGlite suite also changes the requested ZIP, setup/config revision, page, rate, quantity, unit cost, data-rights deadline, geography expiry and operator hold during the intercepted estimate. All are held with zero paid dispatches and zero reservations.
- `bash scripts/run-requested-property-zip-postgres.sh`: real PostgreSQL 17 separate-session tests prove concurrent setup/config changes block and then fail validation, wall-clock expiry during lock waits fails, expiry during reservation rolls back wallet holds, scope locks survive the reserve/claim transaction, and duplicate claims do not replay. Uses the already-installed local test toolchain and loopback only.
- Existing independent-discovery and research/contract-separation PGlite simulations remain passing.

All test provider data are synthetic. Tests prove the path and guards; they do not establish live inventory coverage for every ZIP or state. Full customer-journey simulation retains the unrelated voice-fixture failure documented in research-contract-separation.md.
