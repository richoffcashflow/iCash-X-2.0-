-- New seller introductions omit the added opt-out footer. Incoming opt-outs,
-- versioned consent evidence and every final contact/financial gate stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $copy$
declare d text;footer constant text:=' Reply STOP to opt out.';
begin
 d:=pg_get_functiondef('public.icash_seller_identity_opener(text,text)'::regprocedure);
 if md5(d)<>'901b1fd8d90783ca33588749498510c0'
  or (length(d)-length(replace(d,footer,'')))<>length(footer) then
  raise exception 'Seller footer copy prerequisite changed';
 end if;
 execute replace(d,footer,'');
 d:=pg_get_functiondef('public.icash_assign_seller_opener(uuid,uuid)'::regprocedure);
 if md5(d)<>'033f5c1ba9a47d663be0816febec9492'
  or (length(d)-length(replace(d,'identity-v3','')))<>3*length('identity-v3') then
  raise exception 'Seller footer assignment prerequisite changed';
 end if;
 execute replace(d,'identity-v3','identity-v4');
end $copy$;

-- A distinct context avoids mixing the revised copy with historical outcomes.
-- Retain v3's template, existing receipts and all earlier assignment contexts.
alter table public.icash_seller_opener_assignments
 drop constraint icash_seller_opener_assignments_learning_context_check;
alter table public.icash_seller_opener_assignments
 add constraint icash_seller_opener_assignments_learning_context_check
 check(learning_context in ('opener-v1','interest-v2','identity-v3','identity-v4'));
insert into public.icash_seller_opener_variants(key,body,enabled)
 values('identity-v4','Hi, contacting you for {principal} about a cash offer. Do you own {address}?',true);

-- Refresh only exact automatic v3 ownership questions that have never received
-- provider-operation authority. No retry, ticket reset or source renewal occurs.
-- A completed budget hold is pre-admission; reconciliation/unknown holds stay
-- byte-for-byte intact, even when an operation row happens to be absent.
with eligible as materialized (
 select m.id,m.account_id,m.thread_id,left(m.body,length(m.body)-length(' Reply STOP to opt out.')) body
 from public.icash_text_messages m
 join public.icash_seller_opener_assignments a
  on a.message_id=m.id and a.account_id=m.account_id and a.thread_id=m.thread_id and a.body=m.body
 join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.party='seller'
 join public.icash_sms_seller_openings opening
  on opening.thread_id=t.id and opening.account_id=t.account_id and opening.owner_question_id=m.id
 where a.variant='identity-v3' and a.learning_context='identity-v3'
  and a.delivered_at is null and a.first_reply_at is null and not a.opted_out
  and m.direction='outgoing' and m.state='ready' and m.customer_author_id is null
  and m.provider_id is null and m.event_id is null and m.last_delivery_at is null
  and m.request_key=t.id and cardinality(m.asset_ids)=0 and m.attachments='[]'::jsonb
  and m.body ~ '^Hi, contacting you for .+ about a cash offer\. Do you own .+\? Reply STOP to opt out\.$'
  and not exists(select 1 from public.icash_operation_spend o where o.operation_key='text:'||m.id)
  and not exists(select 1 from public.icash_live_conversations c where c.operation_key='text:'||m.id)
  and not exists(select 1 from public.icash_text_ai_jobs j where j.outgoing_id=m.id)
  and not exists(select 1 from public.icash_sms_inbound_invitations i where i.message_id=m.id or i.thread_id=t.id)
  and not exists(select 1 from public.icash_automation_tickets ticket where ticket.opener_message_id=m.id
   and (ticket.account_id is distinct from m.account_id or ticket.kind is distinct from 'seller_opener'
    or ((ticket.state='issued' and ticket.expires_at<=now())
     or (ticket.state='held' and ticket.completed_at is not null and ticket.outcome='prospecting_budget_held')) is not true))
 for update of m,a,t
), changed as (
 update public.icash_text_messages m set body=e.body,updated_at=now()
 from eligible e where m.id=e.id and m.account_id=e.account_id and m.thread_id=e.thread_id
 returning m.id,m.account_id,m.thread_id,m.body
)
update public.icash_seller_opener_assignments a
 set body=m.body,variant='identity-v4',learning_context='identity-v4'
from changed m where a.message_id=m.id and a.account_id=m.account_id and a.thread_id=m.thread_id;
commit;
