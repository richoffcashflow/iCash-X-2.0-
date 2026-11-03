begin;
-- Source: config/new-user-request-reserve.sql
-- Keep part of the existing request allowance for newly funded accounts.
-- Installation is disabled. No counter, window, provider limit or money changes.
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
begin
 if md5(pg_get_functiondef('public.icash_take_dealmachine_request()'::regprocedure))<>'89b6ddf0b83a49b05e164668878f48c7'
  or md5(pg_get_functiondef('public.icash_take_dealmachine_request(text,uuid,text,uuid)'::regprocedure))<>'ab7cd50888e7d98dfa852ab9929b53bf'
  or md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer)'::regprocedure))<>'2509a6fbbb96ee06125a8a7024f6b2dc'
  or not exists(select 1 from public.icash_dealmachine_request_budget where id=1 and day_limit=9800 and minute_limit=60) then
  raise exception 'New-user request reserve prerequisite changed';
 end if;
end $guard$;

create table icash_research_private.request_reserve_policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 reserve_requests integer not null default 980 check(reserve_requests between 1 and 9800),
 account_requests integer not null default 50 check(account_requests between 1 and 980)
);
insert into icash_research_private.request_reserve_policy(id) values(1);
create table icash_research_private.request_reserve_admissions(
 -- The request ledger is pruned after 30 days. Keep this compact admission
 -- proof independently; no FK may silently erase it or block normal pruning.
 request_id uuid primary key,account_id uuid not null references public.icash_accounts(id),
 day_start timestamptz not null,first_funded_at timestamptz not null,
 created_at timestamptz not null default clock_timestamp()
);
create index research_reserve_window on icash_research_private.request_reserve_admissions(day_start);
create index research_reserve_account on icash_research_private.request_reserve_admissions(account_id,created_at);
create index icash_funding_first_live_credit on public.icash_funding_orders(account_id,credited_at)
 where mode='live' and state='paid' and credited_at is not null;
alter table icash_research_private.request_reserve_policy enable row level security;
alter table icash_research_private.request_reserve_admissions enable row level security;
revoke all on icash_research_private.request_reserve_policy,icash_research_private.request_reserve_admissions from public,anon,authenticated,service_role;
create function icash_research_private.keep_request_reserve_admission() returns trigger
language plpgsql set search_path='' as $$begin raise exception 'Request reserve admission is immutable';end$$;
create trigger request_reserve_admission_immutable before update or delete on icash_research_private.request_reserve_admissions
 for each row execute function icash_research_private.keep_request_reserve_admission();

-- Read-only arithmetic is shared by scheduling, admission and operator reports.
-- Spent reserve is not replenished from ordinary capacity during the same day.
create function icash_research_private.request_reserve_state(p_at timestamptz default now()) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b public.icash_dealmachine_request_budget;p icash_research_private.request_reserve_policy;
 used integer;protected_used integer;remaining integer;
begin
 select * into b from public.icash_dealmachine_request_budget where id=1;
 select * into p from icash_research_private.request_reserve_policy where id=1;
 if b.id is null or p.id is null or p_at is null or b.day_start is null or b.day_start>p_at
  or b.day_limit is null or b.day_limit<=0 or b.day_used is null or b.day_used<0 then return null;end if;
 used:=case when b.day_start<=p_at-interval '24 hours' then 0 else b.day_used end;
 select count(*)::integer into protected_used from icash_research_private.request_reserve_admissions
  where day_start=b.day_start and b.day_start>p_at-interval '24 hours';
 remaining:=case when p.enabled then greatest(0,least(p.reserve_requests-protected_used,b.day_limit-used)) else 0 end;
 return jsonb_build_object('enabled',p.enabled,'reserveRequests',p.reserve_requests,'accountRequests',p.account_requests,
  'reserveUsed',protected_used,'reserveRemaining',remaining,'ordinaryRemaining',greatest(0,b.day_limit-used-remaining));
end $$;

