-- Scheduling-only headroom for the existing three-request contact admission.
-- Install disabled. No request, counter, balance, operation or queue is changed.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$begin
 if md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure))<>'14c36dd47e50e3e1cfd0a2e5f58696ef'
  or md5(pg_get_functiondef('icash_research_private.request_reserve_state(timestamptz)'::regprocedure))<>'383bbfa915185d9aa33662c84647c450'
 then raise exception 'Acquisition headroom prerequisite changed';end if;
end $$;

create table icash_research_private.acquisition_headroom_policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 capacity_hash text not null check(capacity_hash~'^[a-f0-9]{32}$'),
 activated_at timestamptz,release_sha text check(release_sha~'^[a-f0-9]{40}$'),
 check((activated_at is null)=(release_sha is null)),check(not enabled or activated_at is not null)
);
alter table icash_research_private.acquisition_headroom_policy enable row level security;
revoke all on icash_research_private.acquisition_headroom_policy from public,anon,authenticated,service_role;

CREATE OR REPLACE FUNCTION public.icash_dealmachine_capacity_available(p_requests integer, p_account uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
 -- With continuous two-request demand, paced capacity can never reach the
 -- three requests required by contact export admission. Preserve the oldest
 -- due accounts until that next token is released instead of skipping them and
 -- moving their schedule forward. Actual one-request admission is unchanged.
 if p_requests=2 and ordinary=2 and s->>'pacingActive'='true'
  and (s->>'ordinaryUnpacedRemaining')::integer>=3
  and exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and enabled) then
  protected:=least((s->>'reserveRemaining')::integer,icash_research_private.starter_request_allowance(p_account));
  return protected>0;
 end if;
 if ordinary>=p_requests then return true;end if;
 protected:=least((s->>'reserveRemaining')::integer,icash_research_private.starter_request_allowance(p_account));
 return ordinary+protected>=p_requests;
end $function$;
insert into icash_research_private.acquisition_headroom_policy(id,capacity_hash)
 values(1,md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure)));

create function icash_research_private.activate_acquisition_headroom(p_release text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare b public.icash_dealmachine_request_budget;p icash_research_private.acquisition_headroom_policy;
begin
 if p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 select * into b from public.icash_dealmachine_request_budget where id=1 for update;
 if not found or b.minute_limit<>60 or b.day_limit<>9800 or b.day_start is null
  or b.day_start>clock_timestamp() or b.day_start<=clock_timestamp()-interval '24 hours'
  or not exists(select 1 from icash_research_private.request_pacing_policy where id=1 and enabled and activate_after<=b.day_start)
  or md5(pg_get_functiondef('icash_research_private.request_reserve_state(timestamptz)'::regprocedure))<>'383bbfa915185d9aa33662c84647c450'
 then return false;end if;
 select * into p from icash_research_private.acquisition_headroom_policy where id=1 for update;
 if not found or p.capacity_hash<>md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure)) then return false;end if;
 if p.enabled then return p.release_sha=p_release;end if;
 if p.activated_at is not null then return false;end if;
 update icash_research_private.acquisition_headroom_policy set enabled=true,activated_at=clock_timestamp(),release_sha=p_release where id=1;
 return true;
end $$;
revoke all on function icash_research_private.activate_acquisition_headroom(text) from public,anon,authenticated,service_role;
-- CREATE OR REPLACE retains the existing capacity function's service-only ACL.
commit;
