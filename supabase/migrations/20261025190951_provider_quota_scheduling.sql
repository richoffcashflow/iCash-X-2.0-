-- Do not turn a known acquisition quota wait into failed worker capabilities.
-- DealMachine documents 60/minute and 5,000/day. Keep 50/minute and a 100/day
-- margin; never reset counters, replay an uncertain request or change credits.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.icash_dealmachine_capacity_available(p_requests integer default 2) returns boolean
language sql stable security invoker set search_path='' as $$
 select coalesce((select p_requests between 1 and 60
  and (case when minute_start<=now()-interval '1 minute' then 0 else minute_used end)+p_requests<=minute_limit
  and (case when day_start<=now()-interval '24 hours' then 0 else day_used end)+p_requests<=day_limit
  from public.icash_dealmachine_request_budget where id=1),false);
$$;
alter function public.icash_outbound_search_due(uuid) rename to icash_search_due_before_provider_quota;
create function public.icash_outbound_search_due(p_account uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select case when public.icash_dealmachine_capacity_available() then public.icash_search_due_before_provider_quota(p_account) else false end;
$$;
alter function public.icash_enrichment_candidate(uuid) rename to icash_enrichment_before_provider_quota;
create function public.icash_enrichment_candidate(p_account uuid) returns uuid
language sql stable security invoker set search_path='' as $$
 select case when public.icash_dealmachine_capacity_available() then public.icash_enrichment_before_provider_quota(p_account) else null::uuid end;
$$;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 needle:=$old$ update public.icash_automation_tickets set state='held',outcome='expired' where kind in ('contacts','discovery') and state='issued' and expires_at<=now();$old$;
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Acquisition quota prerequisite changed';end if;
 execute replace(definition,needle,needle||E'\n -- Leave other scheduler work available; billing and expiry checks above still run.\n if not public.icash_dealmachine_capacity_available() then return null;end if;');
 definition:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 needle:=$old$and (x.kind not in ('contacts','discovery') or not a.waiting_for_outreach)$old$;
 if (length(definition)-length(replace(definition,needle,'')))<>length(needle) then raise exception 'Prospecting quota prerequisite changed';end if;
 execute replace(definition,needle,$new$and (x.kind not in ('contacts','discovery') or (public.icash_dealmachine_capacity_available() and not a.waiting_for_outreach))$new$);
end $patch$;
update public.icash_dealmachine_request_budget set day_limit=4900 where id=1 and day_limit=4500;
revoke all on function public.icash_dealmachine_capacity_available(integer),public.icash_outbound_search_due(uuid),public.icash_search_due_before_provider_quota(uuid),public.icash_enrichment_candidate(uuid),public.icash_enrichment_before_provider_quota(uuid) from public,anon,authenticated;
grant execute on function public.icash_dealmachine_capacity_available(integer),public.icash_outbound_search_due(uuid),public.icash_search_due_before_provider_quota(uuid),public.icash_enrichment_candidate(uuid),public.icash_enrichment_before_provider_quota(uuid) to service_role;
commit;
