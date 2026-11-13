# Seller conversation and follow-through review — November 13, 2026

The production review found seller identity/price questions receiving generic clarification, explicit purchase-purpose questions returning to selling-interest qualification, listing references looping, and family occupancy not advancing qualification. Recorded outbound calls also repeated questions through screening audio or poor connections. The reviewed second-call/second-text policy is already active; increasing its frequency does not resolve these conversation gaps.

## Implemented behavior

| Seller interaction | Result |
| --- | --- |
| Who are you / do you have a name, including a price question | Answer with the saved buyer identity and AI role, then ask the actual missing fact. If qualification permits a quote, use the existing calculated proposal. Preserve its action so the next yes still binds to that delivered price. |
| Are you looking to purchase / purchasing? | Explain the potential cash purchase and continue the current qualification or terms step. |
| Terms as listed | Clarify agent representation versus selling by owner. No invented listing terms, representation status, ownership or acceptance. A yes/no to the either/or question stays ambiguous. |
| Depends on the offer; affirmative answer to the existing cash-interest openers | Recognize willingness to discuss price without inventing ownership or property facts. |
| Family occupied | Retain occupancy evidence and move to the next missing fact. |
| Never mind / forget it / go away | End this property discussion. Do not fabricate a permanent opt-out. A direct STOP sentence followed by another question is an actual opt-out. |
| Confirmed screening prompts, menus and unavailable announcements | Exclude automated audio from human-response evidence. Preserve later human speech, opt-outs and the original transcript. |
| Repeated poor audio on recorded outbound calls | One clearer attempt, then the bound recording-stop/end-call path. No invented callback or text promise. |
| No answer to a delivered offer-workflow message | Select a non-price reminder about the exact pending condition, price, proposal, terms, name, owners, date, inspection, listing, occupancy or timing step. |

Conversion routing is prospective, controlled by `icash_seller_progress_settings.conversion_enabled_at`. It requires a received, provider-backed source after the cutover and within the existing reply window. That flag participates in the existing context fingerprint; disabling it invalidates queued conversion plans at the final claim. Contextual follow-ups additionally require the exact delivered automated message, matching job/body/action, original account/thread/source, and the existing recovery state. They cannot enter the ordinary no-response experiment or be reused for a different gap.

The existing reply, recovery and claim chains retain contact permission, current checks, quiet hours, Pause, manual takeover, latest-source checks, suppression, spend admission, cadence, known costs and exact request idempotency. No old conversations are replayed, no contact evidence is renewed by this migration, and no rate, budget, price, provider template hash, contract form or UI is changed. New runtime call instructions are appended at recorded **outbound** registration; this does not claim to change the frozen inbound provider template.

## Verification

- `seller-conversion-followthrough.test.mjs`: reproduces the generic clarification before the patch; exercises the current production SQL context definitions, TypeScript planner, SQL save, final claim, duplicate rejection and synthetic delivery. Covers SQL/TypeScript intent parity; fresh cutover; ownership/listing/name/acceptance boundaries; follow-through after identity questions; late Pause/STOP/manual/expiry/disable; 11 follow-up actions; final body/source/receipt rechecks; service-only ACLs.
- `test-seller-progress-postgres.py`: existing receipt/Pause/negotiation contention plus 16 competing conversion plans, cutover-disable versus final claim, and 16 contextual follow-up preparations. Exactly one reply and one follow-up attempt; no providers.
- Response-policy, call-contact-evidence and actual recorded-provider transport tests cover withdrawal/STOP and machine audio, including SQL fast-path parity, preserved real speech and final runtime instructions.
- Existing offer/qualification/follow-up tests retain the complete negotiation-to-agreement path and operational contact controls. All demonstrations are fictional and offline.

## Install and activate

Apply the four forward migrations in filename order. The conversion migration installs inactive. The final compatibility patch omits the new fingerprint field while inactive, preserving existing queued replies; enabled plans still invalidate on disable. The withdrawal and screening patches add source interpretation only and preserve existing function bodies/ACLs; their guarded prerequisites reject unknown predecessors.

After the exact-head Reliability checks, expected-head merge, successful exact-main checks, READY production web release and matching Railway worker release have all been verified, activate once with a fresh cutover under the existing admission lock:

```sql
begin;
set local lock_timeout='5s';
select 1 from public.icash_operating_budget where id=1 for update;
update public.icash_seller_progress_settings
set conversion_enabled_at=clock_timestamp()
where id=1 and enabled and dialogue_enabled and offer_enabled
  and conversion_enabled_at is null
returning conversion_enabled_at;
commit;
```

To pause this prospective behavior, acquire that same admission lock and set `conversion_enabled_at=null`. Do not reset jobs, mutate original receipts or replay old sources. A later reactivation uses a new cutover.

Read back installed definitions and ACLs, flag/cutover, and ordinary subsequent source-bound results. Offline checks demonstrate behavior, not increased contracts or live audio quality. No paid development calls/texts are authorized.

## Remaining production constraint

The read-only audit found 1,515 recent `no_response` gaps held for expired contact checks. The contact-refresh policy is enabled, but its two recorded attempts include a cost-review hold on an original unresolved provider receipt. This change cannot turn missing delivery/cost evidence into permission to retry. Keep that provider recovery separate from new conversation processing and distinguish pending verification from seller refusal or an actual contract outcome.
