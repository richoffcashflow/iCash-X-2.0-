begin;
set local lock_timeout='3s';
-- Queueing and claiming use the same budget lock. Update generated copy and its
-- exact-match claim checks together before another message can be admitted.
select 1 from public.icash_operating_budget where id=1 for update;
do $copy$
declare routine record;definition text;footer constant text:=' Reply STOP to opt out.';
begin
 if position(footer in pg_get_functiondef('public.icash_queue_seller_opener(uuid,uuid)'::regprocedure))=0 then
  raise exception 'Seller opener footer prerequisite changed';
 end if;
 for routine in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.prokind='f' and position(footer in p.prosrc)>0
 loop
  if routine.proname<>all(array['icash_prepare_sms_reply_before_owner_question',
   'icash_claim_text_before_buyer_package','icash_claim_text',
   'icash_prepare_sms_inbound_reply','icash_queue_seller_opener','icash_seller_recipient_opener']) then
   raise exception 'Unexpected SMS footer source: %',routine.proname;
  end if;
  definition:=replace(pg_get_functiondef(routine.oid),footer,'');
  definition:=replace(definition,'omit AI/STOP','omit AI disclosure');
  execute definition;
 end loop;
end $copy$;

-- Refresh only unsubmitted queued copy. Accepted, delivered, failed/unknown,
-- and inbound message evidence is never rewritten or retried.
with changed as (
 update public.icash_text_messages
 set body=left(body,length(body)-length(' Reply STOP to opt out.')),updated_at=now()
 where direction='outgoing' and state='ready' and provider_id is null
 and right(body,length(' Reply STOP to opt out.'))=' Reply STOP to opt out.'
 returning id,body
)
update public.icash_seller_opener_assignments a set body=m.body
from changed m where a.message_id=m.id;
commit;
