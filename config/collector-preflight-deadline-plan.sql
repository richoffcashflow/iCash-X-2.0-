-- Planner-only split of an optional primary-screening source scan.
-- All source, expiry, quota, receipt and ordering predicates remain unchanged.
-- The migration runner owns the transaction and its schema-history insert.
set local lock_timeout='5s';
set local statement_timeout='30s';
set local search_path='';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare actual record;entry record;d text;before_policy jsonb;new_hash text;changed integer;
 signature constant text:='icash_work_private.live_owner_preflight_deadline(uuid,uuid)';
 needle constant text:=E'  from icash_research_private.owner_export_preflights p\n';
begin
 if not exists(select 1 from public.icash_operating_budget where id=1) then
  raise exception 'Collector deadline budget prerequisite changed';end if;
 select p.*,pg_get_functiondef(p.oid) definition into actual from pg_proc p where p.oid=signature::regprocedure;
 if md5(actual.definition) is distinct from '136f9850a750ce7883f5e0514ff6e027'
  or pg_get_userbyid(actual.proowner) is distinct from 'postgres'
  or not actual.prosecdef or actual.provolatile::text is distinct from 's'
  or actual.proconfig is distinct from array['search_path=""']::text[]
  or not has_function_privilege('service_role',actual.oid,'EXECUTE')
  or exists(select 1 from aclexplode(coalesce(actual.proacl,acldefault('f',actual.proowner))) acl
   where acl.privilege_type='EXECUTE' and (acl.grantee not in
    (actual.proowner,(select oid from pg_roles where rolname='service_role'))
    or (acl.grantee<>actual.proowner and acl.is_grantable))) then
  raise exception 'Collector deadline source or privileges changed';end if;
 perform 1 from icash_work_private.continuation_policy where id=1 for update;
 if not exists(select 1 from icash_work_private.continuation_policy where id=1 and enabled
  and activated_at is not null and release_sha~'^[a-f0-9]{40}$'
  and jsonb_typeof(continued_original_hashes)='object'
  and continued_original_hashes->>signature='136f9850a750ce7883f5e0514ff6e027'
  and continued_original_hashes ?& array[
   'icash_work_private.continued_owner_preflight_source(uuid,uuid,uuid)',
   'icash_work_private.continued_owner_preflight_deadline(uuid,uuid)',signature,
   'public.icash_enrichment_before_prospecting_budget(uuid)']
  and (select count(*) from jsonb_object_keys(continued_original_hashes))=4) then
  raise exception 'Collector deadline continuation manifest changed';end if;
 for entry in select * from jsonb_each_text((select continued_original_hashes from icash_work_private.continuation_policy where id=1)) loop
  if to_regprocedure(entry.key) is null or md5(pg_get_functiondef(to_regprocedure(entry.key))) is distinct from entry.value then
   raise exception 'Collector deadline continuation source changed: %',entry.key;end if;
 end loop;
 select to_jsonb(p) #- array['continued_original_hashes',signature] into before_policy
  from icash_work_private.continuation_policy p where id=1;
 if to_regclass('icash_research_private.icash_owner_preflight_primary_screening') is not null then
  raise exception 'Collector deadline index already exists';end if;
 create index icash_owner_preflight_primary_screening
  on icash_research_private.owner_export_preflights(account_id,((items->0->>'screeningId')))
  where state in ('waiting','ready');
 if not exists(select 1 from pg_index i join pg_class c on c.oid=i.indexrelid join pg_am am on am.oid=c.relam
  where i.indexrelid='icash_research_private.icash_owner_preflight_primary_screening'::regclass
   and i.indrelid='icash_research_private.owner_export_preflights'::regclass
   and i.indisvalid and i.indisready and not i.indisunique and not i.indisprimary
   and i.indnkeyatts=2 and i.indnatts=2 and am.amname='btree'
   and pg_get_indexdef(i.indexrelid,1,true)='account_id'
   and pg_get_expr(i.indexprs,i.indrelid)='((items -> 0) ->> ''screeningId''::text)'
   and pg_get_expr(i.indpred,i.indrelid)='(state = ANY (ARRAY[''waiting''::text, ''ready''::text]))') then
  raise exception 'Collector deadline index shape changed';end if;
 d:=actual.definition;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Collector deadline source boundary changed';end if;
 d:=replace(d,needle,$new$  from (
   select * from icash_research_private.owner_export_preflights
   where p_screening is null
   union all
   select * from icash_research_private.owner_export_preflights
   where p_screening is not null and items->0->>'screeningId'=p_screening::text
  ) p
$new$);
 execute d;
 if pg_get_functiondef(actual.oid) is distinct from d or exists(select 1 from pg_proc p where p.oid=actual.oid
  and (p.proowner is distinct from actual.proowner or p.proacl is distinct from actual.proacl
   or p.provolatile is distinct from actual.provolatile or p.prosecdef is distinct from actual.prosecdef
   or p.proconfig is distinct from actual.proconfig)) then
  raise exception 'Collector deadline catalog changed';end if;
 new_hash:=md5(pg_get_functiondef(actual.oid));
 update icash_work_private.continuation_policy
  set continued_original_hashes=jsonb_set(continued_original_hashes,array[signature],to_jsonb(new_hash))
  where id=1 and enabled and continued_original_hashes->>signature='136f9850a750ce7883f5e0514ff6e027';
 get diagnostics changed=row_count;
 if (select continued_original_hashes->>signature from icash_work_private.continuation_policy where id=1)
  is distinct from new_hash then
  raise exception 'Collector deadline target policy hash changed';end if;
 if changed<>1 or (select to_jsonb(p) #- array['continued_original_hashes',signature]
  from icash_work_private.continuation_policy p where id=1) is distinct from before_policy then
  raise exception 'Collector deadline non-target policy changed';end if;
end $patch$;
notify pgrst,'reload schema';
