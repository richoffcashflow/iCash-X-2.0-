-- Owner-only receipt summary; no provider probes, messages or invented complaint data.
begin;
set local lock_timeout='5s';
create function public.icash_owner_text_health(p_actor uuid) returns jsonb
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
   'incomingStatus',case when not enabled then 'paused' when blocked>0 then 'blocking_reported' when last_incoming>=start_at then 'observed' else 'unverified' end
  ) order by phone),'[]'::jsonb)) into result from stats;
 return result;
end $function$;
revoke all on function public.icash_owner_text_health(uuid) from public,anon,authenticated;
grant execute on function public.icash_owner_text_health(uuid) to service_role;
commit;
