-- Keep part of the existing request allowance for newly funded accounts.
-- Installation is disabled. No counter, window, provider limit or money changes.
begin;
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
commit;
