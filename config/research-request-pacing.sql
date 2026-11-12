-- Install disabled. Activate only for a future normal quota window after release.
-- No counter/window reset, provider requests, starter reallocation or money changes.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
begin
 if md5(pg_get_functiondef('icash_research_private.request_reserve_state(timestamptz)'::regprocedure))<>'59c2e35202a639a8e43979281860d043' then raise exception 'Request pacing prerequisite changed: request_reserve_state';end if;
 if md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure))<>'14c36dd47e50e3e1cfd0a2e5f58696ef' then raise exception 'Request pacing prerequisite changed: icash_dealmachine_capacity_available';end if;
 if md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer)'::regprocedure))<>'3a6740504161af731f6e27ff4788f74a' then raise exception 'Request pacing prerequisite changed: icash_dealmachine_capacity_available';end if;
 if md5(pg_get_functiondef('icash_research_private.starter_exclusion_request_allowed(uuid,text,timestamptz)'::regprocedure))<>'34ff4553e0d099cef6a309d9b1389463' then raise exception 'Request pacing prerequisite changed: starter_exclusion_request_allowed';end if;
 if md5(pg_get_functiondef('public.icash_claim_starter_research_exclusions(uuid)'::regprocedure))<>'c3e4e7cff174d7c0f61f5b0dce99f6ba' then raise exception 'Request pacing prerequisite changed: icash_claim_starter_research_exclusions';end if;
 if md5(pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure))<>'6a435ad150610b1e736120971211488c' then raise exception 'Request pacing prerequisite changed: icash_claim_research_exclusions';end if;
 if md5(pg_get_functiondef('icash_research_private.take_reserved_request(text,uuid,text,uuid)'::regprocedure))<>'f359db13a8fe36ae8423a44e446b3939' then raise exception 'Request pacing prerequisite changed: take_reserved_request';end if;
 if md5(pg_get_functiondef('public.icash_research_quota_status()'::regprocedure))<>'51f7022ff773856bbe5edde30075e7f1' then raise exception 'Quota monitoring prerequisite changed';end if;
 if not exists(select 1 from public.icash_dealmachine_request_budget where id=1 and day_limit=9800 and minute_limit=60) then raise exception 'Request limits changed';end if;
end $guard$;
create table icash_research_private.request_pacing_policy(
 id integer primary key check(id=1), enabled boolean not null default false,
 activate_after timestamptz,
 maintenance_requests integer not null default 196 check(maintenance_requests between 1 and 196),
 burst_seconds integer not null default 3600 check(burst_seconds between 60 and 3600),
 check(not enabled or activate_after is not null)
);
insert into icash_research_private.request_pacing_policy(id) values(1);
create table icash_research_private.maintenance_request_admissions(
 request_id uuid primary key, token uuid not null unique, list_id text not null,
 protected boolean not null, day_start timestamptz not null, created_at timestamptz not null default clock_timestamp()
);
create index research_maintenance_window on icash_research_private.maintenance_request_admissions(day_start);
alter table icash_research_private.request_pacing_policy enable row level security;
alter table icash_research_private.maintenance_request_admissions enable row level security;
revoke all on icash_research_private.request_pacing_policy,icash_research_private.maintenance_request_admissions from public,anon,authenticated,service_role;
create trigger maintenance_request_immutable before update or delete on icash_research_private.maintenance_request_admissions
 for each row execute function icash_research_private.keep_request_reserve_admission();

CREATE OR REPLACE FUNCTION icash_research_private.request_reserve_state(p_at timestamp with time zone DEFAULT now())
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.icash_dealmachine_request_budget;p icash_research_private.request_reserve_policy;
 used integer;protected_used integer;remaining integer;pace icash_research_private.request_pacing_policy;maintenance_used integer:=0;maintenance_remaining integer:=0;
 raw_remaining integer;next_pace timestamptz;ordinary_budget integer;ordinary_used integer;ordinary_remaining integer;released integer;window_start timestamptz;active boolean:=false;
