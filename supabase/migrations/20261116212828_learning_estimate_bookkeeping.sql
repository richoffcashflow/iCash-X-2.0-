-- Receipt-check cursors are not new learning outcomes or workspace activity.
-- Preserve source-bound receipts, financial state, all other tables and grants.
-- The release runner owns the migration and schema-history transaction.
set local lock_timeout='3s';
set local statement_timeout='15s';
do $patch$
declare definition text;expected_definition text;installed_definition text;before_metadata jsonb;after_metadata jsonb;
 boundary text:=$old$ if tg_table_name='icash_discovery_configs' then ignored:=ignored||array['next_run_at'];end if;$old$;
 addition text:=$new$
 if tg_table_schema='public' and tg_table_name='icash_operation_spend' then ignored:=ignored||array['estimate_checked_at'];end if;$new$;
begin
 perform pg_advisory_xact_lock(726341927);
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into definition,before_metadata
 from pg_proc p where p.oid='public.icash_learning_changed()'::regprocedure;
 if md5(definition)<>'821d84ea09d109cfdd5b1272a0745509' then
  raise exception 'Learning estimate bookkeeping predecessor changed';end if;
 if not exists(select 1 from pg_proc p where p.oid='public.icash_learning_changed()'::regprocedure
   and p.proowner='postgres'::regrole and p.prosecdef and p.provolatile='v' and p.proparallel='u'
   and not p.proleakproof and not p.proisstrict and p.proconfig=array['search_path=""'])
  or exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
   where p.oid='public.icash_learning_changed()'::regprocedure
    and (a.grantee not in ('postgres'::regrole,'service_role'::regrole)
     or a.grantor<>'postgres'::regrole or a.privilege_type<>'EXECUTE' or a.is_grantable))
  or not has_function_privilege('service_role','public.icash_learning_changed()','EXECUTE')
  or has_function_privilege('anon','public.icash_learning_changed()','EXECUTE')
  or has_function_privilege('authenticated','public.icash_learning_changed()','EXECUTE')
 then raise exception 'Learning estimate bookkeeping privileges changed';end if;
 if (length(definition)-length(replace(definition,boundary,'')))<>length(boundary) then
  raise exception 'Learning estimate bookkeeping boundary changed';end if;
 expected_definition:=replace(definition,boundary,boundary||addition);
 execute expected_definition;
 select pg_get_functiondef(p.oid),to_jsonb(p)-'prosrc' into installed_definition,after_metadata from pg_proc p
  where p.oid='public.icash_learning_changed()'::regprocedure;
 if installed_definition is distinct from expected_definition then
  raise exception 'Learning estimate bookkeeping replacement changed';end if;
 if after_metadata is distinct from before_metadata then
  raise exception 'Learning estimate bookkeeping metadata changed';end if;
end $patch$;
