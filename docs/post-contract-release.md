# Post-contract preparation and complete cost settlement

## Delivered

- Railway automatically queues preparation after a verified, completed production purchase envelope. Test signatures cannot trigger it.
- Buyer-package and title-request drafts are generated once per preparation job. Retries do not duplicate documents. A stopped bot or property under manual control cannot save prepared work.
- Tenant-owned buyer profiles are filtered and ranked by the existing buyer engine. Entity deduplication, fresh criteria, proof-of-funds age, authority, market, property type, price and repair capacity are checked. A reviewed marketing release must reference the same purchase envelope, and the asking price must equal the saved purchase price plus assignment fee.
- Up to 50 ranked matches are stored, using a bounded input set of 500 recent buyer profiles. This is not a claim of nationwide buyer discovery or unbounded scale. Five names appear initially under the deal's expandable section; the saved count is shown. Profiles are never shared between tenants.
- Customers can download automatically prepared documents inside the existing deal card. Signed-deal document downloads no longer attempt to overwrite the executed contract first.
- `icash_settle_complete_costs` records an immutable itemized cost manifest and settles the existing operation ledger atomically. Every one of the 16 cost categories requires an integer USD-micro amount and evidence reference, including reviewed zero allocations. Conflicting replays fail; identical replays do not debit twice. Existing approved-charge caps, reservation releases and cost-overrun shutdown remain authoritative.

## Configuration and integration still required

Buyer profiles and marketing releases must be populated from licensed, verified sources by a server integration or reviewed service workflow. No buyer profiles or permission evidence were fabricated. This release ranks existing profiles; it does not purchase a new buyer list or contact buyers.

Cost manifests must come from verified provider receipts plus a reviewed overhead-allocation policy. An evidence string is provenance metadata, not independent proof of its contents. This release adds the complete settlement interface; invoice/usage importers for every provider remain to be connected. Partial ElevenLabs or DealMachine observations cannot be substituted for the complete manifest. The overall cost-settlement launch capability remains blocked until those imports and allocations are verified.

Title requests remain drafts. No email, text, deposit collection, title acceptance, closing, or wire is implied. Production signing templates and live acquisition configuration still require completion. The existing launch gates remain off.

## Operations

- `icash_buyer_profiles.criteria` uses the typed Buyer criteria from `lib/buyer-engine.ts`; boolean fields must be actual JSON booleans. Source references remain private to server storage.
- `icash_disposition_authorities` stores reviewed deal marketing terms and expiry. It cannot be supplied through customer requests or a voice tool.
- Preparation retries only deterministic internal work, never external sends. Once completed, it re-evaluates daily or after missing marketing authority becomes available.
- `GET /api/work/fulfillment?dealId=...` requires the current account to own the deal before reading documents or matches. It returns no provider keys or other accounts' buyers.
- The preparation scheduler admits at most one ticket per minute globally and batches 100 candidate jobs. Increase only after capacity checks; this is a conservative initial rollout, not the 100,000-user target.
- RLS is enabled and browser-role privileges revoked on all new tables/RPCs. Supabase's no-policy info is expected for these service-only tables. Its existing leaked-password-protection warning is unrelated to these changes; this product currently uses email-link sign-in.

## Verification

`tests/cost-manifest.test.mjs`, `tests/fulfillment.test.mjs`, rolled-back `tests/fulfillment-database.sql`, production build, and Supabase security review. No paid provider calls, live messages, charges or signatures were created by testing.
