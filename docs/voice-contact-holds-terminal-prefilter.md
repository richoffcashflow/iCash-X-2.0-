# Voice contact hold terminal prefilter

## Incident and diagnosis

November 10, 2026 production errors at 01:51:12, 02:00:29 and 02:02:19 UTC were statement timeouts through `icash_voice_contact_holds`, active slots, outgoing capacity and ready voice issuance. This is separate from inventory-held research and prior workflow-selection isolation.

A bounded, read-only original SELECT plan produced 9,364 distinct candidates from 9,411 raw rows, probed terminal gate receipts 9,145 times and returned 53 holds. It took 253 ms with 69,244 shared buffer hits. Completed provider receipts often coexist with a NULL local `call_ended_at`, so selecting every NULL-ended recording admits thousands of already-terminal rows into deduplication and the final correlated exclusion.

## Change and proof

Only `public.icash_voice_contact_holds()` changes. The recording candidate arm now rejects the same exactly bound terminal gate/cost receipts before the final exclusion, and UNION ALL plus final DISTINCT performs set deduplication after exclusion. The original final predicate remains byte-for-byte unchanged, including ended calls, all rejection negative-evidence checks and the two different receipt bindings. Job/contact projection and the unstarted-issued-job exception are unchanged.

For a non-NULL operation and account, a matching terminal receipt on the candidate's own recording necessarily satisfies the original final NOT EXISTS exclusion. It is therefore safe to drop this candidate early. NULL operation/account values cannot equal the final correlation, so the early receipt exclusions explicitly require both values non-NULL. All other arms still pass the unchanged final filter. DISTINCT after a pure row-wise filter preserves the original UNION set semantics, including NULLs and duplicate contact/agent rows. No production uniqueness assumption is required.

No change to locks, capacity limits, incoming reserve, policy, source/consent/billing gates, job states, provider settings, quarantine, money or retry holds. The function remains SQL STABLE SECURITY DEFINER with empty search_path; CREATE OR REPLACE preserves OID, owner and ACL. The transaction-local selection snapshot remains non-authoritative: final admission still takes a fresh snapshot under the existing caller locks.

## Verification

- New PGlite suite: 98 gate/cost receipt combinations (five terminal statuses, nonterminal/missing statuses and mismatched/NULL identities), thirteen rejection variants, NULL candidates, duplicate arms, terminal/nonterminal siblings, cross-account isolation, unchanged evidence/metadata, incompatible predecessor/repeat rejection, quarantined unknown-contact holds, late provider identity, and fresh final admission after a stale selection snapshot.
- Synthetic 10,000-row completed history reduces candidate append output from 10,006 to 5 while EXCEPT ALL in both directions remains empty. Timings are diagnostic, not a native throughput guarantee.
- Existing stalled-voice-capacity, scheduler-reliability, pro-voice-capacity-database and voice-credit-admission suites pass. These include 138 capacity equivalence cases and unchanged final fresh admission.
- Same-snapshot production read-only comparison: original 53, proposed 53, bidirectional EXCEPT ALL differences 0.
- Proposed production SELECT plan: 60.5 ms and 7,993 buffer hits. These are individual read-only samples, not proof the deployed worker timeout is resolved.
- Native concurrent harness added to reliability CI. It compares original/optimized concurrent reads and checks an already-open READ COMMITTED transaction's fresh final capacity after another connection commits an incoming hold. A persistent reader also checks both terminal gate and cost receipt sources while a second connection holds their inserts uncommitted, rolls them back, and finally commits them; holds and fresh admission change only after commit. All writer transactions use an eight-second statement timeout. The focused PGlite suite is registered in the explicit release validator as well as auto-discovered tests. **Not run locally:** no native PostgreSQL/psql binaries or available apt package indexes. PGlite is not multi-session concurrency proof.
- Full application build/all suites, native CI and production rollout are not completed by this local artifact.

## Exact release prerequisites

1. Coordinate this isolated optimization with active reliability owners; do not deploy until its review and native PostgreSQL CI pass. Baseline inspected main: `e5da088e7c60a1c8a16ea448de8fd13dd247545b`. Recheck newer main and competing migrations before publication.
2. Re-read live function metadata and full definition. Mandatory predecessor MD5: `c02f30febf4d8615de5280a3256dc6fc` for `public.icash_voice_contact_holds()`. The migration fails closed on any different definition; do not remove the guard.
3. Compare live downstream definitions with `tests/fixtures/voice-contact-holds-downstream.json`; review any drift. Expected hashes: active slots `1ab6268023eaba1138a09be673d13a86`; final capacity `ec76711357fe24dbcd75a351f68acc85`; private snapshot `2d9e037c510cc91c9b5757c0d7177bfb`; snapshot capacity `5386ae4fdc36ac71e76d645e1907b314`; outgoing capacity `d105b750747c5536f1c5eb2c36787c1b`.
4. Confirm config SQL and CLI-generated migration are identical. Apply only `20261110021306_voice_contact_holds_terminal_prefilter.sql` through the authorized migration process, not a blanket pending-migration deployment. It uses existing advisory key 726341927, 5-second lock timeout and 30-second statement timeout; no new tables/indexes/permissions.
5. Capture exact function definition/hash and owner/ACL/volatility/security/search_path before/after. Expected optimized function MD5 from the SQL engine is `a5f7c3655b187355b164d7481305aa1f`. Run bounded read-only hold/slot equality and plan checks at the same database snapshot where possible, then observe ordinary general-lane progress and timeout counts. Do not restart the worker, replay jobs, issue paid tests or manually clear holds to verify.
6. Rollback, if needed, is the exact `tests/fixtures/voice-contact-holds-before.sql` definition under the same bounded transaction/advisory lock, after checking the installed optimized hash. CREATE OR REPLACE retains current permissions. Do not restore an old definition over unrelated later changes or modify historical provider evidence.

No production function was changed and no branch/PR was published while preparing this artifact.
