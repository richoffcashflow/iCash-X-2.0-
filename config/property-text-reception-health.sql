begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Observability only. Refuse to replace a changed predecessor or its ACLs.
do $guard$
begin
 if md5(pg_get_functiondef('public.icash_owner_text_health(uuid)'::regprocedure))<>'8f816a00b98eb133f399e21be44a1de9'
  or md5(pg_get_functiondef('public.icash_refresh_work_before_research_quota()'::regprocedure))<>'030c3c9339124bfd9727366189dc4db2' then
  raise exception 'Property text health predecessor changed';
 end if;
end $guard$;
create table icash_reliability_private.text_ingress_monitor (
 id integer primary key check(id=1), installed_at timestamptz not null default now()
);
insert into icash_reliability_private.text_ingress_monitor(id) values(1);
create table icash_reliability_private.text_ingress_failures (
 hour_at timestamptz not null,
 kind text not null check(kind in ('authenticated_rejected','unregistered_destination','processing_failed')),
 stage text not null check(stage in ('parse_incoming','parse_other','sender_registration','lifecycle_routing','delivery_receipt','property_ingestion','reply_preparation')),
 requests bigint not null check(requests>0), last_at timestamptz not null,
 primary key(hour_at,kind,stage)
);
alter table icash_reliability_private.text_ingress_monitor enable row level security;
alter table icash_reliability_private.text_ingress_failures enable row level security;
revoke all on icash_reliability_private.text_ingress_monitor,icash_reliability_private.text_ingress_failures from public,anon,authenticated;
grant select on icash_reliability_private.text_ingress_monitor to service_role;
grant select,insert,update on icash_reliability_private.text_ingress_failures to service_role;
-- Called only after webhook authentication. Request counts include provider retries;
-- no payload, event ID, recipient or account is stored, and no work is retried.
create function public.icash_record_text_ingress_failure(p_kind text,p_stage text) returns void
language plpgsql security invoker set search_path='' set lock_timeout='500ms' set statement_timeout='1000ms' as $fn$
begin
 if p_kind is null or p_stage is null or not (
  (p_kind='authenticated_rejected' and p_stage in ('parse_incoming','parse_other')) or
  (p_kind='unregistered_destination' and p_stage='sender_registration') or
  (p_kind='processing_failed' and p_stage in ('sender_registration','lifecycle_routing','delivery_receipt','property_ingestion','reply_preparation'))
 ) then raise exception 'Invalid text ingress observation';end if;
 insert into icash_reliability_private.text_ingress_failures(hour_at,kind,stage,requests,last_at)
 values(date_trunc('hour',now()),p_kind,p_stage,1,now())
 on conflict(hour_at,kind,stage) do update set requests=text_ingress_failures.requests+1,last_at=greatest(text_ingress_failures.last_at,excluded.last_at);
end $fn$;
create function public.icash_text_ingress_health() returns jsonb
language sql stable security invoker set search_path='' as $fn$
 select jsonb_build_object('monitoredSince',(select installed_at from icash_reliability_private.text_ingress_monitor where id=1),
  'windowStartedAt',date_trunc('hour',now())-interval '23 hours',
  'failedRequests24h',coalesce(sum(requests),0),'lastFailureAt',max(last_at),
  'failures',coalesce(jsonb_agg(jsonb_build_object('kind',kind,'stage',stage,'requests',requests,'lastAt',last_at) order by kind,stage),'[]'::jsonb))
 from (select kind,stage,sum(requests) requests,max(last_at) last_at from icash_reliability_private.text_ingress_failures
  where hour_at>=date_trunc('hour',now())-interval '23 hours' and hour_at<=now() group by kind,stage) s;
