# Seller agreement memory admission

This is a source-only candidate. Its actual-function PGlite and PostgreSQL 17.11 suites pass. The migration has not been installed in production. Independent review and the ordered receipt → atomic admission → raw-source application/database composition remain release requirements.

Automatic seller agreements in the existing shared-memory cohort retain the exact canonical source fingerprint reviewed by the service. The six-argument claim RPC accepts that fingerprint for immediate creation; it cannot authorize later memory refresh. The seven-argument claim also retains an immutable live-call prefix proof for narrowly reviewed completion of that same original call. Enabled-account deferred delivery requires a valid nonnull seven-argument prefix before a confirmation or queue can be created. Old five-argument calls hold for enabled accounts and preserve disabled-account behavior. None has overlapping default arguments.

The exact prefix is `{version:'seller-call-prefix-v2',conversationId,pairCount,turnCount,fingerprint}`. Application code hashes the start epoch milliseconds and every original ordered speaker turn, including full agent prompts and optional agent clocks. It must verify the complete original confirmation and independently neutral suffix; SQL validates the exact proof shape and immutable equality. A previous confirmation without an original admission cannot gain retrospective proof. Pair-only v1 proofs are rejected.

The private receipt binds the original confirmation, account, deal, screening, phone, call, canonical source manifest and live-call identities. It does not replace original offer, signer, contact, financial, Pause or cancellation admission. The public canonical memory projection and generic cancellation-only signing guard remain unchanged. The final document-create boundary is `icash_begin_signing`; a new source committed afterward can leave the one original provider document created, but the final contract-text claim must hold. This change must never expire or recreate that original solely because its conversational source changed.

Source writers serialize on the existing recipient advisory key 74 before their source row changes: authenticated SMS ingress and delivery receipts, outbound result persistence, legacy/full inbound history, memory retention, and terminal inbound call clocks (both the outer worker finisher and its transition). Existing budget locks remain before recipient locks, which remain before deal/source row locks. The actual original claim, handoff, viewing-capture and membership dependencies are captured and pinned; none introduces a late budget lock. Enabled legacy-history retention is narrowed to the fenced account/screening/contact. The admission helper rejects a newly committed source that the public projection would omit behind the transaction's earlier `now()` boundary. The ordinary final text claim already holds the same recipient lock.

Missing terminal transcripts hold only the enabled admission's exact account/deal/screening/recipient binding. This conservative check includes historical matching terminal sources; a missing older source does not silently become evidence of consent. It does not change the enabled cohort or inspect another recipient under that lock.

The exact original contract-link message is excluded from its own fingerprint only after matching the saved confirmation, envelope, signer, thread, phone and strict contract-link shape. Seller replies and every unrelated outbound message remain in source evidence. Missing or ambiguous admission evidence holds automatic creation and delivery.

The later raw-source protocol deliberately sets legacy completeness fields false when voice sources exist. The private admission helper recognizes only `seller-call-source-v1`, validates full voice coverage and the exact nested SMS receipt protocol separately, and recomputes the canonical fingerprint including version, completeness and the exact exposed cutover JSON value. Owned-link removal preserves that same fingerprint format. Deferred manifests additionally bind these raw metadata fields, so a deployment/cutover change cannot masquerade as completion of the original call. No public memory interface is changed by this migration itself.

Deferred recovery may refresh only the original source fingerprint after the application proves the immutable call prefix, original consent/price/recipient and neutral remainder. SQL also requires the same nonoriginal source manifest, original completed call identity, expected fingerprint, live-call identities and an unchanged claimed original recovery without any purchase envelope. Missing prefix proof cannot be invented retrospectively. Every accepted refresh has an immutable journal row; no workflow flag or prior provider operation is reset.

An original provider document already created before call completion remains preserved. Refreshing its unsent contract text after a later neutral completion is intentionally held and requires separate bounded work; this candidate does not broaden financial or document resumption.

`scripts/build-seller-memory-admission.mjs` reconstructs byte-identical config and CLI-created migration from captured predecessor definitions and the reviewed body file. Those fixtures contain function definitions and metadata only. The migration pins 26 exact predecessor definitions and their individual ACLs, plus 39 result definitions/ACLs and private table ownership/RLS/privileges. It runs once in the migration runner's transaction with its ledger, shared advisory lock, 3-second lock timeout and 15-second statement timeout. The generic cancellation-only signing guard and public receipt context retain their exact original definitions.