begin
 select * into b from public.icash_dealmachine_request_budget where id=1;
 select * into p from icash_research_private.request_reserve_policy where id=1;
 if b.id is null or p.id is null or p_at is null or b.day_start is null or b.day_start>p_at
  or b.day_limit is null or b.day_limit<=0 or b.day_used is null or b.day_used<0 then return null;end if;
 used:=case when b.day_start<=p_at-interval '24 hours' then 0 else b.day_used end;
 select count(*)::integer into protected_used from icash_research_private.request_reserve_admissions
  where day_start=b.day_start and b.day_start>p_at-interval '24 hours';
 remaining:=case when p.enabled then greatest(0,least(p.reserve_requests-protected_used,b.day_limit-used)) else 0 end;
 select * into pace from icash_research_private.request_pacing_policy where id=1;
 -- An expired bucket is only projected here; the original admitted request
 -- advances the real window, under the existing global quota lock.
 window_start:=case when b.day_start<=p_at-interval '24 hours' then p_at else b.day_start end;
 active:=coalesce(pace.enabled and pace.activate_after is not null and window_start>=pace.activate_after,false);
 ordinary_remaining:=greatest(0,b.day_limit-used-remaining);
 raw_remaining:=ordinary_remaining;
 if active then
  select count(*)::integer into maintenance_used from icash_research_private.maintenance_request_admissions
   where protected and day_start=b.day_start and b.day_start>p_at-interval '24 hours';
  maintenance_remaining:=greatest(0,least(pace.maintenance_requests-maintenance_used,ordinary_remaining));
  ordinary_budget:=greatest(0,b.day_limit-case when p.enabled then p.reserve_requests else 0 end-pace.maintenance_requests);
  ordinary_used:=greatest(0,used-protected_used-maintenance_used);
  released:=least(ordinary_budget,floor(ordinary_budget * least(86400::numeric,
   greatest(0::numeric,extract(epoch from p_at-window_start))+pace.burst_seconds)/86400)::integer);
  raw_remaining:=greatest(0,ordinary_remaining-maintenance_remaining);
  ordinary_remaining:=least(raw_remaining,greatest(0,released-ordinary_used));
  if ordinary_remaining<2 and raw_remaining>=2 and ordinary_budget>0 then
   next_pace:=greatest(p_at,window_start+make_interval(secs=>ceil((ordinary_used+2)::numeric*86400/ordinary_budget)::double precision-pace.burst_seconds));
  end if;
 end if;
 return jsonb_build_object('enabled',p.enabled,'reserveRequests',p.reserve_requests,'accountRequests',p.account_requests,
  'reserveUsed',protected_used,'reserveRemaining',remaining,'ordinaryRemaining',ordinary_remaining,'pacingActive',active,'ordinaryUnpacedRemaining',raw_remaining,'nextPacedAvailableAt',next_pace,'maintenanceUsed',maintenance_used,
  'maintenanceRemaining',maintenance_remaining,'nextResetAt',window_start+interval '24 hours');
end $function$
;

create function icash_research_private.maintenance_exclusion_allowed(p_operation text,p_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_research_private.exclusions e
  where e.id=1 and e.state='ready' and e.list_id is not null and e.token is not null
   and p_operation='maintenance-exclusion:'||e.token and e.lease_until>p_at and cardinality(e.batch)>0
   and exists(select 1 from icash_research_private.settings where id=1 and enabled and (exclusions_enabled or exclusion_sync_enabled))
   and not exists(select 1 from icash_research_private.maintenance_request_admissions a where a.token=e.token));
$$;
create function icash_research_private.maintenance_capacity_available(p_at timestamptz default now())
returns boolean language plpgsql stable security definer set search_path='' as $$
declare b public.icash_dealmachine_request_budget;s jsonb;
begin
 select * into b from public.icash_dealmachine_request_budget where id=1;
 s:=icash_research_private.request_reserve_state(p_at);
 return coalesce(public.icash_dealmachine_provider_available() and (s->>'maintenanceRemaining')::integer>0
  and b.minute_start<=p_at and b.minute_used>=0 and b.minute_limit>0
  and (case when b.minute_start<=p_at-interval '1 minute' then 0 else b.minute_used end)<b.minute_limit
  and (case when b.day_start<=p_at-interval '24 hours' then 0 else b.day_used end)<b.day_limit,false);
