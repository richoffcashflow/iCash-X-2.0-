-- Reuse the same stable reserve calculation within one acquisition-capacity
-- check. This is a local variable, never a cross-account or transaction cache.
-- The shared/final provider limiter, quota state and scheduler remain unchanged.
-- The release runner owns this transaction and its migration ledger entry.
set local lock_timeout='2s';
set local statement_timeout='8s';
set local search_path='';

do $patch$
declare item record;actual record;wrapper text;shared text;shared_body text;needle text;
 before_policy jsonb;new_hash text;
begin
 if not pg_try_advisory_xact_lock(726341927) then
  raise exception 'Acquisition single-state scheduler busy';
 end if;
 perform 1 from public.icash_operating_budget where id=1 for update nowait;
 if not found then raise exception 'Acquisition single-state budget unavailable';end if;
 for item in select * from (values
  ('public.icash_acquisition_capacity_available(uuid)','ef2ac533056a6e0be5bc450e191eaed2',true),
  ('public.icash_dealmachine_capacity_available(integer,uuid)','14c36dd47e50e3e1cfd0a2e5f58696ef',true),
  ('icash_research_private.request_reserve_state(timestamptz)','383bbfa915185d9aa33662c84647c450',false),
  ('icash_research_private.starter_request_allowance(uuid,timestamptz)','5d27cf61ed1c2af8e9d30ab31b4c9a9e',false)
 ) f(signature,checksum,service_callable) loop
  select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p
   where p.oid=to_regprocedure(item.signature);
  if not found or md5(actual.definition) is distinct from item.checksum
   or pg_get_userbyid(actual.proowner) is distinct from 'postgres'
   or actual.provolatile::text is distinct from 's' or not actual.prosecdef
   or actual.proparallel::text is distinct from 'u' or actual.proisstrict or actual.proleakproof
   or actual.proconfig is distinct from array['search_path=""']::text[]
   or (select count(*) from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))))
    <>(case when item.service_callable then 2 else 1 end)
   or has_function_privilege('service_role',actual.oid,'EXECUTE') is distinct from item.service_callable
   or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
    where acl.privilege_type<>'EXECUTE' or acl.is_grantable or acl.grantor<>actual.proowner
     or acl.grantee not in(actual.proowner,case when item.service_callable
      then (select oid from pg_roles where rolname='service_role') else actual.proowner end))
  then raise exception 'Acquisition single-state prerequisite changed: %',item.signature;end if;
 end loop;
 perform 1 from icash_research_private.acquisition_headroom_policy where id=1 for update nowait;
 if not exists(select 1 from icash_research_private.acquisition_headroom_policy where id=1 and enabled
  and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
  and capacity_hash='ef2ac533056a6e0be5bc450e191eaed2'
  and acquisition_hash=md5(pg_get_functiondef('public.icash_next_acquisition()'::regprocedure))
  and resume_hash=md5(pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure))) then
  raise exception 'Acquisition single-state active manifest changed';
 end if;
 select to_jsonb(p)-'capacity_hash' into before_policy
  from icash_research_private.acquisition_headroom_policy p where id=1;
 wrapper:=pg_get_functiondef('public.icash_acquisition_capacity_available(uuid)'::regprocedure);
 shared:=pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure);
 shared_body:=split_part(split_part(shared,E'begin\n',2),E'end $function$',1);
 if shared_body='' then raise exception 'Acquisition single-state shared body missing';end if;
 needle:=E' if ordinary>=p_requests then return true;end if;\n protected:=least((s->>''reserveRemaining'')::integer,icash_research_private.starter_request_allowance(p_account));\n return ordinary+protected>=p_requests;\n';
 if (length(shared_body)-length(replace(shared_body,needle,'')))<>length(needle) then
  raise exception 'Acquisition single-state shared result changed';end if;
 -- Preserve SQL NULL behavior: the previous outer IF NOT NULL continued into
 -- headroom. A NULL ordinary amount must not become a false admission result.
 shared_body:=replace(shared_body,needle,E' if ordinary>=p_requests then\n  null;\n else\n  protected:=least((s->>''reserveRemaining'')::integer,icash_research_private.starter_request_allowance(p_account));\n  if not (ordinary+protected>=p_requests) then return false;end if;\n end if;\n');
 shared_body:=regexp_replace(shared_body,'\mp_requests\M','2','g');
 needle:=E' s:=icash_research_private.request_reserve_state();\n if s is null then return false;end if;\n';
 if (length(wrapper)-length(replace(wrapper,needle,'')))<>length(needle) then
  raise exception 'Acquisition single-state duplicate read changed';end if;
 wrapper:=replace(wrapper,needle,'');
 needle:='declare s jsonb;protected integer;';
 if (length(wrapper)-length(replace(wrapper,needle,'')))<>length(needle) then
  raise exception 'Acquisition single-state declaration changed';end if;
 wrapper:=replace(wrapper,needle,'declare b public.icash_dealmachine_request_budget;s jsonb;ordinary integer;protected integer;');
 needle:=E' if not public.icash_dealmachine_capacity_available(2,p_account) then return false;end if;\n';
 if (length(wrapper)-length(replace(wrapper,needle,'')))<>length(needle) then
  raise exception 'Acquisition single-state shared call changed';end if;
 execute replace(wrapper,needle,shared_body);
 new_hash:=md5(pg_get_functiondef('public.icash_acquisition_capacity_available(uuid)'::regprocedure));
 if new_hash is distinct from 'c8549a105f353bc11b0dcb904bbd8e71' then
  raise exception 'Acquisition single-state result changed';end if;
 update icash_research_private.acquisition_headroom_policy set capacity_hash=new_hash where id=1;
 if (select to_jsonb(p)-'capacity_hash' from icash_research_private.acquisition_headroom_policy p where id=1)
  is distinct from before_policy then raise exception 'Acquisition single-state policy preservation failed';end if;
 if md5(pg_get_functiondef('public.icash_dealmachine_capacity_available(integer,uuid)'::regprocedure))
  is distinct from '14c36dd47e50e3e1cfd0a2e5f58696ef'
  or md5(pg_get_functiondef('icash_research_private.request_reserve_state(timestamptz)'::regprocedure))
  is distinct from '383bbfa915185d9aa33662c84647c450' then
  raise exception 'Acquisition single-state original authority changed';end if;
 -- Reject result metadata drift as part of the same atomic installation.
 for item in select * from (values
  ('public.icash_acquisition_capacity_available(uuid)','c8549a105f353bc11b0dcb904bbd8e71',true),
  ('public.icash_dealmachine_capacity_available(integer,uuid)','14c36dd47e50e3e1cfd0a2e5f58696ef',true),
  ('icash_research_private.request_reserve_state(timestamptz)','383bbfa915185d9aa33662c84647c450',false),
  ('icash_research_private.starter_request_allowance(uuid,timestamptz)','5d27cf61ed1c2af8e9d30ab31b4c9a9e',false)
 ) f(signature,checksum,service_callable) loop
  select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p
   where p.oid=to_regprocedure(item.signature);
  if not found or md5(actual.definition) is distinct from item.checksum
   or pg_get_userbyid(actual.proowner) is distinct from 'postgres'
   or actual.provolatile::text is distinct from 's' or not actual.prosecdef
   or actual.proparallel::text is distinct from 'u' or actual.proisstrict or actual.proleakproof
   or actual.proconfig is distinct from array['search_path=""']::text[]
   or (select count(*) from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))))
    <>(case when item.service_callable then 2 else 1 end)
   or has_function_privilege('service_role',actual.oid,'EXECUTE') is distinct from item.service_callable
   or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
    where acl.privilege_type<>'EXECUTE' or acl.is_grantable or acl.grantor<>actual.proowner
     or acl.grantee not in(actual.proowner,case when item.service_callable
      then (select oid from pg_roles where rolname='service_role') else actual.proowner end))
  then raise exception 'Acquisition single-state result metadata changed: %',item.signature;end if;
 end loop;
end $patch$;