$fn$;
revoke all on function public.icash_record_text_ingress_failure(text,text),public.icash_text_ingress_health() from public,anon,authenticated;
grant execute on function public.icash_record_text_ingress_failure(text,text),public.icash_text_ingress_health() to service_role;
create or replace function public.icash_owner_text_health(p_actor uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $function$
declare start_at timestamptz:=now()-interval '24 hours';
 today_at timestamptz:=date_trunc('day',now() at time zone 'America/Chicago') at time zone 'America/Chicago';
 result jsonb;
begin
 if p_actor is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid then raise exception 'Owner required' using errcode='42501';end if;
 with lines as materialized (
  select phone,enabled from public.icash_text_senders
 ), outgoing as materialized (
  select m.id,m.state,m.provider_id,t.sender,t.recipient,o.dispatched_at at
  from public.icash_operation_spend o join public.icash_text_messages m on o.operation_key='text:'||m.id and o.account_id=m.account_id
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where o.dispatched_at between least(start_at,today_at) and now() and m.direction='outgoing'
 ), incoming as materialized (
  select distinct on (event_key) * from (
   select coalesce(m.event_id,m.provider_id,m.id::text) event_key,t.sender line,t.recipient phone,m.body,m.created_at at,t.account_id,t.id thread_id
   from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   where m.direction='incoming' and m.state='received' and (m.event_id is not null or m.provider_id is not null) and m.created_at between start_at and now()
   union all
   select event_id,recipient,sender,body,created_at,null::uuid,null::uuid from public.icash_lifecycle_text_inbox where created_at between start_at and now()
  ) source order by event_key,thread_id nulls last
 ), human as materialized (
  select *,public.icash_seller_response_disposition(body) disposition
  from incoming where body ~ '[[:alnum:]]' and body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'
 ), stats as (
  select l.phone,l.enabled,
   (select count(distinct provider_id) from outgoing where sender=l.phone and at>=today_at and state in ('accepted','delivered') and provider_id is not null) accepted_today,
   (select count(distinct provider_id) from outgoing where sender=l.phone and at>=start_at and state in ('accepted','delivered') and provider_id is not null) accepted,
   (select count(distinct recipient) from outgoing where sender=l.phone and at>=start_at and state in ('accepted','delivered') and provider_id is not null) recipients,
   (select count(distinct provider_id) from outgoing where sender=l.phone and at>=start_at and state='delivered' and provider_id is not null) delivered,
   (select count(*) from outgoing where sender=l.phone and at>=start_at and state='needs_review') review,
   (select count(*) from incoming where line=l.phone and body ~* '(^Free Msg:|Message Blocking is active)') blocked,
   (select count(distinct phone) from human where line=l.phone) replies,
   (select count(distinct phone) from human where line=l.phone and thread_id is not null) property_replies,
   (select count(*) from human where line=l.phone and thread_id is null) other_incoming,
   (select max(m.created_at) from public.icash_text_messages m
    join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
    where t.sender=l.phone and m.direction='incoming' and m.state='received'
     and (m.provider_id is not null or m.event_id is not null) and m.created_at<=now()
     and m.body ~ '[[:alnum:]]' and m.body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))') last_property_incoming,
   (select count(distinct phone) from human where line=l.phone and disposition='opt_out') opt_outs,
   (select count(distinct phone) from human where line=l.phone and disposition in ('declined','review')) refusals,
   (select count(distinct phone) from human where line=l.phone and public.icash_seller_direct_response_match(lower(body),'\y(spam|reported|reporting|harassing|harassment|tired of these texts|stop bothering)\y')) complaints,
   (select count(distinct phone) from human where line=l.phone and thread_id is not null and disposition is null and public.icash_seller_sms_interest_at(account_id,thread_id,start_at,now()) is not null) interested,
   (select count(distinct provider_id) from public.icash_customer_update_deliveries u where u.sender=l.phone and u.channel='sms' and u.provider_id is not null and u.authorized_at between today_at and now()) customer_today,
   (select max(at) from (
    select m.created_at at from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
     where t.sender=l.phone and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)
      and m.body ~ '[[:alnum:]]' and m.body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'
    union all
    select created_at from public.icash_lifecycle_text_inbox where recipient=l.phone
     and body ~ '[[:alnum:]]' and body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'
   ) seen where at<=now()) last_incoming
  from lines l
 )
 select jsonb_build_object('checkedAt',now(),'startAt',start_at,'todayAt',today_at,'timezone','America/Chicago','providerComplaintReports',null,
  'lines',coalesce(jsonb_agg(jsonb_build_object(
   'phone',phone,'enabled',enabled,'propertyAcceptedToday',accepted_today,'propertyAccepted24h',accepted,'propertyRecipients24h',recipients,
   'propertyDelivered24h',delivered,'propertyReview24h',review,'blockedNotices24h',blocked,'replyRecipients24h',replies,
   'optOutRecipients24h',opt_outs,'refusalRecipients24h',refusals,'complaintWordingRecipients24h',complaints,'interestedRecipients24h',interested,
   'customerUpdatesToday',customer_today,'lastIncomingAt',last_incoming,
   'propertyReplyRecipients24h',property_replies,'otherIncoming24h',other_incoming,'lastPropertyIncomingAt',last_property_incoming,
   'propertyIncomingStatus',case when not enabled then 'paused' when blocked>0 then 'blocking_reported' when last_property_incoming>=start_at then 'observed' else 'unverified' end,
   'incomingStatus',case when not enabled then 'paused' when blocked>0 then 'blocking_reported' when last_incoming>=start_at then 'observed' else 'unverified' end
  ) order by phone),'[]'::jsonb)) into result from stats;
 return result||jsonb_build_object('ingress',public.icash_text_ingress_health());
