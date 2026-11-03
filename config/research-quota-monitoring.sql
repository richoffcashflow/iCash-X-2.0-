-- Observe the shared request ceiling independently from worker uptime.
-- This never resets a window, increases a limit or admits a provider request.
begin;
set local lock_timeout='5s';
create function public.icash_research_quota_status() returns jsonb
language plpgsql stable security definer set search_path='' as $function$
declare b public.icash_dealmachine_request_budget;f icash_research_private.quota_feedback;
 day_used integer;minute_used integer;state text;next_at timestamptz;
begin
 select * into b from public.icash_dealmachine_request_budget where id=1;
 select * into f from icash_research_private.quota_feedback where id=1;
 if b.id is null or f.id is null or b.day_limit is null or b.minute_limit is null
  or b.day_limit<=0 or b.minute_limit<=0 or b.day_used is null or b.minute_used is null
  or b.day_used<0 or b.minute_used<0 or b.day_start is null or b.minute_start is null
  or b.day_start>now() or b.minute_start>now() then
  return jsonb_build_object('checkedAt',now(),'fresh',true,'status','unavailable','warningCount',1);
 end if;
 -- The limiter starts a new window only on normal admission. An observation
 -- computes effective capacity without changing those stored counters.
 day_used:=case when b.day_start<=now()-interval '24 hours' then 0 else b.day_used end;
 minute_used:=case when b.minute_start<=now()-interval '1 minute' then 0 else b.minute_used end;
 -- Ordinary acquisition reserves room for two requests. One remaining slot
 -- can serve a free receipt read, but cannot admit a new research candidate.
 state:=case when day_used>=b.day_limit then 'day_exhausted'
  when day_used+2>b.day_limit then 'day_insufficient'
  when f.blocked_until>now() then 'provider_hold'
  when minute_used>=b.minute_limit then 'minute_exhausted'
  when minute_used+2>b.minute_limit then 'minute_insufficient' else 'available' end;
 next_at:=greatest(case when day_used+2>b.day_limit then b.day_start+interval '24 hours' end,
  case when minute_used+2>b.minute_limit then b.minute_start+interval '1 minute' end,
  case when f.blocked_until>now() then f.blocked_until end);
 return jsonb_build_object('checkedAt',now(),'fresh',true,'status',state,
  'warningCount',case when state in ('day_exhausted','day_insufficient','provider_hold') then 1 else 0 end,
  'dayUsed',day_used,'dayLimit',b.day_limit,'dayRemaining',greatest(0,b.day_limit-day_used),
  'minuteUsed',minute_used,'minuteLimit',b.minute_limit,'minuteRemaining',greatest(0,b.minute_limit-minute_used),
  'dayStartedAt',b.day_start,'dayResetsAt',case when b.day_start>now()-interval '24 hours' then b.day_start+interval '24 hours' end,
  'nextAvailableAt',next_at,'providerBlockedUntil',case when f.blocked_until>now() then f.blocked_until end,
  'providerObservedAt',f.request_started_at,'providerDayLimit',f.headers->'dayLimit','providerDayRemaining',f.headers->'dayRemaining');
end $function$;
revoke all on function public.icash_research_quota_status() from public,anon,authenticated;
grant execute on function public.icash_research_quota_status() to service_role;

do $guard$
begin
 if md5(pg_get_functiondef('public.icash_refresh_account_work_snapshot()'::regprocedure))<>'73dae59d66460dddd1ab6c77c7286341' then
  raise exception 'Research quota monitor prerequisite changed';
 end if;
end $guard$;
alter function public.icash_refresh_account_work_snapshot() rename to icash_refresh_work_before_research_quota;
create function public.icash_refresh_account_work_snapshot() returns jsonb
language plpgsql security invoker set search_path='' as $function$
declare v_report jsonb;previous jsonb;quota jsonb;
begin
 perform pg_advisory_xact_lock(916014);
 select s.report->'researchQuota' into previous from icash_reliability_private.snapshots s where id=1;
 v_report:=public.icash_refresh_work_before_research_quota();
 begin
  quota:=public.icash_research_quota_status();
  if quota is null or quota->>'checkedAt' is null or (quota->>'checkedAt')::timestamptz not between now()-interval '3 minutes' and now() then
   raise exception 'Research quota observation unavailable';
  end if;
 exception when others then
  quota:=coalesce(previous,'{}'::jsonb)||jsonb_build_object('checkedAt',previous->'checkedAt','fresh',false,'status','unavailable','warningCount',1);
 end;
 v_report:=v_report||jsonb_build_object('researchQuota',quota,'issueCount',
  (v_report->>'issueCount')::integer-coalesce((v_report->'researchQuota'->>'warningCount')::integer,0)+(quota->>'warningCount')::integer);
 update icash_reliability_private.snapshots s set report=v_report where s.id=1;
 return v_report;
end $function$;
revoke all on function public.icash_refresh_work_before_research_quota(),public.icash_refresh_account_work_snapshot() from public,anon,authenticated;
grant execute on function public.icash_refresh_work_before_research_quota(),public.icash_refresh_account_work_snapshot() to service_role;
commit;
