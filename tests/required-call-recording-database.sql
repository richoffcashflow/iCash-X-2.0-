-- Read-only schema/ACL assertions. Exact state-machine fixtures are in the local
-- PGlite runner. Safe to run in a disposable test database after candidate SQL.
do $$
declare f record;role_name text;
begin
 if not (select relrowsecurity from pg_class where oid='public.icash_call_recordings'::regclass) then raise exception 'Recording RLS required';end if;
 foreach role_name in array array['anon','authenticated','untrusted_test_role'] loop
  if has_table_privilege(role_name,'public.icash_call_recordings','SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Client table privilege: %',role_name;end if;
 end loop;
 if not has_table_privilege('service_role','public.icash_call_recordings','SELECT') or has_table_privilege('service_role','public.icash_call_recordings','INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') then raise exception 'Service read-only table boundary required';end if;
 for f in select p.oid,p.proname,p.prosecdef,p.proconfig from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('icash_create_call_recording','icash_transition_call_recording','icash_claim_call_recording_work','icash_finish_call_recording_work','icash_settle_unstarted_recorded_call') loop
  if not f.prosecdef or f.proconfig is distinct from array['search_path=""'] then raise exception 'Unsafe function: %',f.proname;end if;
  if not has_function_privilege('service_role',f.oid,'EXECUTE') then raise exception 'Missing service RPC: %',f.proname;end if;
  foreach role_name in array array['anon','authenticated','untrusted_test_role'] loop
   if has_function_privilege(role_name,f.oid,'EXECUTE') then raise exception 'Client RPC privilege: % %',role_name,f.proname;end if;
  end loop;
 end loop;
 if (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('icash_create_call_recording','icash_transition_call_recording','icash_claim_call_recording_work','icash_finish_call_recording_work','icash_settle_unstarted_recorded_call'))<>5 then raise exception 'Missing recording RPC';end if;
 if has_schema_privilege('service_role','icash_recording_private','USAGE') or has_schema_privilege('anon','icash_recording_private','USAGE') then raise exception 'Private recording schema exposed';end if;
end $$;