create function icash_research_private.starter_request_allowance(p_account uuid,p_at timestamptz default now()) returns integer
language plpgsql stable security definer set search_path='' as $$
declare p icash_research_private.request_reserve_policy;first_funded timestamptz;used integer;
begin
 select * into p from icash_research_private.request_reserve_policy where id=1 and enabled;
 if not found or p_account is null or p_at is null then return 0;end if;
 -- Use the first verified live credit, never account creation or the latest
 -- top-up. Another payment cannot restart this 24-hour starter allowance.
 select credited_at into first_funded from public.icash_funding_orders
  where account_id=p_account and mode='live' and state='paid' and credited_at is not null
  order by credited_at limit 1;
 if first_funded is null or first_funded>p_at or first_funded<=p_at-interval '24 hours' then return 0;end if;
 if not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
  where a.id=p_account and not a.bot_paused and a.workspace_ack_version is not null
   and w.balance_cents>w.reserved_cents and public.icash_membership_work_allowed(a.id))
  or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
  or exists(select 1 from public.icash_support_cancel_requests c where c.account_id=p_account and c.confirmed_at is not null
   and c.confirmed_at>coalesce((select e.created_at from public.icash_control_events e
    where e.account_id=p_account and e.property_id is null order by e.created_at desc,e.id desc limit 1),'-infinity'::timestamptz)) then return 0;end if;
 -- Count the complete first-funding window, including a rolling-quota reset.
 select count(*)::integer into used from icash_research_private.request_reserve_admissions
  where account_id=p_account and created_at>=first_funded;
 return greatest(0,p.account_requests-used);
end $$;

