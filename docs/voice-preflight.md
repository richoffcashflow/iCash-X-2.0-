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

At the 2026-09-30 inspection, database audit reported zero production voice configurations and no seller/buyer rate rows. Subsequent authenticated provider UI review confirmed a distinct Production agent, two callback/handoff tools with matching routes and per-call capability variables, both outbound public and inbound Twilio numbers, a 600-second cap, required runtime overrides, authentication enabled, bursting disabled, and the inbound initiation URL. This establishes existing provider resources, not a matching runtime hash, verified costs, functioning forwarding or a completed call. The account was on the Free plan, which the provider explicitly excludes from commercial use; an optional Starter checkout was opened but no subscription was purchased by the inspection.

## Provider references checked 2026-09-30

- [Get phone number](https://elevenlabs.io/docs/eleven-agents/api-reference/phone-numbers/get): returned phone identity, provider and assigned agent metadata
- [Twilio native integration](https://elevenlabs.io/docs/eleven-agents/phone-numbers/twilio-integration/native-integration/): purchased numbers support inbound/outbound; verified caller IDs are outbound only
- [Agent costs](https://elevenlabs.io/docs/help-center/product/eleven-agents/how-much-does-eleven-agents-cost): account-plan voice usage and separately passed-through LLM costs

The check intentionally does not invent a dollar rate from these public pages.

## Bootstrap hash inspection before a configuration exists

Run `node scripts/voice-provider-inspect.mjs <agent-id> <phone-id>` only in the existing trusted server runtime. This performs two GETs and emits a sanitized `ICASH_VOICE_PROVIDER_INSPECTION` record with the exact SHA-256 used by dispatch, duration, voice and tool IDs, authentication status, Twilio provider status and caller-ID match. It does not output the underlying prompt or platform settings. IDs are validated before network access; all failures are generic. The test suite uses fixtures only.

For a one-time build diagnostic, prepend that command to the existing build command, inspect the private build log, then restore the build command. Do not install it as an unauthenticated API endpoint or publish log output. A provider read does not authorize or enable an account. This inspection is not performed automatically by normal builds.

Current official billing docs distinguish new prepaid PAYG from legacy usage billing: new subscriptions can purchase extra prepaid credits lasting 12 months, while legacy Starter subscriptions cannot. Never enable automatic top-ups or additional charges without an explicit budget. Starter was displayed as $6 USD/month plus applicable tax, 75 included call minutes, six concurrent calls and a commercial license. Hosting was $0.08/minute; LLM and telephony costs remain additional. Cancellation takes effect at the end of the cycle; refund eligibility requires a request within 14 days with no quota used. Check the final checkout before any purchase.

- [Commercial-license restriction](https://help.elevenlabs.io/hc/en-us/articles/13313564601361-Can-I-publish-the-content-I-generate-on-the-platform)
- [Current billing, PAYG and cancellation](https://elevenlabs.io/docs/overview/administration/billing)