end $$;
CREATE OR REPLACE FUNCTION icash_research_private.take_reserved_request(p_kind text, p_account uuid, p_operation text, p_request uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare b public.icash_dealmachine_request_budget;s jsonb;allowed boolean:=false;protected boolean:=false;maintenance boolean:=false;bound_sync boolean:=false;
 stamp timestamptz;first_funded timestamptz;
begin
 if p_request is not null and (p_kind is null or p_kind not in ('search_estimate','property_search','owner_preview','owner_lookup','exclusion_create','exclusion_sync','geography','buyer_estimate','buyer_search','property_lookup','photo','phone_dnc')
  or length(coalesce(p_operation,''))>200) then return false;end if;
 select * into b from public.icash_dealmachine_request_budget where id=1 for update;
 if not found then return false;end if;
 if p_request is not null and (exists(select 1 from icash_research_private.requests where id=p_request)
  or exists(select 1 from icash_research_private.request_reserve_admissions where request_id=p_request)
  or exists(select 1 from icash_research_private.maintenance_request_admissions where request_id=p_request)) then return false;end if;
 -- Recheck time after waiting on the limiter, so a stale transaction cannot
 -- extend the new account's first 24 hours or the provider's rolling window.
 stamp:=clock_timestamp();
 s:=icash_research_private.request_reserve_state(stamp);
 bound_sync:=p_request is not null and p_account is null and p_kind='exclusion_sync'
  and icash_research_private.maintenance_exclusion_allowed(p_operation,stamp);
 if s is not null and public.icash_dealmachine_provider_available()
  and b.minute_start<=stamp and b.minute_used>=0 and b.minute_limit>0 then
  if b.minute_start<=stamp-interval '1 minute' then b.minute_start:=stamp;b.minute_used:=0;end if;
  if b.day_start<=stamp-interval '24 hours' then b.day_start:=stamp;b.day_used:=0;end if;
  if b.minute_used<b.minute_limit and b.day_used<b.day_limit then
   -- Only a live exact attached-list sync may use the bounded maintenance lane.
   -- Never list creation/recovery, paid work, caller-supplied labels or starter money.
   if bound_sync and (s->>'maintenanceRemaining')::integer>0 then
    allowed:=true;maintenance:=true;
   else
    allowed:=(s->>'ordinaryRemaining')::integer>0;
   end if;
   if not allowed and p_request is not null and p_operation is not null and length(p_operation)>0
    and (p_kind in ('search_estimate','property_search','owner_preview','owner_lookup','geography','property_lookup')
    or (p_kind='exclusion_sync' and icash_research_private.starter_exclusion_request_allowed(p_account,p_operation,stamp)))
    and (s->>'reserveRemaining')::integer>0
    and icash_research_private.starter_request_allowance(p_account,stamp)>0 then
    allowed:=true;protected:=true;
   end if;
  end if;
 end if;
 if p_operation like 'maintenance-exclusion:%' and not coalesce(bound_sync,false) then allowed:=false;end if;
 if p_request is not null then
  insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result)
   values(p_request,p_kind,p_account,p_operation,allowed,case when allowed then null else '{"outcome":"quota_wait"}'::jsonb end);
 end if;
 if not allowed then return false;end if;
 if bound_sync then
  insert into icash_research_private.maintenance_request_admissions(request_id,token,list_id,protected,day_start,created_at)
   select p_request,e.token,e.list_id,maintenance,b.day_start,stamp from icash_research_private.exclusions e
    where e.id=1 and p_operation='maintenance-exclusion:'||e.token;
  if not found then raise exception 'Maintenance request binding changed';end if;
 end if;
 if protected then
  select credited_at into first_funded from public.icash_funding_orders
   where account_id=p_account and mode='live' and state='paid' and credited_at is not null order by credited_at limit 1;
  insert into icash_research_private.request_reserve_admissions(request_id,account_id,day_start,first_funded_at,created_at)
   values(p_request,p_account,b.day_start,first_funded,stamp);
 end if;
 update public.icash_dealmachine_request_budget set minute_start=b.minute_start,minute_used=b.minute_used+1,
  day_start=b.day_start,day_used=b.day_used+1 where id=1;
 return true;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_research_exclusions()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare s icash_research_private.exclusions;ids text[];t uuid:=gen_random_uuid();action text;
