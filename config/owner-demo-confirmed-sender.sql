-- Prefer recently proven transport for the owner's fresh, self-addressed demo.
-- Selection never sends, rebinds a conversation, enables a line or renews consent.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create index if not exists icash_demo_sender_completed_calls on public.icash_call_recordings(from_phone,call_ended_at desc)
 where call_sid is not null and provider_started_at is not null and call_ended_at is not null;

-- Ranking is more conservative than ordinary five-minute probe admission.
-- Keep a signed, exactly bound recent delay behind healthy alternatives until a
-- later-dispatched message is confirmed delivered or the one-hour notice ages out.
-- This helper does not change the existing sender-opener admission policy.
create or replace function public.icash_owner_demo_sender_recovered(p_sender text) returns boolean
language plpgsql stable security invoker set search_path='' as $fn$
declare delayed_epoch numeric;delayed_at timestamptz;
begin
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
  and extract(epoch from o.dispatched_at)<=(e.payload->>'timestamp')::numeric+5
 order by (e.payload->>'timestamp')::numeric desc limit 1;
 if not found then return true;end if;
 delayed_at:=to_timestamp(delayed_epoch::double precision);
 return exists(select 1 from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id and t.sender=p_sender
  join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where m.direction='outgoing' and m.state='delivered' and m.provider_id is not null
   and m.last_delivery_at between delayed_at and now()+interval '5 seconds'
   and o.dispatched_at between delayed_at and now() and o.dispatched_at<=m.last_delivery_at+interval '5 seconds');
end $fn$;
revoke all on function public.icash_owner_demo_sender_recovered(text) from public,anon,authenticated;
grant execute on function public.icash_owner_demo_sender_recovered(text) to service_role;

