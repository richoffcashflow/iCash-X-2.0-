# Shared seller memory and deal progression

The November 16 owner request is to preserve what a seller already answered across texts and calls, ask only useful missing questions, and improve acquisition and disposition follow-through without changing the customer interface. The owner authorized shipping the reviewed proposal. This release extends existing offer, agreement, recovery, buyer and closing workflows; it does not replace their authority.

## Resulting behavior

| Area | Existing foundation | Change |
| --- | --- | --- |
| Seller context | Bound SMS and recent call history | A private source journal and reproducible fact projection across the exact account, active deal and phone; older answers survive short context windows. |
| Answer interpretation | Qualification, refusal and listing rules | Recognize repeated affirmations, embedded price requests and narrow offer typos. Identity questions, reported speech and communication requests do not fill property or signer answers. |
| Corrections | Current-call refusal and source-bound offer state | Order actual speech and SMS timestamps, preserve newer corrections, and reconcile a text arriving during an active call before quoting. A different person must establish their own ownership and signer authority. |
| Channel continuity | Receipt-backed accepted offer and agreement ledgers | Preserve accepted price and source-backed closing details when channels change. Require the current exact agreement readback and delivery authorization. |
| Preferences | Existing callback, recipient and channel controls | Remember text/email/language preferences and distinguish a seller returning a call from requesting an outbound appointment. Unsupported email/language continuations get a specific review reason. |
| Follow-through | Original AI jobs, final financial/contact locks and provider receipts | Route prospective cash-interest replies into existing qualification; bind saved and queued proposals to the current memory fingerprint. |
| Inbound history | Provider-bound first/last 40-turn receipt | Retain the complete bounded source separately, including middle answers. Old clipped sources and new oversize sources are explicitly incomplete. |
| Machine screening | Existing automated/human evidence classifier | Recognize the isolated recording-system fragment while retaining later real human speech and opt-out precedence. |
| Deal priority | Due supervisor work and bounded fair batches | Keep the oldest fair slots, then prioritize signed and active closing milestones within the existing due window. |
| Buyers | Qualified match and permission checks | Rank ready permitted buyers first and select backups only from that same eligible pool. Expose qualification-needed IDs separately. |
| Measurement | Existing verified milestones and cost graph | Add same-deal 30/60-day cohorts with fixed mature denominators, immature cohorts separate, and explicit missing/capped costs and milestones. |

Showing confirmations, assignment authority, deposits, title events, actual proceeds, uncertain-provider recovery and reviewed prospective learning retain their existing implementations and final checks. A callback reply does not schedule a call. An email preference does not send email. A stored language preference does not establish that every channel supports it. Memory never grants contact permission, budget, ownership, price acceptance or signing authority.

## Evidence and limits

Canonical memory accepts provider/event-backed incoming SMS and delivered outgoing SMS, completed bound calls and saved inbound source receipts. Every extracted fact retains its original quote, question, source and time. The cache is optional, immutable and recomputed from source; a long exact quote can skip cache persistence without losing its answer. Account/deal/phone ambiguity returns no shared memory. Source caps return an explicit reconciliation hold, never a partial qualification result.

New call results preserve provider conversation start times. Historical sources lacking speech offsets use their available start/completion evidence; exact historic interleaving cannot be reconstructed. Old 80-turn inbound histories may have been clipped and remain incomplete unless a complete provider-bound source is saved through the normal path. No historical provider GET, customer replay or bulk retry is introduced.

Offline fictional scenarios cover paraphrases, unrelated answers, changed people, channel switches, full inbound history, source races, final dispatch invalidation, refusal precedence, exact agreement confirmations, account isolation, caps and missing cohort data. These tests do not prove live audio quality, email delivery, new customer signatures or higher conversion. Reporting has explicit gaps where the existing source lacks an event-time or quote-delivery milestone; it is not an automatic winner or financial admission signal.

## Ordered release

1. Review the complete final diff and integration with current main. Run the focused suites and required release checks. Preserve all seven canonical Reliability jobs and the normal exact-main production gate.
2. Install the six reviewed forward migrations once, in timestamp order: shared memory, memory routing, cohort report, supervisor priority, the recording fragment, then the snapshot screening index. The final index covers the separate screening foreign key; the account-first primary key already covers account references. Each migration owns no inner transaction; the migration runner must commit its ledger receipt with the source changes. Recheck every predecessor definition hash immediately before installation. A drift requires review, not removal of the guard. Never reinstall the first five when applying the separate index correction.
3. Read back the actual ledger, definitions, private-table privileges and `settings.enabled=false`. The memory/routing/priority cohort remains inactive. The narrow intent typo and recording-fragment repairs take effect when their SQL patches are installed; all existing authorization and receipt controls remain in place.
4. Complete normal PR head checks, expected-head merge, exact latest main-push checks, production READY/aliases and affected worker/monitor startup. Do not use preview success or a merge as live proof.
5. Select a bounded private cohort from current ordinary seller work. Save the reviewed account set and exact release evidence privately. In one guarded transaction set `enabled=true`, `enabled_at` to the actual prospective cutover, `account_ids` to that exact set and `release_sha` to the verified 40-character main SHA. Never backdate the cutover. Re-read the settings and source bindings. Activation schedules no customer work and resets no original operation.
6. Observe ordinary work read-only: source-binding failures, incomplete memory, stale-plan rejection, repeated questions, qualification-to-offer and verified downstream milestones. Count actual provider delivery/signatures separately from planning and queueing. Expand the cohort only after reviewing these current sources and the exact deployed version; retain the original cutover rather than replaying earlier replies.

For rollback, set only shared-memory `enabled=false` under the existing operator authority and record the actual timestamp and reason privately. Keep immutable sources, original offers, agreements, provider receipts and customer controls. A substantive parser or classifier regression requires a reviewed forward fix and fresh CI; do not restore a stale whole function over later changes. No paid simulations, customer wallet changes or new customer messages are part of verification.

## Regression entry points

`seller-shared-memory`, `seller-shared-memory-routing`, `seller-memory-priority`, `seller-memory-machine-evidence` and `deal-cohort-report` are registered in the local release suite. Existing seller text/voice qualification, agreement routes, dispatch, reception maintenance, buyer engine, learning report and receipt recovery suites remain required. Public fixtures contain only fictional sources; private customer transcripts and rollout membership must never be committed.
