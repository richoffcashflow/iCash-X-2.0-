# Carrier SMS notice classification

A support report showed a whole automated message-blocking notice under “Seller replied.” The screenshot proves a presentation failure, not that an AI request, seller reply, charge or provider send occurred. The backend message/account identity and the screenshot's timezone were not inferred. All executable cases use fictional identifiers and telephone numbers.

## Scope and evidence

The shared SQL/TypeScript predicate recognizes only the complete attachment-free `Free Msg: Receiver <phone> unable to receive message - Message Blocking is active` scaffold, allowing ASCII case/whitespace normalization and terminal punctuation. Phone digits are a syntactic part of the known notice, not a verified customer identity. Unknown/shortened messages, attachment captions, quoted notices and mixed human text are preserved conservatively. NBSP/BOM and Unicode case lookalikes are not silently normalized in either runtime.

Raw messages, original webhook payloads, provider identifiers, dispatch/delivery receipts, suppression, STOP handling and cost evidence remain in their original tables. The classification does not manufacture consent withdrawal, permanent global suppression, retry authorization or a zero-cost outcome.

## Connected handling

- The authenticated webhook persists a matching notice through the original idempotent property inbox, before lifecycle, legacy or immediate Meta reply actions. Genuine opt-outs and delivery callbacks retain their existing path.
- Response interpretation uses service-only security-invoker views. New notices cannot supersede real AI work, advance conversational route revisions, create seller response attention, trigger seller actions or supply AI/voice dialogue. Raw routing/account checks and the original Meta unanswered-follow-up stop remain intact.
- Retained SQL delegates are patched as well as their outer wrappers. A later notice cannot hide a genuine human reply in ordinary acquisition, limited-contact replies, owner-confirmation/invitation admission or manual handoff. A real later reply/STOP still invalidates stale intent.
- Historical notice-source AI jobs are excluded before scheduler bounds and denied at claim, resume, queue, progress (including feature-off) and final operation admission. Already-started AI completion still saves its original analysis/provider/usage evidence. No saved spend hold is released, no accepted send is undone, and no failed or uncertain operation is replayed.
- Current work-value receipts and warm-seller priority ignore notice-source pending jobs, latest activity and suggested steps. Original spend, held credit, funding receipts and time windows remain unchanged.
- Response, unread, attention, latest-thread and cached opportunity projections are covered separately by `carrier-text-notice-projections.md`. Original immutable experiment assignments, allocation decisions and costs are not rewritten. Interest predicates skip notices only as source/intervening dialogue.

## Preserve narrow no-retry barriers

Reclassifying a notice as non-human is not permission to restart cold pursuit. The raw incoming evidence remains available to original recovery and delivery controls. The additional unresolved-notice check is source-bound to the exact account/thread's cold opener assignment, draft no-response gap outgoing message or unanswered Meta follow-up. It is not a blanket freeze on automatic messages: independent genuine-human-backed replies, requested agreements, signed work, manual messages and explicit cancellation notices retain their existing gates.

A later human reply does not prove outgoing blocking is cleared. For this narrow check only, clearance requires an actual same-account/thread original dispatch strictly after the notice's original event time, terminal `delivered` state, and the exact canonical confirmed-delivery event matching provider ID, sender, recipient and original delivery timestamp. Accepted/queued states, receipt-write time, earlier sends backfilled later or unrelated lines/recipients cannot clear it. Clearance does not turn the original notice into a human reply or replay its derived jobs. Existing consent, cadence, source, financial and one-use dispatch gates must still pass.

## Offline verification

- `carrier-text-notice-classification.test.mjs`: one shared SQL/TS corpus, including ASCII/newline, NBSP/BOM, case lookalikes, quoted and mixed text, unknown formats, attachments and STOP.
- `carrier-text-notice-flow.test.mjs`: actual retained triggers and final guards, original route/job preservation, historical scheduler/resume, feature-off guard, unknown cost preservation, strict receipt clearance and no cold-send reopening. The retained-delegate helper executes both outer/inner reply paths and original-versus-new human/agreement/cancellation/manual cadence eligibility. The old continuation fails on a newer notice; the corrected continuation preserves the real human source.
- `test-carrier-notice-postgres.py`: two real overlapping transactions in disposable native PostgreSQL. Notice-first final admission waits and denies with unknown cost untouched. Claim-first admission remains dispatched exactly once when the notice later commits. Private ACLs and raw records are checked. It does not accept a production database URL.
- `carrier-text-notice-support.test.mjs` executes actual diagnostics into customer-support evidence, correcting only reply counts while preserving outgoing traffic and budget values.
- `customer-work-value.test.mjs` reproduces the historical notice priority/last-work/next-step bug and checks preserved financial values, genuine-human priority and Pause.
- Inbound webhook suites exercise the actual route with provider/database doubles and exact raw-persistence failure handling. Projection/rendering/context suites and the separate native projection races cover the connected read surfaces.

The local installation rehearsal used current schema-only function definitions to check every literal patch boundary. It is not a complete production-schema rehearsal. Function updates fail closed on unexpected predecessor changes rather than replacing unfamiliar logic. Config SQL and timestamped migration copies must stay byte-identical. New tests are included in local release verification; no paid or live-provider test is part of this fix.

## Release prerequisites (not performed by these changes)

1. Independently review the final integrated tree; rebase/recheck current main and open work. Run exact-head Reliability, the normal full test/build checks in an adequate-memory environment, and both native concurrency suites. Scoped checks do not substitute for these gates.
2. Verify the exact installed predecessor definitions, table columns, ACLs and all retained wrappers. Install classification migration `20261108234000` then derived work-value migration `20261108234500`, before projection migration `20261108235000` and any follow-up projection migration. Projection repairs must succeed within their affected-row bounds and account-lock requirements; do not bypass aborts or apply only an application label patch.
3. Confirm PostgREST schema-cache relationships before releasing application reads. Native SQL/PGlite cannot prove REST embeds resolve. Using the existing authenticated read-only deployment context, request the actual query shapes below with a fictional UUID account filter and **top-level limit=0**. Require successful empty arrays, not a missing/ambiguous-relation error. Do not retrieve credentials or customer rows merely to run this check.
   - `icash_response_text_messages` with `thread:icash_text_threads!inner(id,party,paused)`.
   - Each of `icash_response_text_attention`, `icash_response_sms_call_requests`, `icash_response_seller_gaps` with `active_property:icash_screening_jobs!inner()`.
   - `icash_screening_jobs` with the actual property embeds/aliases for those three response views.
   - Both direct and nested seller-gap shapes with `completed_reminder:icash_text_messages!outgoing_id()`, preserving its original account/direction/delivery/manual predicates.
   - `icash_response_sms_route_reviews` as used by assistant context, and `icash_response_handoffs` with both the direct `active_property:icash_screening_jobs!inner()` join and nested `icash_handoffs:icash_response_handoffs!inner()` property embed.
   Repeat the existing bounded `check-workspace-attention-readback.mjs` release check in its authorized deployment context. If inherited relationships do not resolve, stop and implement explicit minimal relationship support; do not silently fall back to unfiltered tables.
4. Verify exact-main application/worker/database release identity and read-only application behavior. No customer support claim of correction or restored delivery is justified until actual deployment and matching account/message evidence are verified. Carrier delivery recovery is a separate unresolved condition, not a result of this classification repair.