Deferred recovery waits for its completed original call before consuming the queue
claim, even when a still-live call has an unchanged memory fingerprint. The
readiness predicate runs before ordering and the candidate limit, so an older
waiting call cannot occupy the slot needed by another completed original. Terminal
calls without their complete source remain queued; completion is not inferred
from a heartbeat, timeout or an ingestion receipt. Full prefix, neutral suffix,
identity and exact terms review still occurs before the original is refreshed.

After the provider creates a deferred agreement, recovery binds that exact
successful original to its original confirmation and recovery request before
calling the text service. The private operation takes the existing budget and
recipient fences, checks current source, owner/controls, terms, recipients and
single original envelope, and creates no document, message or spending
authorization. Outcome recording cannot later clear or replace that binding.
The request must still be unexpired at the final attachment write after all
confirmation, envelope and screening lock waits. A refused binding may retain a
held result and original provider reference, but its outcome finalizer cannot
promote the confirmation to ready. Successfully bound original receipts remain
recordable after a later source change without clearing that later review.
The verified owner email is also checked after the last row lock, so an email
change during that wait cannot authorize the old owner recipient.

The final sender also requires current confirmation authority for an automatic
memory-admitted contract link whose confirmation has not yet been attached. This
closes the rolling older-worker path through an otherwise eligible financial
screen. The existing linked-confirmation guard, ordinary financial admission,
manual creation, explicit customer-authored text and disabled-cohort behavior are
preserved. A source or control change before binding or final text still holds
the original without recreating it.

An already-created original followed by neutral call completion still requires a
separate original-only text recovery protocol; this change does not refresh that
post-create admission, rearm a message or interpret a changed term as consent.

The unpublished migration remains `20261117032255` and precedes the unchanged raw
source migration `20261117035504`. Its config/migration SHA256 is
`3cca3ec80cc218ce790f62d9b64a1e345538c988e3f0b6dcabed77425c73b6c4`.
Compared with the earlier unreleased admission patch, only these result pins
change; every existing function retains its original owner, privileges and
execution metadata:

| Function | Earlier MD5 | Corrected MD5 |
| --- | --- | --- |
| `review_ready(uuid)` | `500f2556dbb6f0c87a13b005f00a7248` | `844ababee52617fb7e161403e53d6324` |
| `icash_claim_text_before_owner_question(uuid,uuid,text)` | `2ab7c58cc5a38b95651bb0ecb054d40d` | `fa1ad5bd705e2c7668eee0af1723a340` |
| `icash_finish_agreement_delivery_recovery(uuid,uuid,jsonb)` | `88c280613085bf4bcbf73ca9a2f3ce91` | `0b6ddd9a1210269482b7ab5f1226c68e` |
| `icash_bind_agreement_delivery_envelope(uuid,uuid,uuid)` | New private service entry point | `cb5fa9a1e1facee5eb005c5b16f45dca` |

Validation:

- `node --experimental-strip-types tests/seller-recovery-binding.test.mjs`: failed binding followed by positive or held outcome recording, queued and unqueued original links with eligible financial state, and accepted original receipts retaining later review.
- `node /tmp/icash-disposable-postgres-runner.mjs /workspace/scratch/bee561243973/seller-deferred-completion-ready scripts/test-seller-joint-memory-postgres.mjs`: full composed migration pins and native concurrent source/binding/text orders, recovery expiry across confirmation/envelope/screening locks, and owner email change during the last screening lock wait. All passed; the runner stopped its cluster.
- `node tests/seller-atomic-memory-database.test.mjs`: actual claim/defer, text-only admission, final creation/text boundaries, service-role execution, immutable proof and recovery CAS, owner/ACL/source drift, caller transaction/ledger rollback, compatibility, raw protocol positive path and 20 malformed holds.
- `node /tmp/icash-disposable-postgres-runner.mjs /workspace/scratch/bee561243973/seller-atomic-restored scripts/test-seller-atomic-memory-postgres.mjs`: same core cases plus native observed recipient-lock waits for actual SMS ingress/receipt, outbound result, legacy/full inbound history, cache and terminal writers in both orders, a source committed after the claim transaction began, unrelated-recipient progress and migration lock rollback. The runner stopped its own disposable cluster and confirmed port 55443 free.
- Financial/provider transport remains explicitly offline fixture sentinels. Legacy repeated-history/cache contention cases prove serialization and unchanged authority, not fresh legacy content admission. Raw protocol cases use a clearly marked synthetic version wrapper over the actual receipt projection; actual raw migration and application-level prefix semantics require the separate composed integration suite.
