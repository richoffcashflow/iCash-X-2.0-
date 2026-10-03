-- Read-only assertions for an isolated database with the candidate installed.
do $$
declare n text;role_name text;f record;
begin
 foreach n in array array['configs','sessions','events','cost_reviews','cost_policies','automatic_settlements'] loop
  if not(select relrowsecurity from pg_class where oid=('icash_recorded_reception_private.'||n)::regclass) then raise exception 'Private RLS missing: %',n;end if;
  foreach role_name in array array['anon','authenticated','service_role','untrusted_test_role'] loop
   if has_table_privilege(role_name,'icash_recorded_reception_private.'||n,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Private table exposed: % %',n,role_name;end if;
  end loop;
 end loop;
 foreach role_name in array array['anon','authenticated','service_role','untrusted_test_role'] loop
  if has_schema_privilege(role_name,'icash_recorded_reception_private','USAGE') then raise exception 'Private schema exposed: %',role_name;end if;
 end loop;
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('icash_get_recorded_reception_config','icash_get_recorded_reception_session','icash_list_recorded_reception_sessions','icash_reserve_recorded_reception','icash_transition_recorded_reception','icash_claim_recorded_reception_work','icash_finish_recorded_reception_work','icash_recorded_reception_property_context','icash_settle_recorded_reception') loop
  if not f.prosecdef or f.proconfig is distinct from array['search_path=""'] or not has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'Unsafe RPC: %',f.proname;end if;
  foreach role_name in array array['anon','authenticated','untrusted_test_role'] loop
   if has_function_privilege(role_name,f.oid,'EXECUTE') then raise exception 'Client RPC exposed: % %',role_name,f.proname;end if;
  end loop;
 end loop;
 if not exists(select 1 from pg_trigger where tgrelid='icash_reception_private.config'::regclass and tgname='reception_config_guard') then raise exception 'Historical consumed guard missing';end if;
end $$;