begin
 if not exists(select 1 from icash_research_private.settings where id=1 and enabled and (exclusions_enabled or exclusion_sync_enabled)) or not (public.icash_dealmachine_capacity_available(1) or icash_research_private.maintenance_capacity_available()) then return null;end if;
 if exists(select 1 from icash_research_private.settings where id=1 and pruned_at<now()-interval '1 day') then
  perform public.icash_prune_research_requests();update icash_research_private.settings set pruned_at=now() where id=1;
 end if;
 select * into s from icash_research_private.exclusions where id=1 for update skip locked;
 if not found or s.next_at>now() or s.lease_until>now() then return null;end if;

 if not exists(select 1 from icash_research_private.settings where id=1 and enabled and exclusions_enabled) then
  if s.list_id is null or s.state<>'ready' or not exists(select 1 from icash_research_private.settings
   where id=1 and enabled and exclusion_sync_enabled) then return null;end if;
 end if;
 if not public.icash_dealmachine_capacity_available(1) and (s.list_id is null or s.state<>'ready') then return null;end if;
 if s.list_id is null then action:=case when s.state='new' then 'create' else 'recover' end;ids:='{}';
 else select coalesce(array_agg(property_id),'{}') into ids from (select property_id from (
  select property_id from icash_research_private.exclusion_items where synced_at is null
  union select property_id from icash_research_private.targeting_acquired_properties where synced_at is null and (
   (exists(select 1 from icash_research_private.targeting_settings where id=1 and enabled) or exists(select 1 from icash_research_private.financial_settings where id=1 and enabled))
   or exists(select 1 from public.icash_discovery_filter_pages where plan->>'version'='seller-targeting-v1' and state not in ('empty','unavailable')))
 ) pending order by property_id limit 1000) x;
  if cardinality(ids)=0 then return null;end if;action:='sync';
 end if;
 update icash_research_private.exclusions set token=t,lease_until=now()+interval '1 minute',next_at=now()+interval '10 seconds',batch=ids,state=case when action='create' then 'creating' else state end where id=1;
 return jsonb_build_object('action',action,'token',t,'name',s.name,'listId',s.list_id,'ids',ids);
end $function$
;

revoke all on function icash_research_private.maintenance_exclusion_allowed(text,timestamptz),
 icash_research_private.maintenance_capacity_available(timestamptz) from public,anon,authenticated,service_role;
-- All altered functions retain their original private/service-only ACLs.

CREATE OR REPLACE FUNCTION public.icash_research_quota_status()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  when ordinary_remaining<2 and (r->>'pacingActive')::boolean and (r->>'ordinaryUnpacedRemaining')::integer>=2 then 'paced_wait'
  when ordinary_remaining<2 then 'reserved_for_new_users' else 'available' end;
 next_at:=greatest((r->>'nextPacedAvailableAt')::timestamptz,case when day_used+2>b.day_limit or state='reserved_for_new_users' then b.day_start+interval '24 hours' end,
  case when minute_used+2>b.minute_limit then b.minute_start+interval '1 minute' end,
  case when f.blocked_until>now() then f.blocked_until end);
 return jsonb_build_object('checkedAt',now(),'fresh',true,'status',state,
  'warningCount',case when state in ('day_exhausted','day_insufficient','provider_hold') then 1 else 0 end,
  'dayUsed',day_used,'dayLimit',b.day_limit,'dayRemaining',greatest(0,b.day_limit-day_used),
  'minuteUsed',minute_used,'minuteLimit',b.minute_limit,'minuteRemaining',greatest(0,b.minute_limit-minute_used),
  'reserveEnabled',r->'enabled','reserveRequests',r->'reserveRequests','reserveUsed',r->'reserveUsed',
  'reserveRemaining',r->'reserveRemaining','ordinaryRemaining',r->'ordinaryRemaining','pacingActive',r->'pacingActive',
  'maintenanceRemaining',r->'maintenanceRemaining','ordinaryUnpacedRemaining',r->'ordinaryUnpacedRemaining',
  'dayStartedAt',b.day_start,'dayResetsAt',case when b.day_start>now()-interval '24 hours' then b.day_start+interval '24 hours' end,
  'nextAvailableAt',next_at,'providerBlockedUntil',case when f.blocked_until>now() then f.blocked_until end,
  'providerObservedAt',f.request_started_at,'providerDayLimit',f.headers->'dayLimit','providerDayRemaining',f.headers->'dayRemaining');
end $function$
;
