# Complete original seller call evidence

The original inbound projection discarded messages longer than 12,000 characters before calculating completeness. A 17-turn provider transcript containing a long refusal became 16 turns and could appear complete. Completed outbound rows with a malformed retained transcript could also disappear from canonical memory. The normal outbound writer already rejects a non-array transcript; the latter is a retained-record drift case, not proof that the ordinary producer writes malformed results.

The new, private adapter is disabled at installation. Once independently activated, it records the exact already-fetched provider transcript as UTF-8 JSON with its SHA-256, original turn count and byte count, provider conversation and agent identity, current original-call binding and completion clock. Speech is projected without clipping within 262,144 bytes and 1,000 original turns. Over-limit, missing and malformed sources become explicit coverage holds. Recognized agent-only tool entries with no message remain in the raw evidence but do not become speech; unrecognized or malformed speaker rows cannot silently disappear.

Original quotes are immutable. A repeated identical receipt is idempotent. A different receipt for the same original creates a separate conflict record, preserving the first source and withholding automatic authority. Missing, invalid and conflict coverage is visible even when the old projection omitted a malformed row. Legacy sources preceding the first activation are not backfilled or retroactively certified. The policy's first activation clock and release identity cannot be changed or backdated; disabling stops new raw-source behavior without deleting evidence.

Whole-content coverage and speech chronology are separate. Missing required user clocks, invalid provided clocks, backward or out-of-call offsets preserve complete quotes but remove timing authority. An absent optional agent offset remains null without erasing valid user offsets. The consumer must scan full original quotes for persistent human requests, opt-outs and review holds before chronological extraction, and must not infer a positive fact from the ingestion/completion time. This release therefore requires the canonical seller-memory consumer and persistent-hold repair. Later ordinary positive answers cannot erase a retained handoff or refusal. A later verified clarification may address ordinary unknown facts only within that consumer's existing rules.

## Saving and concurrency

Capture reads the original recipient, acquires the same phone advisory fence used by SMS and signing admission, and only then locks and re-reads the actual original call/session and immutable property binding. An identity change while waiting refuses the capture. Different recipients can continue independently.

Disabled raw policy and accounts outside the existing shared-memory cohort delegate to the original result saver without raw prerequisites. Fresh in-scope outbound completion uses `icash_save_live_result_with_source`: the unchanged, atomic-fenced result saver and full raw capture commit together. A capture write failure rolls completion back, leaving the ordinary original-conversation reconciliation available. The application preserves the original usage observations and attempts normal settlement before returning the original save error. It does not invent a zero cost, bypass billing or create another call. A later ordinary GET still targets the same saved provider conversation.

Incoming capture uses the already-fetched, verified conversation after ordinary usage settlement, even if every long message was excluded from the older display/history projection. It resolves the original inbound binding directly; absence of a clipped history row cannot erase the source. A failed capture keeps the original reconciliation retry and does not undo a completed usage receipt. An unbound receptionist conversation is not invented into a seller/property conversation.

## Release order and limits

Install the receipt chronology migration first, then the atomic seller-source admission/writer migration, then `20261117032153_seller_call_source_completeness.sql`. This migration pins canonical context `7a680dae86359988c3f70c705a3369b0` and atomic-fenced result saver `82af3a7c40a85cb346ad37f571b3fdca`, including their owner, invoker/definer, volatility, parallel mode, empty search path and exact service ACL. Config and migration files are byte-identical. The normal runner owns all DDL and the history receipt in one transaction under advisory lock `726341927`, a three-second lock timeout and a fifteen-second statement timeout.

Keep the policy disabled through exact application and worker deployment verification. Activation is a separate review of a prospective scope and fresh cutover; no existing shared-memory cohort or prior activation is changed. For every raw-mode voice history, the top-level legacy completeness flags remain false, including fully clocked calls. New consumers and atomic admission derive authority from the exact validated raw and SMS protocols. Old workers remain coverage-held after strict activation; they cannot use a partial old transcript as new authority. No historical provider reads, replay, sender reset, provider configuration, customer message, new financial authority or funds release is introduced.

The deterministic source, service-to-SQL and native PostgreSQL tests prove the documented fixture boundaries, original transaction rollback, recipient ordering, role privileges, source drift rejection and preserved settlement attempts. The full financial system and providers remain explicit offline boundaries. They do not prove a production call, signature or deal completed.

Root integration should register `seller-call-source-completeness` and `seller-call-source-maintenance` in the existing release suite list, and the native `tests/seller-call-source-native.mjs` with `SELLER_CALL_SOURCE_NATIVE_TEST=1` in an existing native job with application TypeScript dependencies. The ordinary all-tests runner discovers the two focused suites. Preserve buyer-package maintenance additions and all other suite registrations during integration.

## Installed function fingerprints

| Function | MD5 of PostgreSQL definition |
| --- | --- |
| Raw capture | `b4ca46d37504f33e691c816ac645857b` |
| Original saver plus raw capture | `750098bec1e8953c6e184fd7c959f74a` |
| Canonical context | `3aa28aa3e791861975e1fba6da67db2b` |
| Renamed prior context | `06ebfc0098dc2e86f0cd0d902617116e` |

The migration also pins all three private helper definitions and their metadata, verifies the unchanged atomic result saver, and verifies disabled empty private storage and denied application grants before the runner can commit.
