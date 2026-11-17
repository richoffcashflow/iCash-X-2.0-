# Original title email evidence

Title reply ingestion previously stored only database ingestion time and capped plain text. A delayed old email could therefore appear recent after processing. This foundation preserves the authenticated receiving provider's original message timestamp and complete-body evidence for consumers that need to distinguish original events from delayed delivery.

The title webhook keeps its existing raw Svix signature check, exact receiving-ID/mailbox/reference handling, authenticated provider fetch, DMARC result and retry deadline. It calls the new `icash_record_title_reply_source` RPC with the old arguments plus `p_source`. `lib/title-reply-source.ts` reads `created_at` from the authenticated received-email response, never from the webhook retry timestamp, caller text or a current deal snapshot. The [official receiving API](https://resend.com/docs/api-reference/emails/retrieve-received-email) documents that response field.

The immutable `icash_title_replies.original_source` object contains:

| Field | Evidence |
| --- | --- |
| `version`, `revision` | Schema version and database capture sequence; the sequence is not original event chronology. |
| `providerReceivedAt` | Original provider timestamp, or null when missing/invalid. |
| `webhookEventId` | Identifier from the verified Svix delivery. |
| `bodyComplete`, `bodySha256` | Pre-truncation completeness and SHA256 of the exact original plain text; database capture checks the hash and length again. |
| `providerEmailId`, `accountId`, `dealId`, `requestId`, `sender` | Bindings derived from the existing authenticated recording logic, overriding any extra caller metadata. |
| `subjectSha256` | SHA256 of the exact stored subject. |

Only newly recorded, authenticated, request-bound title replies receive this evidence. Existing records, old RPC calls, qualification replies and quarantined mail retain `{}`. A source-update trigger forbids replacing metadata or backfilling legacy rows. Ordinary `needs_review` updates remain supported. Provider-ID uniqueness preserves the first original even during concurrent duplicate delivery.

This captures evidence; it grants no new action authority and does not change a closing, agreement, funds, manual flag or send. Its original recorder still accepts the existing `dispatching`, `sent` and `needs_review` references for inbox preservation. Consumers must separately enforce their current request/receipt, sender, agreement/cancellation, effective-event date and permission requirements. Missing, incomplete, stale or mismatched source evidence must not be replaced by ingestion time or a current-envelope snapshot. The separate stale-closing guard is required to change closing admission; this foundation alone does not repair that decision. The larger executed-copy adapter remains separate and is not activated here.

## Migration and rollout

CLI-generated migration `20261116231524_title_original_source.sql` matches `config/title-original-source.sql`. The runner owns the transaction and history receipt; there is no embedded `BEGIN`/`COMMIT`. It takes advisory lock `726341927`, uses 3-second lock and 15-second statement limits, and requires exact old recorder MD5 `7099858010d088ee8a70b57e2741e9ac` with postgres ownership, invoker mode, volatile/unsafe metadata, empty search path and the postgres/service-only ACL. The old function remains identical. The new RPC's checked MD5 is `0f5dd97500fd3b3b096e166bd4096928` with the same checked metadata and ACL.

Install this foundation before a dependent closing guard or application release that calls the new RPC. A guard must handle legacy empty evidence conservatively. Verify the exact reviewed application/database release before claiming the fix live. No historical email retrieval, replay, workflow reset, document send or paid test is part of installation.

## Verification

`node tests/title-original-source-database.test.mjs` executes the actual old/new recording functions and existing title-task triggers in PGlite. It checks original timestamp/body/account binding, unchanged historical replies/tasks, duplicate preservation, malformed/capped metadata, unverified and qualification routing, immutable evidence, private ACLs and metadata drift rejection.

`node tests/title-original-source-route.test.mjs` executes the actual route with independent signed webhook fixtures and mocked provider reads. `node tests/title-reply-source.test.mjs` checks timestamp/completeness normalization. Existing title-inbound, support-intake and purchase-engagement regressions also pass.

`ICASH_PG_MODULE=/path/to/pg node scripts/test-title-original-source-postgres.mjs` repeats the database suite on the fixed disposable `127.0.0.1:55443/icash_reliability` target, verifies bounded migration contention and observes two real service-role inserts contending on the same original provider ID. Both connection parameters and the actual socket/database are checked before fixture schema reset. No production connection, provider call, email or closing is exercised by these tests.
