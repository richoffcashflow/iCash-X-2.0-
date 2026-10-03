# Standard contract template routing

The existing generic purchase and assignment forms are customer-available standard forms. The software does not require separate state or nationwide legal approval for these forms. Customers are responsible for choosing and reviewing their agreements.

## Change

- Add explicit `template_scope`: `state` for a configured state-specific form or `standard` for a generic form with a dynamic state field.
- Prefer an active, cost-eligible exact-state form, then an active, cost-eligible standard form with the same kind, counterparty signer count, provider and mode. Scoped uniqueness allows both forms to coexist even when the standard form retains the same historical state code.
- Select only the existing production DocuSeal pair, purchase 6101264 and assignment 6101265, as standard. Preserve the stored wording, owner approval record, timestamps, enabled flags, rate and field/signer mappings.
- Use the same availability logic in acquisition readiness and the transactional signing RPC. No duplicated state-approval records are created.

## Unchanged technical limits

The current standard pair supports one counterparty signer plus the customer. Additional required owners must not be dropped; a template with enough signer fields is required. Active template configuration, cost/rate validity, authenticated account ownership, complete deal fields, exact signer mappings, operation reservations, signing order and provider receipts remain required. Existing review-expiry columns continue to bound active template configuration; their presence is not a claim of legal or counsel review.

## Apply after review

1. Apply `config/standard-contract-routing.sql`.
2. Apply `config/standard-contract-template-selection.sql`.
3. Publish matching application code.
4. Read back the two scopes and verify `icash_market_contract_ready('38118',1)` is true and `icash_market_contract_ready('38118',2)` is false. Confirm only scope changed on the two templates, and check normal launch readiness.

These scripts do not send or sign agreements, change template content, enable live work, create credentials, alter the recording system or change scheduled jobs. Customer-owned PDF upload is a separate implementation and is not claimed by this patch.

## Verification

`npm test` includes generic/state coverage and actual signing/launch service fixtures without external requests. `node scripts/test-standard-contract-routing-pglite.mjs /absolute/path/to/@electric-sql/pglite/dist/index.js` exercises the actual SQL migration and RPC with isolated fixtures, including signer/account/stage/provider/rate/expiry gates, service-only privileges, idempotence and unchanged template metadata. No live contract was sent or signed.
