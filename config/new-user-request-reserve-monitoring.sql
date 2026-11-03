-- Keep protected startup capacity distinct from exhausted provider capacity.
-- This projection never admits work, resets counters or alters reserve policy.
begin;
set local lock_timeout='5s';
do $guard$
begin
 if md5(pg_get_functiondef('public.icash_research_quota_status()'::regprocedure))<>'d3020a625709af735bc3eec9b5dd0021'
  or to_regprocedure('icash_research_private.request_reserve_state(timestamptz)') is null then
  raise exception 'Request reserve monitoring prerequisite changed';
 end if;
end $guard$;
create or replace function public.icash_research_quota_status() returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare b public.icash_dealmachine_request_budget;f icash_research_private.quota_feedback;r jsonb;
 day_used integer;minute_used integer;ordinary_remaining integer;state text;next_at timestamptz;
begin
 select * into b from public.icash_dealmachine_request_budget where id=1;
 select * into f from icash_research_private.quota_feedback where id=1;
 if b.id is null or f.id is null or b.day_limit is null or b.minute_limit is null
  or b.day_limit<=0 or b.minute_limit<=0 or b.day_used is null or b.minute_used is null
  or b.day_used<0 or b.minute_used<0 or b.day_start is null or b.minute_start is null
  or b.day_start>now() or b.minute_start>now() then
  return jsonb_build_object('checkedAt',now(),'fresh',true,'status','unavailable','warningCount',1);
 end if;
 r:=icash_research_private.request_reserve_state();
 if r is null or r->>'enabled' is null or r->>'ordinaryRemaining' is null
  or r->>'reserveRequests' is null or r->>'reserveUsed' is null or r->>'reserveRemaining' is null then
  return jsonb_build_object('checkedAt',now(),'fresh',true,'status','unavailable','warningCount',1);
 end if;
 day_used:=case when b.day_start<=now()-interval '24 hours' then 0 else b.day_used end;
 minute_used:=case when b.minute_start<=now()-interval '1 minute' then 0 else b.minute_used end;
 ordinary_remaining:=(r->>'ordinaryRemaining')::integer;
 -- Two requests are still needed for a new research candidate. The protected
 -- reserve is not a full outage; account progress monitoring remains separate.
 state:=case when day_used>=b.day_limit then 'day_exhausted'
  when day_used+2>b.day_limit then 'day_insufficient'
  when f.blocked_until>now() then 'provider_hold'
  when minute_used>=b.minute_limit then 'minute_exhausted'
  when minute_used+2>b.minute_limit then 'minute_insufficient'
  when ordinary_remaining<2 then 'reserved_for_new_users' else 'available' end;
 next_at:=greatest(case when day_used+2>b.day_limit or state='reserved_for_new_users' then b.day_start+interval '24 hours' end,
  case when minute_used+2>b.minute_limit then b.minute_start+interval '1 minute' end,
  case when f.blocked_until>now() then f.blocked_until end);
 return jsonb_build_object('checkedAt',now(),'fresh',true,'status',state,
  'warningCount',case when state in ('day_exhausted','day_insufficient','provider_hold') then 1 else 0 end,
  'dayUsed',day_used,'dayLimit',b.day_limit,'dayRemaining',greatest(0,b.day_limit-day_used),
  'minuteUsed',minute_used,'minuteLimit',b.minute_limit,'minuteRemaining',greatest(0,b.minute_limit-minute_used),
  'reserveEnabled',r->'enabled','reserveRequests',r->'reserveRequests','reserveUsed',r->'reserveUsed',
  'reserveRemaining',r->'reserveRemaining','ordinaryRemaining',r->'ordinaryRemaining',
  'dayStartedAt',b.day_start,'dayResetsAt',case when b.day_start>now()-interval '24 hours' then b.day_start+interval '24 hours' end,
  'nextAvailableAt',next_at,'providerBlockedUntil',case when f.blocked_until>now() then f.blocked_until end,
  'providerObservedAt',f.request_started_at,'providerDayLimit',f.headers->'dayLimit','providerDayRemaining',f.headers->'dayRemaining');
end $function$;
commit;