end $function$;
create or replace function public.icash_refresh_work_before_research_quota() returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare v_report jsonb;previous_incoming jsonb;health jsonb;incoming jsonb;lines jsonb;warning_count integer;
begin
 perform pg_advisory_xact_lock(916014);
 select report->'incomingTexts' into previous_incoming from icash_reliability_private.snapshots where id=1;
 v_report:=public.icash_refresh_work_before_incoming_texts();
 begin
  health:=public.icash_owner_text_health('592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid);
  if health is null or jsonb_typeof(health->'lines') is distinct from 'array' or health->>'checkedAt' is null
   or (health->>'checkedAt')::timestamptz not between now()-interval '3 minutes' and now() then
   raise exception 'Incoming text observation unavailable';
  end if;
  with warnings as materialized (
   select line from jsonb_array_elements(health->'lines') line where line->'enabled'='true'::jsonb
    and line->>'propertyIncomingStatus' in ('unverified','blocking_reported') and (line->>'propertyAccepted24h')::bigint>0
  ), samples as (select line from warnings order by line->>'phone' limit 50)
  select (select count(*)::integer from warnings),coalesce(jsonb_agg(jsonb_build_object('phone',line->>'phone','incomingStatus',line->>'propertyIncomingStatus','lastIncomingAt',line->'lastIncomingAt','lastPropertyIncomingAt',line->'lastPropertyIncomingAt','propertyReplyRecipients24h',line->'propertyReplyRecipients24h','otherIncoming24h',line->'otherIncoming24h',
   'propertyAccepted24h',line->'propertyAccepted24h','propertyDelivered24h',line->'propertyDelivered24h') order by line->>'phone'),'[]'::jsonb)
  into warning_count,lines from samples;
  incoming:=jsonb_build_object('checkedAt',health->'checkedAt','fresh',true,'lineWarningCount',warning_count,'warningCount',warning_count+case when (health->'ingress'->>'failedRequests24h')::bigint>0 then 1 else 0 end,'lines',lines,'ingress',health->'ingress');
 exception when others then
  -- Preserve earlier evidence without rolling back independent account/work
  -- observations. An unavailable read cannot create a false recovered report.
  incoming:=jsonb_build_object('checkedAt',previous_incoming->'checkedAt','fresh',false,
   'warningCount',greatest(1,coalesce((previous_incoming->>'warningCount')::integer,0)),
   'lineWarningCount',previous_incoming->'lineWarningCount','lines',coalesce(previous_incoming->'lines','[]'::jsonb),'ingress',previous_incoming->'ingress');
 end;
 v_report:=v_report||jsonb_build_object('incomingTexts',incoming,'issueCount',
  (v_report->>'issueCount')::integer-coalesce((v_report->'incomingTexts'->>'warningCount')::integer,0)+(incoming->>'warningCount')::integer);
 update icash_reliability_private.snapshots set report=v_report where id=1;
 return v_report;
end $function$;
revoke all on function public.icash_owner_text_health(uuid),public.icash_refresh_work_before_research_quota() from public,anon,authenticated;
grant execute on function public.icash_owner_text_health(uuid),public.icash_refresh_work_before_research_quota() to service_role;
commit;
