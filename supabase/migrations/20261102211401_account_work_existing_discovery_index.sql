-- Reuse the pre-existing account/time index; remove only its verified duplicate.
begin;
set local lock_timeout='5s';
do $check$
begin
 if replace(pg_get_indexdef('public.icash_account_discovery_completed'::regclass),'icash_account_discovery_completed','icash_discovery_results_account') is distinct from pg_get_indexdef('public.icash_discovery_results_account'::regclass) then
  raise exception 'Discovery index definitions differ';
 end if;
end $check$;
drop index public.icash_account_discovery_completed;
commit;
