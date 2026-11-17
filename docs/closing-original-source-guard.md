# Original title evidence and current closing agreement

The reproduced failure was a delayed authenticated `Status: closed` email for a cancelled buyer. Its original provider timestamp and effective date were seven days old, while the replacement assignment was one day old. The current outer cancellation wrapper checked ingestion time, so the actual recorder and closing trigger marked the replacement deal closed. The regression fixture first reproduces that failure with the original functions.

The repair requires the original authenticated body, hashes, provider time, request, sender and account binding from `title-original-source.sql`. Automatic confirmation also requires a sent original title request with a nonempty provider receipt and its exact account/rate/operation dispatch time at or before the original incoming email. A draft request creation time does not establish dispatch.

Each new milestone binds to a verified current agreement. The current assignment must match the deal terms and verified signer evidence. After a buyer replacement, automatic confirmation requires the exact `Agreement: <UUID>` line from the current executed-assignment email, a source time after cancellation and current signing, and a compatible effective event date. Closing requires the current buyer's deposit; later disbursement requires a prior closing bound to that assignment. A disbursement report does not prove bank receipt.

Provider signature evidence currently establishes identity and completion but has no authoritative completion timestamp. The guard therefore uses the stored verified-signing observation (`seller_signed_at` / `assignment_signed_at`) as a conservative chronology boundary, checked against the selected envelope's creation and cancellation. Missing or stale observations are held for review. A late observation can conservatively hold a legitimate earlier email; this patch does not infer an earlier signing time or rewrite original evidence.

The exact complete body must match the six-line original format or seven-line agreement format. Quoted history, duplicate lines, suffixes, incomplete bodies, uncertain delivery, absent source evidence, stale agreement references and cancellation activity cannot automatically advance closing. A specific durable review task retains the original reply. The existing explicit owner-confirmation path remains available for a legacy single original agreement; it still checks verified current signatures and effective chronology. Replacement confirmations cannot use missing original source evidence. Exact historical replay returns the old milestone ID without rebinding it.

The insert lock takes the operating-budget row before the reply's foreign-key checks can take a deal key-share lock. The actual confirmation and cancellation paths then use budget → deal → agreement locks. Native races verify that cancellation can win while ingress waits, closing can win before cancellation, and a queued old email cannot attach to a replacement installed by the winning cancellation transaction. No historical reply, agreement, deposit, control or closing row is changed; historical `agreement_envelope_id` values remain null.

## Install and source readback

Install the neutral source foundation `20261116231524_title_original_source.sql` first, then `20261116231836_closing_original_source_guard.sql`, using the existing runner's transaction and migration receipt. The config and migration files are byte-identical. The migration takes shared advisory lock `726341927`, a three-second lock timeout and a fifteen-second statement timeout. Exact predecessor source, owner, search path, volatility, parallel safety and ACL checks reject drift; the result block validates the new definitions. A second installation fails. A receipt failure must roll back the schema and definitions together.

The neutral recorder remains unchanged at `0f5dd97500fd3b3b096e166bd4096928`. New wrapper readbacks are:

| Function | Full `pg_get_functiondef` MD5 |
|---|---|
| `icash_auto_title_confirmation()` | `63236507bde755f228f0a444eab2d7ef` |
| `icash_confirm_closing_update(uuid,uuid,uuid,uuid,text,date,bigint,text)` | `428f8db977f64099fd46829983ca2098` |
| private `check_confirmation(uuid,uuid,uuid,text,date,uuid,boolean)` | `1778c902d0d17ff78a3034917425e593` |
| private `lock_confirmation_insert()` | `8ebc103ac3835db4a458705378b45752` |
| private `parse_confirmation(text)` | `aeabc2cbf54cb3eb168edaf650658d20` |
| private `review_reply(public.icash_title_replies,text)` | `59e2cbc135a25692e0872c800bb1ca15` |

All changed public wrappers preserve their original metadata and service-only execution. New helpers use an empty search path, invoker security and private schema; the trigger function has no public, authenticated, anonymous or service direct execution grant. There is no feature activation, backfill, replay or sender enablement in this migration. New outgoing instructions include the actual attached agreement UUID through `titleConfirmationInstructionsFor`.

## Verification

Register the focused fixture in the ordinary per-suite test runner:

```sh
node --experimental-strip-types tests/closing-original-source.test.mjs
node --experimental-strip-types tests/title-service.test.mjs
node --experimental-strip-types tests/title-update-service.test.mjs
node --experimental-strip-types tests/title-followup.test.mjs
```

Register the native script with the existing disposable PostgreSQL integration harness:

```sh
node scripts/test-closing-original-source-postgres.mjs
```

The native script validates the fixed disposable loopback target before replacing fixture schemas. It exercises actual recorder, confirmation and cancellation functions, source and ACL drift rejection, shared migration contention, migration-receipt rollback, private privileges, original history, idempotency, malformed and stale evidence, valid current original/replacement cases, disbursement sequencing and three concurrent cancellation/closing/replacement orderings. All provider calls are mocked or absent; no messages, paid tests or production changes are made.
