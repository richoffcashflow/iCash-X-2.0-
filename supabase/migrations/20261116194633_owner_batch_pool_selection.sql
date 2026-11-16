-- Fill fresh owner batches from one targeting pool before the existing limit.
-- Original preflight/continuation cohorts and every final admission stay intact.
-- The migration runner owns the transaction and its history insert.
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path='';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare actual record;entry record;d text;needle text;before_policy jsonb;new_hash text;
 signature constant text:='public.icash_owner_batch_candidates(uuid,uuid)';
begin
 if not exists(select 1 from public.icash_operating_budget where id=1) then
  raise exception 'Owner pool budget prerequisite changed';end if;
 select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p
  where p.oid=signature::regprocedure;
 if md5(actual.definition) is distinct from '2710c80d3c330cb9c271f2536585f785'
  or pg_get_userbyid(actual.proowner) is distinct from 'postgres'
  or not actual.prosecdef or actual.provolatile::text is distinct from 's'
  or actual.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('service_role',actual.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
   where acl.privilege_type='EXECUTE' and (acl.grantee not in
    (actual.proowner,(select oid from pg_roles where rolname='service_role'))
    or (acl.grantee<>actual.proowner and acl.is_grantable))) then
  raise exception 'Owner pool candidate prerequisite changed';end if;
 if md5(pg_get_functiondef('public.icash_owner_targeting_pool(uuid,uuid)'::regprocedure))
   is distinct from '8548157625702928165ca2a94efe650e'
  or md5(pg_get_functiondef('public.icash_owner_active_export_enabled()'::regprocedure))
   is distinct from 'baf4606217c6a35dfbc9b20150b5517d' then
  raise exception 'Owner pool targeting prerequisite changed';end if;
 perform 1 from icash_work_private.continuation_policy where id=1 for update;
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled
  and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
  and continued_cohort_hashes=jsonb_build_object(
   signature,'2710c80d3c330cb9c271f2536585f785',
   'icash_work_private.continued_owner_batch_cohort(uuid,uuid)','2019f87d8d034a9a2d3d79dffb64df0c',
   'icash_work_private.continued_owner_handoff_current(uuid,uuid)','5b13d59fe8d94b3d83bd0616b9541591')) then
  raise exception 'Owner pool continuation manifest changed';end if;
 for entry in select * from jsonb_each_text((select continued_cohort_hashes
  from icash_work_private.continuation_policy where id=1)) loop
  if to_regprocedure(entry.key) is null or md5(pg_get_functiondef(to_regprocedure(entry.key))) is distinct from entry.value then
   raise exception 'Owner pool continuation source changed: %',entry.key;end if;
 end loop;
 select to_jsonb(p) #- array['continued_cohort_hashes',signature] into before_policy
  from icash_work_private.continuation_policy p where id=1;
 d:=actual.definition;
 needle:='pinned jsonb;continued boolean:=false;';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner pool declaration changed';end if;
 d:=replace(d,needle,needle||'primary_pool text;');
 needle:=' if pinned is not null and jsonb_array_length(pinned)>n then return ''[]'';end if;';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner pool pin boundary changed';end if;
 d:=replace(d,needle,needle||$new$
 -- Fresh active-export work selects compatible siblings before LIMIT. A saved
 -- cohort must keep its original audience and order, including after cleanup.
 if pinned is null and public.icash_owner_active_export_enabled() then
  primary_pool:=public.icash_owner_targeting_pool(p_account,p_screening);
  if primary_pool is null or primary_pool not in('active','mobile') then return '[]';end if;
 end if;$new$);
 needle:='  and (pinned is null or exists(select 1 from jsonb_array_elements(pinned) i where i->>''screeningId''=s.id::text and i->''snapshot''=s.snapshot))';
 if(length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner pool candidate boundary changed';end if;
 d:=replace(d,needle,needle||E'\n  and (primary_pool is null or public.icash_owner_targeting_pool(p_account,s.id)=primary_pool)');
 execute d;
 new_hash:=md5(pg_get_functiondef(signature::regprocedure));
 update icash_work_private.continuation_policy
  set continued_cohort_hashes=jsonb_set(continued_cohort_hashes,array[signature],to_jsonb(new_hash)) where id=1;
 if (select to_jsonb(p) #- array['continued_cohort_hashes',signature]
  from icash_work_private.continuation_policy p where id=1) is distinct from before_policy then
  raise exception 'Owner pool non-target policy changed';end if;
end $patch$;
notify pgrst,'reload schema';
