-- Preserve original receipts and actual-used allocation. People evaluated may
-- exceed the active/DNC-filtered rows, but cannot exceed requested unique IDs.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';
do $migration$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_save_owner_active_export(uuid,uuid,jsonb,jsonb)'::regprocedure);
 needle:=$old$  or credits->'people' is distinct from receipt->'record_count' or e.recovery->'raw'->'data'->'record_count' is distinct from receipt->'record_count'$old$;
 replacement:=$new$  or jsonb_typeof(credits->'people') is distinct from 'number' or coalesce(credits->>'people','') !~ '^[0-9]{1,3}$'
  or (credits->>'people')::integer<jsonb_array_length(p_rows) or (credits->>'people')::integer>jsonb_array_length(e.request->'people_ids')
  or e.recovery->'raw'->'data'->'record_count' is distinct from receipt->'record_count'$new$;
 if strpos(d,needle)=0 then raise exception 'Owner export credit guard changed';end if;
 execute replace(d,needle,replacement);
end $migration$;
commit;