create function public.icash_new_user_request_reserve_eligible(p_account uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select icash_research_private.starter_request_allowance(p_account)>0;
$$;

create function public.icash_dealmachine_capacity_available(p_requests integer,p_account uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare b public.icash_dealmachine_request_budget;s jsonb;ordinary integer;protected integer;
begin
 if p_requests is null or p_requests not between 1 and 60 or not public.icash_dealmachine_provider_available() then return false;end if;
 select * into b from public.icash_dealmachine_request_budget where id=1;
 if b.id is null or b.minute_start is null or b.minute_start>now() or b.minute_used is null or b.minute_used<0
  or b.minute_limit is null or b.minute_limit<=0
  or (case when b.minute_start<=now()-interval '1 minute' then 0 else b.minute_used end)+p_requests>b.minute_limit
  or (case when b.day_start<=now()-interval '24 hours' then 0 else b.day_used end)+p_requests>b.day_limit then return false;end if;
 s:=icash_research_private.request_reserve_state();
 if s is null then return false;end if;
 ordinary:=(s->>'ordinaryRemaining')::integer;
 if ordinary>=p_requests then return true;end if;
 protected:=least((s->>'reserveRemaining')::integer,icash_research_private.starter_request_allowance(p_account));
 return ordinary+protected>=p_requests;
end $$;
create or replace function public.icash_dealmachine_capacity_available(p_requests integer default 2) returns boolean
language sql stable security invoker set search_path='' as $$
 select public.icash_dealmachine_capacity_available(p_requests,null::uuid);
$$;

-- One database lock serializes both request counts and reserve debits. This
-- takes no account/operating locks after the quota lock; caller admissions keep
-- their existing lock order and financial/source/recipient authority.
create function icash_research_private.take_reserved_request(p_kind text,p_account uuid,p_operation text,p_request uuid) returns boolean
language plpgsql security definer set search_path='' as $$
declare b public.icash_dealmachine_request_budget;s jsonb;allowed boolean:=false;protected boolean:=false;
 stamp timestamptz;first_funded timestamptz;
begin
 if p_request is not null and (p_kind is null or p_kind not in ('search_estimate','property_search','owner_preview','owner_lookup','exclusion_create','exclusion_sync','geography','buyer_estimate','buyer_search','property_lookup','photo')
  or length(coalesce(p_operation,''))>200) then return false;end if;
 select * into b from public.icash_dealmachine_request_budget where id=1 for update;
 if not found then return false;end if;
 if p_request is not null and (exists(select 1 from icash_research_private.requests where id=p_request)
  or exists(select 1 from icash_research_private.request_reserve_admissions where request_id=p_request)) then return false;end if;
 -- Recheck time after waiting on the limiter, so a stale transaction cannot
 -- extend the new account's first 24 hours or the provider's rolling window.
 stamp:=clock_timestamp();
 s:=icash_research_private.request_reserve_state(stamp);
 if s is not null and public.icash_dealmachine_provider_available()
  and b.minute_start<=stamp and b.minute_used>=0 and b.minute_limit>0 then
  if b.minute_start<=stamp-interval '1 minute' then b.minute_start:=stamp;b.minute_used:=0;end if;
  if b.day_start<=stamp-interval '24 hours' then b.day_start:=stamp;b.day_used:=0;end if;
  if b.minute_used<b.minute_limit and b.day_used<b.day_limit then
   allowed:=(s->>'ordinaryRemaining')::integer>0;
   if not allowed and p_request is not null and p_operation is not null and length(p_operation)>0
    and p_kind in ('search_estimate','property_search','owner_preview','owner_lookup','geography','property_lookup')
    and (s->>'reserveRemaining')::integer>0
    and icash_research_private.starter_request_allowance(p_account,stamp)>0 then
    allowed:=true;protected:=true;
   end if;
  end if;
 end if;
 if p_request is not null then
  insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted,result)
   values(p_request,p_kind,p_account,p_operation,allowed,case when allowed then null else '{"outcome":"quota_wait"}'::jsonb end);
 end if;
 if not allowed then return false;end if;
 if protected then
  select credited_at into first_funded from public.icash_funding_orders
   where account_id=p_account and mode='live' and state='paid' and credited_at is not null order by credited_at limit 1;
  insert into icash_research_private.request_reserve_admissions(request_id,account_id,day_start,first_funded_at,created_at)
   values(p_request,p_account,b.day_start,first_funded,stamp);
 end if;
 update public.icash_dealmachine_request_budget set minute_start=b.minute_start,minute_used=b.minute_used+1,
  day_start=b.day_start,day_used=b.day_used+1 where id=1;
 return true;
end $$;
create or replace function public.icash_take_dealmachine_request() returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 return icash_research_private.take_reserved_request(null,null,null,null);
end $$;
create or replace function public.icash_take_dealmachine_request(p_kind text,p_account uuid,p_operation text,p_request uuid) returns boolean
language plpgsql security definer set search_path='' as $$
begin
 if p_request is null then return false;end if;
 return icash_research_private.take_reserved_request(p_kind,p_account,p_operation,p_request);
end $$;
-- The legacy wrapper also needs definer access to the private limiter. Its
-- caller still receives ordinary capacity only, never account-less reserve.
alter function public.icash_take_dealmachine_request() security definer;
revoke all on function icash_research_private.keep_request_reserve_admission(),icash_research_private.request_reserve_state(timestamptz),
 icash_research_private.starter_request_allowance(uuid,timestamptz),icash_research_private.take_reserved_request(text,uuid,text,uuid)
 from public,anon,authenticated,service_role;
revoke all on function public.icash_new_user_request_reserve_eligible(uuid),public.icash_dealmachine_capacity_available(integer,uuid),
 public.icash_dealmachine_capacity_available(integer),public.icash_take_dealmachine_request(),public.icash_take_dealmachine_request(text,uuid,text,uuid)
 from public,anon,authenticated,service_role;
grant execute on function public.icash_new_user_request_reserve_eligible(uuid),public.icash_dealmachine_capacity_available(integer,uuid),
 public.icash_dealmachine_capacity_available(integer),public.icash_take_dealmachine_request(),public.icash_take_dealmachine_request(text,uuid,text,uuid) to service_role;

-- Source: config/new-user-request-reserve-scheduling.sql
-- Give eligible newly funded accounts access to their protected request pool.
-- This is scheduling only; every provider request still uses the atomic limiter.
set local lock_timeout='5s';
set local statement_timeout='30s';

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_owner_active_export_capacity()'::regprocedure);
 if md5(d)<>'8ea19b4d6de0fca19265db1d4663f843' then raise exception 'New-user export capacity prerequisite changed';end if;
 d:=replace(d,'public.icash_owner_active_export_capacity()','public.icash_owner_active_export_capacity(p_account uuid)');
 execute replace(d,'public.icash_dealmachine_capacity_available(3)','public.icash_dealmachine_capacity_available(3,p_account)');

 d:=pg_get_functiondef('public.icash_outbound_search_due(uuid)'::regprocedure);
 if md5(d)<>'5bcdaf85d8414b121cdb08104f96398f' then raise exception 'New-user search scheduling prerequisite changed';end if;
 execute replace(d,'public.icash_dealmachine_capacity_available()','public.icash_dealmachine_capacity_available(2,p_account)');

 d:=pg_get_functiondef('public.icash_enrichment_candidate(uuid)'::regprocedure);
 if md5(d)<>'1c00583c90386cfc8e2fc6ce9f06edd7' then raise exception 'New-user contact scheduling prerequisite changed';end if;
 d:=replace(d,'public.icash_dealmachine_capacity_available()','public.icash_dealmachine_capacity_available(2,p_account)');
 execute replace(d,'public.icash_owner_active_export_capacity()','public.icash_owner_active_export_capacity(p_account)');

 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 if md5(d)<>'f1ee49aef89a9557ad6b31cb93d2f840' then raise exception 'New-user acquisition scheduling prerequisite changed';end if;
 -- Filter by the account before ranking/LIMIT. A global ordinary-pool check
 -- would incorrectly stop every newly funded account at the reserve boundary.
 d:=replace(d,' if not public.icash_dealmachine_capacity_available() then return null;end if;','');
 needle:='where d.enabled and d.auto_enabled and d.next_run_at<=now()';
 d:=replace(d,needle,needle||' and public.icash_dealmachine_capacity_available(2,d.account_id)');
 needle:='case when d.next_run_at<now()-interval ''10 minutes'' then d.next_run_at end nulls last,';
 d:=replace(d,needle,needle||E'\n  public.icash_new_user_request_reserve_eligible(d.account_id) desc,');
 -- Keep the existing overdue-account aging escape, due-preflight/retry order,
 -- financial quote, backlog, source eligibility and final admission checks.
 d:=replace(d,'and public.icash_owner_active_export_capacity() in (''disabled'',''ready'')'||E'\n   then',
  'and public.icash_owner_active_export_capacity(d.account_id) in (''disabled'',''ready'')'||E'\n   then');
 d:=replace(d,'where c.contacts_enabled and public.icash_owner_active_export_capacity()','where c.contacts_enabled and public.icash_owner_active_export_capacity(c.account_id)');
 execute d;

 d:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 if md5(d)<>'18737fd983247a44e209c2bd347ef84f' then raise exception 'New-user ticket scheduling prerequisite changed';end if;
 d:=replace(d,'public.icash_dealmachine_capacity_available()','public.icash_dealmachine_capacity_available(2,x.account_id)');
 execute replace(d,'public.icash_owner_active_export_capacity()','public.icash_owner_active_export_capacity(x.account_id)');

 d:=pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure);
 if md5(d)<>'470d62a2b58b43afe1217235c85abfbf' then raise exception 'New-user preflight priority prerequisite changed';end if;
 execute replace(d,'public.icash_dealmachine_capacity_available(3)','public.icash_dealmachine_capacity_available(3,p_account)');

 d:=pg_get_functiondef('public.icash_claim_owner_preflight(uuid,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'ba5c62b61b1a33cd80215e78dde10b5a' then raise exception 'New-user preflight claim prerequisite changed';end if;
 d:=replace(d,'public.icash_dealmachine_capacity_available(3)','public.icash_dealmachine_capacity_available(3,p_account)');
 execute replace(d,'public.icash_dealmachine_capacity_available(1)','public.icash_dealmachine_capacity_available(1,p_account)');

 d:=pg_get_functiondef('icash_research_private.owner_preflight_quota_resume(uuid,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'d5e4294425f94d13d1b9042efd60cebe' then raise exception 'New-user preflight recovery prerequisite changed';end if;
 execute replace(d,'public.icash_dealmachine_capacity_available(case when d.step=''baseline'' then 3 else 1 end)',
  'public.icash_dealmachine_capacity_available(case when d.step=''baseline'' then 3 else 1 end,p.account_id)');

 d:=pg_get_functiondef('public.icash_claim_owner_preflight_cleanup(uuid)'::regprocedure);
 if md5(d)<>'7be99ed4f1291f556c56fd36abae3a63' then raise exception 'New-user preflight cleanup prerequisite changed';end if;
 d:=replace(d,' if not public.icash_dealmachine_capacity_available(1) then return null;end if;','');
 d:=replace(d,'where (p_id is null or id=p_id) and list_id is not null',
  'where (p_id is null or id=p_id) and public.icash_dealmachine_capacity_available(1,account_id) and list_id is not null');
 execute replace(d,'jsonb_build_object(''id'',p.id,''token'',p.cleanup_token,''listId'',p.list_id)',
  'jsonb_build_object(''id'',p.id,''token'',p.cleanup_token,''listId'',p.list_id,''accountId'',p.account_id)');
end $patch$;

revoke all on function public.icash_owner_active_export_capacity(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_owner_active_export_capacity(uuid) to service_role;

-- Source: config/new-user-request-reserve-exclusions.sql
-- An already attached exclusion list is a hard search prerequisite. Let an
-- eligible starter synchronize that exact list once from its own allowance.
-- Accountless maintenance and list creation/recovery remain ordinary work.
set local lock_timeout='5s';
set local statement_timeout='30s';
create table icash_research_private.request_reserve_exclusion_claims(
 token uuid primary key,account_id uuid not null references public.icash_accounts(id),
 list_id text not null,created_at timestamptz not null default clock_timestamp()
);
alter table icash_research_private.request_reserve_exclusion_claims enable row level security;
revoke all on icash_research_private.request_reserve_exclusion_claims from public,anon,authenticated,service_role;

create function icash_research_private.starter_exclusion_request_allowed(p_account uuid,p_operation text,p_at timestamptz)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_research_private.request_reserve_exclusion_claims claim
  join icash_research_private.exclusions s on s.id=1 and s.token=claim.token and s.list_id=claim.list_id
  join public.icash_discovery_configs c on c.account_id=claim.account_id and c.research_list_id=claim.list_id
  where claim.account_id=p_account and p_operation='starter-exclusion:'||claim.token
   and claim.created_at<=p_at and s.lease_until>p_at and s.state='ready' and cardinality(s.batch)>0
   and c.enabled and c.auto_enabled and not c.exhausted and c.data_rights_until>p_at and c.research_version in (1,2)
   and exists(select 1 from icash_research_private.settings where id=1 and enabled and exclusions_enabled)
   and not exists(select 1 from icash_research_private.requests r where r.account_id=p_account
    and r.kind='exclusion_sync' and r.operation_key=p_operation and r.admitted));
$$;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_claim_research_exclusions()'::regprocedure);
 if md5(d)<>'2acad0140b2f0491097e81f8686851cf' then raise exception 'Starter exclusion claim prerequisite changed';end if;
 d:=replace(d,'public.icash_claim_research_exclusions()','public.icash_claim_starter_research_exclusions(p_account uuid)');
 d:=replace(d,E'begin\n',E'begin\n if public.icash_dealmachine_capacity_available(1) then return public.icash_claim_research_exclusions();end if;\n if not public.icash_new_user_request_reserve_eligible(p_account) then return null;end if;\n');
 d:=replace(d,'not public.icash_dealmachine_capacity_available(1) then','not public.icash_dealmachine_capacity_available(1,p_account) then');
 needle:=' if s.list_id is null then action:=';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter exclusion list boundary changed';end if;
 d:=replace(d,needle,$insert$
 if s.list_id is null or s.state<>'ready' or not exists(select 1 from public.icash_discovery_configs c
  where c.account_id=p_account and c.research_list_id=s.list_id and c.research_version in (1,2)
   and c.enabled and c.auto_enabled and not c.exhausted and c.data_rights_until>clock_timestamp()) then return null;end if;
$insert$||needle);
 needle:=' return jsonb_build_object(''action'',action,''token'',t,''name'',s.name,''listId'',s.list_id,''ids'',ids);';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter exclusion result changed';end if;
 execute replace(d,needle,$replacement$
 insert into icash_research_private.request_reserve_exclusion_claims(token,account_id,list_id) values(t,p_account,s.list_id);
 return jsonb_build_object('action',action,'token',t,'name',s.name,'listId',s.list_id,'ids',ids,'accountId',p_account);
$replacement$);
 d:=pg_get_functiondef('icash_research_private.take_reserved_request(text,uuid,text,uuid)'::regprocedure);
 needle:='and p_kind in (''search_estimate'',''property_search'',''owner_preview'',''owner_lookup'',''geography'',''property_lookup'')';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Starter exclusion limiter boundary changed';end if;
 execute replace(d,needle,'and (p_kind in (''search_estimate'',''property_search'',''owner_preview'',''owner_lookup'',''geography'',''property_lookup'')
    or (p_kind=''exclusion_sync'' and icash_research_private.starter_exclusion_request_allowed(p_account,p_operation,stamp)))');
end $patch$;
revoke all on function icash_research_private.starter_exclusion_request_allowed(uuid,text,timestamptz),
 public.icash_claim_starter_research_exclusions(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_claim_starter_research_exclusions(uuid) to service_role;

-- Source: config/new-user-request-reserve-monitoring.sql
-- Keep protected startup capacity distinct from exhausted provider capacity.
-- This projection never admits work, resets counters or alters reserve policy.
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
