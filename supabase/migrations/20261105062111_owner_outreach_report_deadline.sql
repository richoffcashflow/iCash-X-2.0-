-- This owner-only historical report scans all accounts. After reducing repeated
-- classification, allow its measured 6–10s REST path to finish within the
-- application's existing 15s request limit. No role/global/worker timeout changes.
begin;
set local lock_timeout='5s';
do $check$
begin
 if strpos(pg_get_functiondef('public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text)'::regprocedure),'voice_responses as materialized')=0 then
  raise exception 'Optimized outreach report required';
 end if;
end $check$;
alter function public.icash_owner_outreach_report(uuid,integer,boolean,text,integer,text) set statement_timeout='12s';
notify pgrst, 'reload schema';
commit;

