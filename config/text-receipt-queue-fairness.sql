-- Fair selection of original receipt reads; no sends, new quota or financial writes.
-- Preserve the existing global lock, three/minute control, eight checks and backoff.
begin;
set local lock_timeout='2s';
create index icash_text_receipt_schedule_due
 on icash_text_receipt_private.schedule(next_check_at,message_id) where attempts<8;
do $patch$
declare
 definition text:=pg_get_functiondef('public.icash_claim_text_delivery_rechecks()'::regprocedure);
 needle text:=$needle$  select m.id,m.account_id,m.thread_id,m.provider_id,m.body,m.attachments,m.created_at,t.sender,t.recipient,
   to_jsonb(o) operation,coalesce(s.attempts,0) attempts
  from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
  join public.icash_operation_rates r on r.id=o.rate_id and r.operation in ('sms_send','mms_send')
  left join icash_text_receipt_private.schedule s on s.message_id=m.id
  where m.direction='outgoing' and m.state='accepted' and m.provider_id is not null and m.last_delivery_at is null
   and m.created_at<=now()-interval '10 minutes' and o.state='settled' and o.settled_at is not null
   and o.dispatched_at is not null and coalesce(s.attempts,0)<8 and (s.next_check_at is null or s.next_check_at<=now())
  order by s.next_check_at nulls first,m.created_at,m.id limit 3 for update of m skip locked$needle$;
 replacement text:=$replacement$  -- Reserve one slot for each nonempty class, then the oldest eligible third.
  -- Each class is capped before ranking: at most six rows are materialized/locked.
  with due as materialized (
  select m.id,m.account_id,m.thread_id,m.provider_id,m.body,m.attachments,m.created_at,t.sender,t.recipient,
   to_jsonb(o) operation,coalesce(s.attempts,0) attempts,
   coalesce(s.next_check_at,m.created_at+interval '10 minutes') eligible_at
  from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
  join public.icash_operation_rates r on r.id=o.rate_id and r.operation in ('sms_send','mms_send')
  join icash_text_receipt_private.schedule s on s.message_id=m.id
  where m.direction='outgoing' and m.state='accepted' and m.provider_id is not null and m.last_delivery_at is null
   and m.created_at<=now()-interval '10 minutes' and o.state='settled' and o.settled_at is not null
   and o.dispatched_at is not null and s.attempts<8 and s.next_check_at<=now()
   and s.message_id is not null
  order by s.next_check_at,m.created_at,m.id limit 3 for update of m skip locked
  ), fresh as materialized (
  select m.id,m.account_id,m.thread_id,m.provider_id,m.body,m.attachments,m.created_at,t.sender,t.recipient,
   to_jsonb(o) operation,coalesce(s.attempts,0) attempts,
   coalesce(s.next_check_at,m.created_at+interval '10 minutes') eligible_at
  from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
  join public.icash_operation_rates r on r.id=o.rate_id and r.operation in ('sms_send','mms_send')
  left join icash_text_receipt_private.schedule s on s.message_id=m.id
  where m.direction='outgoing' and m.state='accepted' and m.provider_id is not null and m.last_delivery_at is null
   and m.created_at<=now()-interval '10 minutes' and o.state='settled' and o.settled_at is not null
   and o.dispatched_at is not null and coalesce(s.attempts,0)<8 and (s.next_check_at is null or s.next_check_at<=now())
   and s.message_id is null
  order by m.created_at,m.id limit 3 for update of m skip locked
  ), candidates as (
   select due.*,row_number() over(order by eligible_at,created_at,id) ordinal from due
   union all
   select fresh.*,row_number() over(order by eligible_at,created_at,id) ordinal from fresh
  )
  -- Do not copy helper columns into the immutable, exact-source request object.
  select id,account_id,thread_id,provider_id,body,attachments,created_at,sender,recipient,operation,attempts
  from candidates order by (ordinal=1) desc,eligible_at,created_at,id limit 3$replacement$;
begin
 if md5(definition)<>'d1ee0fda63cf1de46b883585aadc8e85' then
  raise exception 'Original canonical text receipt claim changed';
 end if;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Original canonical text receipt selection changed';
 end if;
 execute replace(definition,needle,replacement);
end $patch$;
commit;