-- Recent inbound transport evidence is separate from outbound acceptance/delivery.
-- Use the active sender-pair and account/thread received-message cursor indexes.
-- Read at most 500 recent candidates per active thread, then verify only the
-- newest 500 across the sender. All reads use the last 24 hours; a candidate cap
-- can omit evidence, never invent it. Source event time, not ingestion time,
-- ranks confirmations. Do not infer a human identity or delivery guarantee.
create or replace function public.icash_owner_demo_sender_inbound_at(p_sender text) returns bigint
language sql stable security invoker set search_path='' as $fn$
 with recent as materialized (
  select m.*,t.sender,t.recipient
  from public.icash_text_threads t
  cross join lateral (
   select m.id,m.account_id,m.thread_id,m.event_id,m.provider_id,m.body,m.created_at
   from public.icash_text_messages m
   where m.account_id=t.account_id and m.thread_id=t.id and m.direction='incoming' and m.state='received'
    and m.created_at between now()-interval '24 hours' and now()
   order by m.created_at desc,m.id desc limit 500
  ) m
  where t.sender=p_sender and t.party='seller' and t.retired_at is null
   and not t.paused and not t.manual_only and t.ai_mode='auto'
   and exists(select 1 from public.icash_non_test_text_threads nt where nt.id=t.id and nt.account_id=t.account_id)
  order by m.created_at desc,m.id desc limit 500
 ), source as (
  select m.*,e.payload,e.received_at,
   case when jsonb_typeof(e.payload->'timestamp')='number' then (e.payload->>'timestamp')::numeric end source_at
  from recent m join public.icash_text_events e on e.id=m.event_id
  where e.type in ('text.incoming.sms','text.incoming.mms')
   and e.payload->>'id'=e.id and e.payload->>'type'=e.type
   and e.payload#>>'{data,from}'=m.recipient and e.payload#>>'{data,to}'=m.sender
   and jsonb_typeof(e.payload#>'{data,body}')='string' and e.payload#>>'{data,body}'=m.body
   and (m.provider_id is null or m.provider_id=e.payload#>>'{data,message_id}')
   and e.received_at between now()-interval '24 hours' and now()
   and m.body ~ '[[:alnum:]]'
   and m.body !~* '(^[[:space:]]*Free[[:space:]]+Msg[[:space:]]*:|Message[[:space:]]+Blocking[[:space:]]+is[[:space:]]+active|verification[[:space:]]+code|one.time[[:space:]]+(password|code)|automated[[:space:]]+message|automatic[[:space:]]+reply|auto[ -]?reply|do[[:space:]]+not[[:space:]]+reply)'
   and exists(select 1 from public.icash_sms_routes r where r.sender=m.sender and r.recipient=m.recipient
    and r.account_id=m.account_id and not r.needs_review)
   and not exists(select 1 from public.icash_text_threads other where other.sender=m.sender and other.recipient=m.recipient
    and other.retired_at is null and other.id<>m.thread_id)
 )
 select coalesce(floor(max(source_at))::bigint,0) from source
 where source_at between extract(epoch from now()-interval '24 hours') and extract(epoch from now())
  and source_at<=extract(epoch from least(created_at,received_at))+5
  -- The webhook parser retains raw aliases. Match the original receipt too,
  -- and do not count normalized iMessage traffic as cellular SMS/MMS evidence.
  and ((not payload?'providerEvent' and not payload?'channel') or (
   payload->>'channel'=case payload->>'type' when 'text.incoming.sms' then 'sms' else 'mms' end
   and payload#>>'{providerEvent,type}'=case payload->>'type' when 'text.incoming.sms' then 'communications.incoming.sms' else 'communications.incoming.mms' end
   and payload#>>'{providerEvent,id}'=event_id
   and payload#>>'{providerEvent,data,from}'=recipient and payload#>>'{providerEvent,data,to}'=sender
   and payload#>'{providerEvent,data,body}'=payload#>'{data,body}'
   and payload#>'{providerEvent,data,message_id}' is not distinct from payload#>'{data,message_id}'
   and case when jsonb_typeof(payload#>'{providerEvent,timestamp}')='number' then
    case when (payload#>>'{providerEvent,timestamp}')::numeric>=1e12 then (payload#>>'{providerEvent,timestamp}')::numeric/1000
     else (payload#>>'{providerEvent,timestamp}')::numeric end end=source_at
  ));
$fn$;
revoke all on function public.icash_owner_demo_sender_inbound_at(text) from public,anon,authenticated;
grant execute on function public.icash_owner_demo_sender_inbound_at(text) to service_role;

-- Lexicographic evidence, not a predicted success rate: current delay readiness,
-- latest verified inbound transport, confirmations on the less-observed channel,
-- then total confirmations. Counts
-- are bounded at 500 per channel and expire after seven days. Accepted-only SMS,
-- unstarted/unfinished calls and unrelated/missing dispatch receipts earn nothing.
-- Source uniqueness (provider ID, provider account + call SID, operation key)
-- makes the LIMIT a physical sample cap without a pre-LIMIT distinct sort.
-- Primary-line calls lack a current registry identity and earn no call score.
create or replace function public.icash_owner_demo_sender_rank(p_sender text) returns bigint[]
language sql stable security invoker set search_path='' as $$
 with sms as (
  select count(distinct recent.provider_id)::bigint n from (
   select m.provider_id
   from public.icash_text_messages m
   join public.icash_non_test_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
   where t.sender=p_sender and m.direction='outgoing' and m.state='delivered' and m.provider_id is not null
    and m.last_delivery_at between now()-interval '7 days' and now()
    and o.dispatched_at between now()-interval '7 days' and m.last_delivery_at
   limit 500
  ) recent
 ), calls as (
  select count(distinct recent.call_sid)::bigint n from (
   select r.call_sid
   from public.icash_call_recordings r
   join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=r.account_id
   where r.from_phone=p_sender and r.call_sid is not null and r.provider_started_at is not null
    and r.call_ended_at between now()-interval '7 days' and now()
    and r.provider_started_at between now()-interval '7 days' and r.call_ended_at
    and o.dispatched_at between now()-interval '7 days' and r.provider_started_at
    and r.provider_account_sid is not null
    and exists(select 1 from public.icash_business_voice_numbers n
     where n.phone=p_sender and n.provider_account_sid=r.provider_account_sid and n.caller_id_sid=r.caller_id_sid)
   limit 500
  ) recent
 )
 select array[case when public.icash_owner_demo_sender_recovered(p_sender) then 1 else 0 end::bigint,
  public.icash_owner_demo_sender_inbound_at(p_sender),least(sms.n,calls.n),sms.n+calls.n] from sms cross join calls;
$$;
revoke all on function public.icash_owner_demo_sender_rank(text) from public,anon,authenticated;
grant execute on function public.icash_owner_demo_sender_rank(text) to service_role;

do $ranking$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_business_conversation_sender(uuid,uuid,text,boolean)'::regprocedure);
 if strpos(d,'owner_demo_confirmed_sender_v1')>0 then return;end if;
 if strpos(d,'owner_demo_call_capable_v1')=0 then raise exception 'Owner demo call-capable predecessor required';end if;
 needle:='require_voice boolean:=p_voice;';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo ranking declaration changed';end if;
 d:=replace(d,needle,needle||' prefer_confirmed boolean:=false;');
 needle:=' select s.phone into chosen from public.icash_text_senders s';
 replacement:=$new$ -- owner_demo_confirmed_sender_v1: existing exact threads and any call history retain priority.
 prefer_confirmed:=chosen is null
  and p_account='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid and p_recipient='+12142185280'
  and public.icash_outreach_voice_current(p_account)
  and exists(
   select 1 from public.icash_accounts a
   join public.icash_seller_intakes l on l.assigned_account=a.id and l.screening_id=p_screening
   join public.icash_seller_matches m on m.lead_id=l.id and m.account_id=a.id and m.screening_id=l.screening_id
   join public.icash_optin_call_requests r on r.lead_id=l.id and r.request_id=l.request_id and r.phone=l.phone
   where a.id=p_account and a.owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
    and not a.bot_paused and l.phone=p_recipient and l.state='assigned' and l.ai_consented
    and l.contact_consent_scope='icash_x_demo' and l.attribution->>'demoAccountId'=a.id::text
    and r.source='demo_form' and r.account_id=a.id and r.requested_by=a.owner_user_id
    and r.request_version='icash-optin-call-now-2026-10-16.1' and r.request_reference=r.request_version
    and l.created_at<=r.requested_at and r.requested_at<=now()
    and r.expires_at=r.requested_at+interval '5 minutes' and r.expires_at>now()
  );
 select s.phone into chosen from public.icash_text_senders s$new$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo ranking allocation changed';end if;
 d:=replace(d,needle,replacement);
 needle:='and (chosen is null or s.phone=chosen)';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo ranking pool changed';end if;
 d:=replace(d,needle,'and (not prefer_confirmed or s.enabled) '||needle);
 needle:='order by encode(sha256(convert_to(p_account::text';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Owner demo ranking order changed';end if;
 replacement:='order by case when prefer_confirmed then public.icash_owner_demo_sender_rank(s.phone) end desc nulls last,'||chr(10)||'  encode(sha256(convert_to(p_account::text';
 execute replace(d,needle,replacement);
end $ranking$;
commit;
