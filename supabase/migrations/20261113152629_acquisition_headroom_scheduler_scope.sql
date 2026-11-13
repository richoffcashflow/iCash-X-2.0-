-- Scope the still-disabled headroom policy to queue selection only.
-- Restore the original shared availability function before wiring selectors.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $$
declare s text;removed text:=$removed$ -- With continuous two-request demand, paced capacity can never reach the
 -- three requests required by contact export admission. Preserve the oldest
 -- due accounts until that next token is released instead of skipping them and
 -- moving their schedule forward. Actual one-request admission is unchanged.
 if p_requests=2 and ordinary=2 and s->>'pacingActive'='true'
  and (s->>'ordinaryUnpacedRemaining')::integer>=3
  and exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and enabled) then
  protected:=least((s->>'reserveRemaining')::integer,icash_research_private.starter_request_allowance(p_account));
  return protected>0;
 end if;
$removed$;
begin
 if not exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and not enabled
    and activated_at is null and release_sha is null and capacity_hash='ad1b1ef4732f261482048114a3aa0599')
  or md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure))<>'ad1b1ef4732f261482048114a3aa0599'
  or md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))<>'1d56b57c8804415e5bf161ea887a18ef'
  or md5(pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure))<>'3914f952607c672faf25866ab5ade525'
  or md5(pg_get_functiondef('icash_research_private.request_reserve_state(timestamptz)'::regprocedure))<>'383bbfa915185d9aa33662c84647c450'
 then raise exception 'Acquisition scheduler scope prerequisite changed';end if;
 s:=pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure);
 if strpos(s,removed)=0 then raise exception 'Acquisition shared capacity restoration missing';end if;
 execute replace(s,removed,'');
 if md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure))<>'14c36dd47e50e3e1cfd0a2e5f58696ef'
 then raise exception 'Acquisition shared capacity restoration changed';end if;
end $$;

create function public.icash_acquisition_capacity_available(p_account uuid) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare s jsonb;protected integer;
begin
 if not public.icash_dealmachine_capacity_available(2,p_account) then return false;end if;
 if not exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and enabled) then return true;end if;
 s:=icash_research_private.request_reserve_state();
 if s is null then return false;end if;
 if (s->>'ordinaryRemaining')::integer=2 and s->>'pacingActive'='true'
  and (s->>'ordinaryUnpacedRemaining')::integer>=3 then
  protected:=least((s->>'reserveRemaining')::integer,icash_research_private.starter_request_allowance(p_account));
  return protected>0;
 end if;
 return true;
end $$;
revoke all on function public.icash_acquisition_capacity_available(uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_acquisition_capacity_available(uuid) to service_role;

do $$
declare s text;
begin
 s:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 execute replace(s,'public.icash_dealmachine_capacity_available(2,d.account_id)','public.icash_acquisition_capacity_available(d.account_id)');
 s:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 execute replace(s,'public.icash_dealmachine_capacity_available(2,x.account_id)','public.icash_acquisition_capacity_available(x.account_id)');
end $$;
alter table icash_research_private.acquisition_headroom_policy
 add column acquisition_hash text check(acquisition_hash~'^[a-f0-9]{32}$'),
 add column resume_hash text check(resume_hash~'^[a-f0-9]{32}$');
update icash_research_private.acquisition_headroom_policy set
 capacity_hash=md5(pg_get_functiondef('public.icash_acquisition_capacity_available(uuid)'::regprocedure)),
 acquisition_hash=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure)),
 resume_hash=md5(pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure)) where id=1;
alter table icash_research_private.acquisition_headroom_policy
 alter column acquisition_hash set not null,alter column resume_hash set not null;

create or replace function icash_research_private.activate_acquisition_headroom(p_release text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare b public.icash_dealmachine_request_budget;p icash_research_private.acquisition_headroom_policy;
begin
 if p_release is null or p_release!~'^[a-f0-9]{40}$' then return false;end if;
 select * into b from public.icash_dealmachine_request_budget where id=1 for update;
 if not found or b.minute_limit<>60 or b.day_limit<>9800 or b.day_start is null
  or b.day_start>clock_timestamp() or b.day_start<=clock_timestamp()-interval '24 hours'
  or not exists(select 1 from icash_research_private.request_pacing_policy where id=1 and enabled and activate_after<=b.day_start)
  or md5(pg_get_functiondef('icash_research_private.request_reserve_state(timestamptz)'::regprocedure))<>'383bbfa915185d9aa33662c84647c450'
  or md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure))<>'14c36dd47e50e3e1cfd0a2e5f58696ef'
 then return false;end if;
 select * into p from icash_research_private.acquisition_headroom_policy where id=1 for update;
 if not found or p.capacity_hash<>md5(pg_get_functiondef('public.icash_acquisition_capacity_available(uuid)'::regprocedure))
  or p.acquisition_hash<>md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))
  or p.resume_hash<>md5(pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure)) then return false;end if;
 if p.enabled then return p.release_sha=p_release;end if;
 if p.activated_at is not null then return false;end if;
 update icash_research_private.acquisition_headroom_policy set enabled=true,activated_at=clock_timestamp(),release_sha=p_release where id=1;
 return true;
end $$;
revoke all on function icash_research_private.activate_acquisition_headroom(text) from public,anon,authenticated,service_role;
-- CREATE OR REPLACE preserves the original scheduler and shared capacity ACLs.
commit;
