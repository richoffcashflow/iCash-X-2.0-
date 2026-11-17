# Prospective executed-copy requests from title

This disabled adapter turns an explicit, complete, current request from the verified title recipient into one document-update task in the existing queue. It supports current executed purchase and assignment PDFs. It changes no terms, signs nothing, and grants no closing, deposit, cancellation, payment or disbursement authority.

The source foundation must be installed first (`title-original-source.sql`). The source-bound confirmation instructions compose with the separate closing guard. Application integration requires the expected-source argument on `completedSigningPdf` from the initial title-delivery snapshot repair. The adapter does not replace either source recorder, add a polling lane or change the task scheduler. Its migration is `20261116234038_title_executed_copy_requests.sql`, generated with the Supabase CLI; the identically maintained config file is `config/title-executed-copy-requests.sql`.

## Admission and completion

- The private policy starts disabled. Only sources originally received and captured after activation, within 24 hours, with authenticated request/account/deal/sender binding, complete-body and subject hashes, and provider-original time qualify. Historical, incomplete, legacy, future or out-of-order messages remain ordinary review. A newer verified message, including an unsupported request or withdrawal, supersedes older copy authority.
- The entire current body must match the closed request grammar. Conditions, additional recipients, unknown instructions, quoted threads and hidden trailing conditions are refused. Greetings and short thanks may surround an otherwise exact request. Payoff, identification, entity and insurance requests become specific missing-evidence review labels; they never select a guessed document.
- The current title request must already have its nonempty original provider receipt and exact account/rate-bound dispatched operation, dated no earlier than request creation and no later than the original reply. The current verified recipient, live deal, actual completed agreement IDs, provider identities, frozen document terms and signing eligibility remain bound to the original source snapshot. Ambiguous multiple completed agreements remain review.
- Original reply time must follow each requested envelope's creation and finite verified signature observation. The observation must belong to that envelope's lifetime; an assignment also needs current deal terms and an observation after any completed assignment cancellation. A pre-cancellation, pre-replacement, pre-signature or missing-clock request stays review. A fresh verified request after the replacement is signed may qualify. These checks use the existing conservative signature observation, not an invented provider completion time.
- An existing assignment-update task with the same document is awaited. Its exact original dispatch and provider receipt satisfy the request without another send. The adapter never retries that operation. Unknown earlier copy sends block later copies even if someone dismisses the old task.
- Preparation loads only the exact supported PDFs. Each PDF read receives the complete expected envelope identity, creation clock, provider, terms, recipients and state; a transient replacement is refused before any provider GET even if the row is restored before final admission. Their combined decoded size must be nonempty and at most 20 MiB before the existing final title-update claim. That claim recomputes the source after loading and retains its account Pause, manual property control, contact, rate, budget, reservation and one-use operation checks. Read-only preparation failures retain the ordinary retry schedule; ambiguous provider sends never retry.
- Verified reply insertion takes the operating-budget row, then the request advisory lock before insertion/FK/closing triggers. Prepare, final claim and original-receipt completion use budget → request → task. A withdrawal that wins stops dispatch. A dispatch that wins keeps its original operation even if a later withdrawal arrives.
- The original request captures the full business-task snapshot, excluding only email delivery state, provider ID, retry and update clocks. Preparation and final claim reject changed work. The final receipt RPC journals the provider ID immutably, then completes only the unchanged task and clears review only for the still-current original source. A changed task association keeps its receipt in the private journal; manual edits, new work and later replies remain unresolved. A conflicting provider ID is rejected; saving the same original receipt is a read-only acknowledgement. Lost or uncertain provider outcomes retain reconciliation and cannot manufacture another send.

## Rollout

Keep the policy disabled while installing and checking the exact web and worker release. The transaction-owning migration runner must install the SQL and schema-history row together. This migration takes advisory lock `726341927`, uses a three-second lock timeout and fifteen-second statement timeout, and refuses changed predecessor source, owner, invoker status, volatility, search path or service ACL.

Expected source fingerprints:

| Function | Required before | Required after |
| --- | --- | --- |
| `icash_claim_title_update(uuid,uuid,jsonb)` | `d94aecc25f32e0af51cb9325637e2d2b` | `b5d5f5d7c15f592389db4505aa0ce343` |
| `icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb)` | `0f5dd97500fd3b3b096e166bd4096928` | unchanged |
| `icash_signing_action_allowed(uuid,uuid)` | `0c8dd6053164498e0f2e400d8e55d3b7` | unchanged |
| `icash_title_contact_matches(uuid,uuid,text)` | `4ca2faa138c0770ffeb5dcda10586020` | unchanged |

For the repaired receipt path, full-definition readbacks are `icash_finish_title_copy(uuid,uuid,text)` → `463697768c0870cdfb52067bc0893201`, `icash_prepare_title_copy(uuid,uuid,jsonb)` → `c9bafdfbcedfdedc8b2ffb83d4b7390e`, private `current_request(uuid)` → `fc9d11b1a73e6a4527e5e8a2e7d181ed`, private `envelope_source(public.icash_signing_envelopes)` → `83b97c7e61fdd547cced6df8c79ceb56`, and private `dispatch_source(uuid,uuid,jsonb)` → `9f98613dedbbe6a81bac49fa58c06632`. The public RPCs and private dispatcher are postgres-owned security definers with only postgres/service-role execute; current-source evaluation remains owner-only. Verify RLS and no application-role privileges on the immutable request/receipt journals.

After independent review and exact-release verification, the release owner may set the private policy to enabled with the canonical 40-character release SHA and a fresh activation timestamp. Do not backdate activation, replay old replies, reset old tasks or clear unknown operations. Disable the policy to stop new copy authority; retain original receipts and immutable source rows. The policy is inaccessible to application roles, and the immutable source table rejects update, delete and truncate.

## Verification

Offline checks:

```sh
node tests/title-copy-source-database.test.mjs
node tests/title-copy-delivery.test.mjs
node tests/title-copy-service.test.mjs
node tests/title-copy-receipt-service.test.mjs
node tests/title-copy-closing-composition.test.mjs
node tests/title-copy-document-source.test.mjs
node tests/title-update-service.test.mjs
node tests/title-service.test.mjs
node tests/title-followup.test.mjs
node tests/title-original-source-database.test.mjs
node tests/title-original-source-route.test.mjs
node node_modules/typescript/bin/tsc --noEmit --incremental false
```

`node scripts/test-title-copy-postgres.mjs` uses the existing isolated native PostgreSQL test server on loopback port 55443 and creates/drops its own randomly named databases. It verifies atomic migration rollback, competing migrations, actual service-role execution, both original/legacy source-first withdrawal races, claim-first original preservation, a task edit winning before late receipt persistence, a changed signature observation winning during the deal-row wait and concurrent account Pause. A composed fixture installs the actual closing guard and both insert locks, proving that a closing committed while copy admission waits cancels the unsent copy without deadlock or another operation. `ICASH_PG_MODULE` may point at the existing fixture-only pg module.

The database fixture uses the real source recorder, title task insertion and source-pinned original title-update claim. Its reserve/dispatch functions are explicit fixture sentinels; these checks do not re-prove the entire production financial stack. One service check uses mocked PDF/database/email boundaries for call order and unknown outcomes; a separate actual service→SQL test changes task business fields or associations during the mocked provider response, proves the original receipt persists, and verifies that edited work stays open without replay. No paid provider tests, production sends or live effectiveness claim are part of this change.

The document-source service test composes the actual copy SQL, update service and PDF reader. It reproduces a transient provider replacement restored before final claim, then proves the corrected path makes zero provider reads, reservations or email sends. It also covers delayed pre-replacement replies, missing/nonfinite signature clocks, current assignment terms, cancellation boundaries and a valid new request. Provider responses remain offline fixtures.

The release owner should register `title-copy-source-database`, `title-copy-delivery`, `title-copy-service`, `title-copy-receipt-service`, `title-copy-closing-composition` and `title-copy-document-source` in the shared local release runner, plus `scripts/test-title-copy-postgres.mjs` in the existing native database-contention job. The ordinary all-tests runner discovers all six suites. No new workflow lane or timeout increase is needed. Shared CI and release registries are integrated by the release owner.

The initial title-send repair remains a separate prerequisite and review scope. This adapter does not validate the full range of title correspondence or remove the possibility of a new change after final admission; a later withdrawal preserves the original admitted operation and its uncertain receipt instead of creating a replacement send.
