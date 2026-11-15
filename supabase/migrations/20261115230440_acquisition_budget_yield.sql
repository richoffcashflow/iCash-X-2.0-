-- A research poll must not hold the shared scheduler advisory lock while
-- waiting for an unrelated funding/settlement transaction's budget row.
-- Yield before selection when busy; retain the same authoritative row lock
-- when available. The release runner owns the migration-ledger transaction.
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path='';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;

do $patch$
declare d text;actual record;new_hash text;
 needle text:='perform 1 from public.icash_operating_budget where id=1 and enabled for update;';
begin
 if not exists(select 1 from public.icash_operating_budget where id=1) then
  raise exception 'Acquisition budget yield budget unavailable';
 end if;
 select p.*,pg_get_functiondef(p.oid) definition into actual
  from pg_proc p where p.oid='public.icash_next_acquisition()'::regprocedure;
 if md5(actual.definition) is distinct from '74354d757bc909e3c21923f47c368e24'
  or pg_get_userbyid(actual.proowner) is distinct from 'postgres'
  or actual.prosecdef or actual.provolatile::text is distinct from 'v'
  or not has_function_privilege('service_role',actual.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
   where acl.privilege_type='EXECUTE' and acl.grantee not in
    (actual.proowner,(select oid from pg_roles where rolname='service_role'))) then
  raise exception 'Acquisition budget yield scheduler prerequisite changed';
 end if;
 -- Lock and validate the already active policy chain. Do not reactivate it or
 -- replace any other dependency hash, release receipt or fairness counter.
 perform 1 from icash_work_private.continuation_policy where id=1 for update;
 perform 1 from icash_work_private.preflight_step_policy where id=1 for update;
 perform 1 from icash_research_private.acquisition_headroom_policy where id=1 for update;
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and scheduler_hash=md5(actual.definition))
  or not exists(select 1 from icash_work_private.preflight_step_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and jsonb_typeof(function_hashes)='object'
   and (select count(*) from jsonb_object_keys(function_hashes))=18
   and function_hashes->>'public.icash_next_acquisition()'=md5(actual.definition))
  or not exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and enabled
   and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
   and acquisition_hash=md5(actual.definition)) then
  raise exception 'Acquisition budget yield activated manifest changed';
 end if;
 d:=actual.definition;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Acquisition budget yield lock source changed';
 end if;
 execute replace(d,needle,'perform 1 from public.icash_operating_budget where id=1 and enabled for update skip locked;');
 new_hash:=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure));
 update icash_work_private.continuation_policy set scheduler_hash=new_hash where id=1;
 update icash_work_private.preflight_step_policy set function_hashes=jsonb_set(function_hashes,
  array['public.icash_next_acquisition()'],to_jsonb(new_hash)) where id=1;
 update icash_research_private.acquisition_headroom_policy set acquisition_hash=new_hash where id=1;
end $patch$;
