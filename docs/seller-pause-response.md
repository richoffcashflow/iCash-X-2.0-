# Honor a seller's request to pause

The existing no-response text offers the seller a choice to continue or pause, but the source classifier returns no disposition for the reply `Pause`. The proposal adds a whole-message pause rule in the shared TypeScript and PostgreSQL classifier. `Pause`, polite variants, `pause here` and `pause for now` return the existing `review` disposition.

This reuses the existing account/property-scoped response hold. Fresh verified SMS, completed outbound or inbound call history, and authenticated bound seller email stop automatic pursuit through the existing observer and final-admission controls. A pause does not add permanent phone/email suppression or revoke contact permission. Reserved, attempted or unknown provider operations retain their existing receipts and reconciliation. Ordinary subsequent replies do not silently clear the hold. Existing STOP/unsubscribe rules retain priority.

Whole-message matching intentionally excludes `Pause the contract`, `Pause recording`, `Pause the closing`, quoted/negated instructions, questions and conditional changes. Those retain their current handling and receive no new legal, financial or channel authority from this patch.

## Source and release prerequisites

This is a separate, uninstalled candidate. The migration changes only `icash_seller_response_disposition(text)`, preserving its OID and metadata. Before installation it requires these exact source hashes, postgres ownership, immutable invoker execution, empty search path and only postgres/service_role execution grants:

| Function | Required MD5 |
| --- | --- |
| `icash_seller_response_disposition(text)` | `8e47d476f60a9e74fa6f2a6c460efdb8` |
| `icash_seller_direct_response_match(text,text)` | `bab353cb54bf841c9c9d3e19c1a8277f` |
| `icash_seller_contact_stop(text)` | `45076f5ffc443238ddf92cc79c1a10ba` |
| `icash_seller_hard_stop(text)` | `f43428ed584e281c0e02ea537b83d55d` |

Live read-only checks on November 17 at 12:51 p.m. Central confirmed these source and metadata prerequisites. They must be rechecked before installation. The installed hard-stop branch from PR #765 remains unchanged. Its application release is separately pending; this candidate does not claim complete current-main/production classifier parity or deploy that PR.

The test-only hard-stop predecessor is the exact `config/seller-hard-stop-policy.sql` from PR #765 commit `1b349a6132c47278f1ac2de5120600711a9c19a6`, Git blob `9f55d8d7468158cae92d0836aa4d9b4c911b1378`. It is not a new installation migration and must never be applied again to production.

Expected changed function hash: `81b691c8440429fa9c7f057cf70306bf`. The helpers remain unchanged. The matching configuration/migration SQL uses the transaction-owning runner; source installation and its migration receipt must commit together. After all canonical checks pass, reverify current production source and downstream observers and coordinate with other seller-response changes. Install the new SQL once before releasing the matching web/worker TypeScript; the SQL is compatible with the existing application. Any changed source or authority rejects installation. Never replay historical replies or send a test message as part of installation.

The separately observed historical `Pause` reply remains a distinct source-bound operational correction; this candidate does not mutate it or claim it has been repaired.

## Verification

- Shared policy suite: 153 text cases and 204 call cases total. Existing regressions run on the main-branch baseline; the 26 new pause cases then run against the exact installed hard-stop predecessor and verify SQL/TypeScript parity for the new pause rule. Coverage includes text analysis, ingestion opt-out behavior, live call result and address-intake no-send checks.
- Existing negative-response database fixture: fresh SMS, outbound call, inbound call and authenticated email exercise the real source-bound observer, queued-work cancellation, final call/text admission, tenant isolation and unchanged uncertain/provider-owned work. Pause remains reversible and never becomes global suppression.
- Native PostgreSQL 17.11: 29 focused policy cases, same function identity/ACL, permission-drift rejection, rollback of source plus migration receipt, one-time application and service-role/anonymous access checks. Each invocation creates and removes its own disposable database.

These are offline fixtures. They do not establish live call timing, recipient delivery, or production recovery. No production writes or paid provider requests were performed.
