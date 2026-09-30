# Production voice preflight

Run `node --experimental-strip-types scripts/voice-preflight.mjs [account-uuid]` in the trusted server runtime that already has `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ELEVENLABS_API_KEY`, and `CONTIGUITY_FROM` injected. Do not copy credentials into chat, git, command-line arguments, or output files. This script must not be put in the public web build or an unauthenticated API route.

The script performs GET requests only. It does not provision agents, import telephone credentials, dial, create tokens, write database rows, grant contact permission, or enable automation. Output is account IDs and boolean checks, never raw provider configuration, numbers, prompts, contacts, keys, or provider errors. Missing configuration fails explicitly. A scoped invocation is preferable for larger installations; unscoped inventories exceeding 1,000 records fail rather than silently certify incomplete results.

It verifies the stored review expiry and exact provider conversation-config hash; production/practice separation; full-duration current seller and buyer cost rows with all ledger categories; configured Twilio outbound caller ID matching the public business number; provider duration; and required tool ID presence. `configurationVerified` is only these mechanical checks. It is not authorization to enable calling, proof of correct external tool definitions, proof of actual plan costs, or proof of inbound routing or end-to-end operation. These are explicitly listed as `notVerified` in every report.

## Remaining operator inputs

1. Authenticate to the existing ElevenLabs account and identify/create the dedicated production agent. Review prompt/disclosure, permitted overrides, selected voices, callback/handoff tool definitions and provider limits. Retain the private practice agent separately.
2. Verify the outbound imported Twilio caller ID is the Contiguity public number. The owned inbound Twilio line is a separate route; verify forwarding preserves caller ID and the correct production agent is assigned.
3. Review full-duration costs against the actual ElevenLabs plan, separately billed LLM usage, Twilio destination/leg charges, and ledger overhead. A public starting price is not an account-plan quote or all-in cap. Insert seller/buyer/incoming rates only after obtaining evidence and a review expiry.
4. Provision each intended account's reviewed agent hash, phone ID, tool IDs, selected voice approvals, rate references and expiry. Do not clone one account's permissions or offer authority into another account.
5. Configure inbound initiation authentication through the supported secure credential setup with explicit approval. Verify forwarding, route binding, overrides and provider failure behavior before enabling inbound service.
6. Obtain authorization for a bounded paid test to a specified owned/test number, then verify dial, disclosure, callback/handoff, saved result, exact provider costs and reconciliation. No live test has been performed by this preflight.

As of the 2026-09-30 inspection, the ElevenLabs cloud-browser session required sign-in; provider production state could not be verified. Database audit reported zero production voice configurations and no seller/buyer rate rows. These are runtime setup gaps, not proof that the provider account has no agents or telephone resources.

## Provider references checked 2026-09-30

- [Get phone number](https://elevenlabs.io/docs/eleven-agents/api-reference/phone-numbers/get): returned phone identity, provider and assigned agent metadata
- [Twilio native integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration/): purchased numbers support inbound/outbound; verified caller IDs are outbound only
- [Agent costs](https://elevenlabs.io/docs/help-center/product/eleven-agents/how-much-does-eleven-agents-cost): account-plan voice usage and separately passed-through LLM costs

The check intentionally does not invent a dollar rate from these public pages.
