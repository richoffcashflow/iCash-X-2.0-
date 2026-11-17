# Shared seller memory receipt chronology

This follow-up changes the evidence projection for the existing shared-memory cohort. It does not activate another account, alter settings, rewrite historical statements, send a message, replay a provider action, or grant financial/contact/signature authority.

The old SQL omitted unconfirmed outgoing texts, used outgoing creation time as question time, and allowed incoming ingestion time when original event time was absent. The actual old application consequently treated a delivered-later ownership question and an earlier seller “Yes.” as ownership evidence. Merely clearing the pending question was insufficient: a later unbound “No.” could leave older positive qualification facts ready.

The new context uses exact stored incoming event IDs, incoming SMS/MMS event types and numeric original event timestamps. It requires original time after zero, no later than now and within the existing five-minute receipt tolerance. Incoming times are truncated to milliseconds to match the application; missing original time or tied incoming times makes the source incomplete. Every outgoing state remains a boundary. A question is supplied only when the latest same-thread outgoing question has a provider identity and valid delivery strictly before the actual reply. Tied questions and reordered delivery remain unverified. An explicit empty agent question precedes every unpaired incoming statement, so an older delivered question cannot carry over.

Original user quotes and source IDs remain intact. Original outgoing quotes remain in `originalMessage`; receipt fingerprints cover original message/state/provider/event/times plus exact event ID/type/timestamp. The canonical fingerprint includes the version, raw source count and projected evidence. Old snapshots are immutable and never grant authority. Source changes reject stale cache writes. The 1000-source cap counts raw messages independently of the extra question row; the 1001st raw source remains an explicit overflow sentinel.

The `seller-sms-receipts-v1` capability separates source completeness from question certainty. The original application sees `complete=false` for any unverified relation and therefore holds during a rolling deployment. The updated reader accepts only the exact version, typed markers, unique raw source IDs/fingerprints and the original cap. Its qualification parser treats an ambiguous contextual response as uncertainty, retains explicit facts/refusals, and permits later verified clarification. Old unconfirmed sends therefore do not permanently prevent a subsequent fully qualified conversation. Optional cache writes remain disabled for contexts the original SQL cache guard considers incomplete; reads recompute from original evidence.

Unknown question timing retains the authority hold that prevents an accepted price or pending agreement from bypassing qualification. A typed clarification marker lets the text planner ask what the current reply refers to through its existing bounded reply and final admission path. It cannot sign, quote, reinterpret an uncertain negative as a counteroffer, bypass an unresolved original send, or override a refusal/listing restriction. Original accepted-price evidence remains intact while authority is held.

## Migration and verification

`20261116225713_seller_memory_receipt_time.sql` was generated with Supabase CLI 3.1.0 and matches `config/seller-memory-receipt-time.sql`. It contains no transaction boundary. The applying caller must atomically own the function change and migration-ledger insertion. The migration acquires shared advisory lock `726341927`, uses 3-second lock and 15-second statement timeouts, and rejects any predecessor, owner or ACL drift. It changes only the selected SMS projection/declarations/completeness fields in `icash_seller_memory_context(uuid,uuid,text)`. The call-source and live-call selection blocks are unchanged.

Expected full function definition MD5 changes from `f1316a0d62155d6f61426b7419e52cf2` to `7a680dae86359988c3f70c705a3369b0`. Owner remains `postgres`; execute ACL remains `{postgres=X/postgres,service_role=X/postgres}`; stable/security-definer/empty-search-path/parallel-unsafe metadata and all other `pg_proc` metadata are preserved. Reapplication rejects. No settings/activation migration should be repeated.

Local fixtures use fictional data only, the actual context RPC, the actual current consumer, and a hash-pinned copy of the predecessor consumer. Native PostgreSQL additionally verifies atomic rollback after a failed synthetic ledger insertion, unchanged exact metadata, ACL-drift rejection, and two competing migrations serialized before source verification. The second runner rejects the changed predecessor. All fixture databases are disposable.

Run:

```sh
node --experimental-strip-types tests/seller-memory-receipt-time.test.mjs
node --experimental-strip-types tests/seller-shared-memory.test.mjs
SELLER_MEMORY_NATIVE_TEST=1 SELLER_MEMORY_NATIVE_PORT=55448 ICASH_PG_MODULE=/path/to/local/pg node --experimental-strip-types tests/seller-memory-receipt-native.mjs
```

Production application is a separate reviewed release step, after the complete combined target and required release checks pass. Apply the guarded SQL and updated uncertainty-aware application together; the old application safely holds any uncertain context until the new application is running. This is a scoped seller SMS correction, not proof of all-channel correctness.
