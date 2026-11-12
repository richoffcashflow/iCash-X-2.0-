# Seller refusals and one unanswered follow-up

The November 12 review reproduced ownership denials that were classified as no disposition. The outbound assistant then asked what property the recipient was calling about. The source classifier and actual recorded-provider runtime instructions now agree: a direct no/nope/nah/not-me to ownership stops that property inquiry; a no to selling stops the pitch. A no to repairs, liens, tenants, an offered price or an invitation to call does not invent a refusal to sell. A mixed or unclear ownership denial enters review. Only explicit stop-contact language creates permanent suppression.

The SQL correction uses the immediately preceding actual agent turn, preserves quoted/negated language, and keeps the TypeScript and SQL patterns synchronized. Existing source-bound observers stop queued automatic work and final dispatch after a refusal while preserving already reserved, dispatched or uncertain operations. Both recorded inbound and outbound results use the shared classifier. Canonical Spanish voicemail beginning with “No se ha grabado nada” remains automated audio, not a seller refusal; later real speech and explicit opt-outs still win. This additional case was found during the wider review and verified against the existing human-response predicate before release. The outbound provider receives the direction/refusal instructions after saved context and frozen templates; template hashes are unchanged.

A final boundary check reproduced a separate failure for “Would you consider selling for $120,000?” followed by “No.” The helper now recognizes specific dollar/short-form/spoken amounts before applying the generic selling-interest rule. Unmarked amounts such as “120000” and “one hundred twenty thousand” are recognized when attached to a selling-price phrase, while property street numbers remain ownership/interest context. Ownership questions and independently explicit refusals or opt-outs retain priority. Nineteen additional call fixtures and both actual inbound/outbound source observers verify that rejecting an amount does not create a property hold. This does not authorize a cold follow-up after a human answer.

## Unanswered sequence

A new operational seller introduction may receive one additional call after at least two hours, within 24 hours of the original actual dial and the original contact evidence. It must have an exact completed, settled, unanswered/automated result or a bound settled carrier no-answer/busy receipt. Missing transcripts, guessed flags, ongoing calls, unknown costs, human replies, previous additional attempts and a different source/account/property/recipient cannot qualify. Any real incoming text or call response ends this cold sequence. Phone-wide checks run again during issue, reserve, claim and final dial. Existing hours, financial screening, current DNC/source evidence, funding, customer Pause, channel choice, suppression and manual takeover remain required.

The new call has its own job and ordinary billing operation; the original is immutable. A unique original-job link prevents a third call or a chain of follow-ups. The scheduler visits at most 20 records using a persistent cursor, under the existing scheduler/budget locks. Only the service role can invoke it, and the service cannot enable its policy or read the private raw receipts through the new boolean eligibility helper.

For introductions sent after activation, the existing single unanswered text reminder becomes eligible after four hours and before 24 hours, subject to the original evidence and all final-send controls. The one-introduction/one-reminder recipient cap remains unchanged. Pre-activation introductions retain their previous three-to-five-day policy. This does not reactivate expired historical contacts or buy new contact checks.

## Installation and release

Production migration receipts: `20261112214321_seller_call_answer_context`, `20261112221500_unanswered_seller_followups`, `20261112222054_seller_call_automated_greetings` and `20261112224350_seller_specific_price_answers` and `20261112224920_seller_unmarked_price_answers`. Readback confirmed the refusal classifier, replacement first-call index, unique follow-up link, private grants and disabled policy with no follow-up jobs. Four individually reviewed ownership-denial conversations were applied through the existing source observer only after checking for later human replies, manual changes and active deals; all four properties now stop automatic pursuit. A bounded review of the preceding seven days found 50 further source-verified cases and stopped them under the same late-change, later-reply and active-deal exclusions. No seller was contacted for verification.

The application/runtime change must pass canonical exact-head Reliability checks, expected-head merge, exact-main checks, and matching Vercel/Railway release verification. The final release must also contain the specific-price answer correction; the earlier ownership-refusal release alone is not the activation target. Only then enable the new sequence with a fresh cutover under the scheduler/budget locks:

```sql
begin;
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
update icash_seller_recovery_private.unanswered_policy
set enabled=true,activated_at=clock_timestamp(),scan_at=null,scan_id=null
where id=1 and not enabled and activated_at is null;
commit;
```

Pause the new sequence by setting `enabled=false` under those same locks. Do not erase original jobs, receipts, dispositions, spending or the cutover. Do not automatically reactivate or replay historical work.

## Validation and remaining boundary

All 878 existing local suites passed, along with type checking. The dedicated checks cover 115 text cases, 166 call cases, SQL/TypeScript parity, actual provider prompt placement, source-bound queue cancellation/final admission and 42 unanswered-follow-up scenarios. Native PostgreSQL testing runs 16 competing queues and late Pause/STOP/reply/policy changes, proving one new job and no new charge or mutation of the original. The new suite and native test are part of release checks. These are offline scenarios, not paid calls or evidence of seller outcomes.

The older contact-refresh backlog remains held by an inconsistent provider billing receipt. This release does not clear or reinterpret that receipt, release its uncertain money or claim the old backlog has resumed. Prospective follow-ups use still-current original evidence. Provider receipt resolution remains a separate outstanding recovery prerequisite.
