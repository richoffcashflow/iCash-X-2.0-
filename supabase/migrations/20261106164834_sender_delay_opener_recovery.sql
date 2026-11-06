-- Pause new seller introductions on the exact sender for five minutes after a
-- verified carrier delay. Pace eligible introductions while the line recovers.
-- No message is resent, no existing thread is reassigned, and no wallet is modified.
begin;
set local lock_timeout='2s';
set local statement_timeout='15s';

create index icash_sender_delay_by_number on public.icash_text_events
 ((payload#>>'{data,original_number}'), ((payload->>'timestamp')::numeric) desc)
 where type='numbers.delayed' and jsonb_typeof(payload->'timestamp')='number'
 and payload#>>'{data,reason}'='number_temporary_unavailable';
create index icash_openers_by_creation on public.icash_seller_opener_assignments(created_at desc,thread_id);
create index icash_confirmed_text_by_time on public.icash_text_messages(last_delivery_at desc)
 where direction='outgoing' and state='delivered' and provider_id is not null;

create function icash_text_receipt_private.sender_opener_available(p_sender text) returns boolean
language plpgsql stable security invoker set search_path='' as $fn$
declare delayed_epoch numeric; delayed_at timestamptz;
begin
 -- Match the original signed notice, accepted provider ID, account, sending
 -- number and actual dispatch. Both arrival orders work once the receipts meet.
 select (e.payload->>'timestamp')::numeric into delayed_epoch
 from public.icash_text_events e
 join public.icash_text_messages m on m.provider_id=e.payload#>>'{data,affected_id}' and m.direction='outgoing'
 join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.sender=p_sender
 join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
 where e.type='numbers.delayed' and e.payload->>'type'=e.type and e.payload->>'id'=e.id
 and e.payload#>>'{data,reason}'='number_temporary_unavailable'
 and e.payload#>>'{data,original_number}'=p_sender and jsonb_typeof(e.payload->'timestamp')='number'
 and (e.payload->>'timestamp')::numeric between extract(epoch from now()-interval '1 hour') and extract(epoch from now()+interval '5 seconds')
 and o.dispatched_at between now()-interval '1 hour' and now()
 and extract(epoch from o.dispatched_at) <= (e.payload->>'timestamp')::numeric+5
 order by (e.payload->>'timestamp')::numeric desc limit 1;
 if not found then return true;end if;
 delayed_at:=to_timestamp(delayed_epoch::double precision);

 -- A terminal delivery for work actually dispatched after the delay restores
 -- full speed. A late confirmation for an older send cannot clear a newer delay.
 if exists(select 1 from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.sender=p_sender
  join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where m.direction='outgoing' and m.state='delivered' and m.provider_id is not null
   and m.last_delivery_at between delayed_at and now()+interval '5 seconds'
   and o.dispatched_at between delayed_at and now() and o.dispatched_at<=m.last_delivery_at+interval '5 seconds') then return true;end if;
 if delayed_at>now()-interval '5 minutes' then return false;end if;

 -- The live queue takes the shared operating-budget row lock before this
 -- check and inserts the assignment in the same transaction.
 return not exists(select 1 from public.icash_seller_opener_assignments a
  join public.icash_text_threads t on t.id=a.thread_id and t.account_id=a.account_id and t.sender=p_sender
  where a.message_id is not null and a.created_at>=now()-interval '5 minutes');
end $fn$;
revoke all on function icash_text_receipt_private.sender_opener_available(text) from public,anon,authenticated;
grant execute on function icash_text_receipt_private.sender_opener_available(text) to service_role;

do $patch$
declare item record;definition text;
 needle text:='if not found or exists(select 1 from public.icash_seller_opener_assignments where thread_id=t.id)';
 guard text:='if not found or not icash_text_receipt_private.sender_opener_available(t.sender) or exists(select 1 from public.icash_seller_opener_assignments where thread_id=t.id)';
begin
 for item in select * from (values
  ('public.icash_seller_opener_candidate_body(uuid,uuid)','d655ee79d80796bc797eead3d44b7cb5'),
  ('public.icash_queue_seller_opener(uuid,uuid)','cb48d8f6a9538585f098987edf83a82f')
 ) as source(signature,expected) loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if md5(definition)<>item.expected or (length(definition)-length(replace(definition,needle,'')))<>length(needle) then
   raise exception 'Unexpected seller opener source: %',item.signature;
  end if;
  execute replace(definition,needle,guard);
 end loop;
end $patch$;
commit;
