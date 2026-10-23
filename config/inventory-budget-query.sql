-- Keep duplicate coverage out of customer spend without per-operation RPC work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create view public.icash_duplicate_discovery_coverage with (security_invoker=true) as
select c.operation_key,c.account_id,c.covered_cents
from public.icash_usage_coverage c
join public.icash_discovery_inventory_receipts d using(operation_key,account_id)
join public.icash_operation_spend o using(operation_key,account_id)
join public.icash_operation_rates r on r.id=o.rate_id
where r.operation='property_search' and d.queued_properties=0 and d.returned_properties=d.duplicate_properties;
revoke all on public.icash_duplicate_discovery_coverage from public,anon,authenticated;
grant select on public.icash_duplicate_discovery_coverage to service_role;

do $patch$
declare d text;name text;needle text:='public.icash_customer_discovery_charge(o.account_id,o.operation_key,o.charged_cents)';
begin
 foreach name in array array['icash_prospecting_available','icash_prospecting_total_available'] loop
  d:=pg_get_functiondef(('public.'||name||'(uuid)')::regprocedure);
  if position(needle in d)=0 then raise exception 'Net discovery charge boundary changed';end if;
  d:=replace(d,needle,'greatest(0,o.charged_cents-coalesce(duplicate_coverage.covered_cents,0))');
  if name='icash_prospecting_available' then
   if position('from public.icash_operation_spend o cross join budget b' in d)=0 then raise exception 'Paced budget query changed';end if;
   d:=replace(d,'from public.icash_operation_spend o cross join budget b','from public.icash_operation_spend o left join public.icash_duplicate_discovery_coverage duplicate_coverage on duplicate_coverage.operation_key=o.operation_key and duplicate_coverage.account_id=o.account_id cross join budget b');
  else
   if position('from public.icash_operation_spend o join budget b' in d)=0 then raise exception 'Total budget query changed';end if;
   d:=replace(d,'from public.icash_operation_spend o join budget b','from public.icash_operation_spend o left join public.icash_duplicate_discovery_coverage duplicate_coverage on duplicate_coverage.operation_key=o.operation_key and duplicate_coverage.account_id=o.account_id join budget b');
  end if;
  execute d;
 end loop;
end $patch$;

-- Reporting uses the same private evidence, with a cached PL/pgSQL query plan.
create or replace function public.icash_customer_discovery_charge(p_account uuid,p_operation text,p_gross bigint)
returns bigint language plpgsql stable set search_path='' as $$
declare covered bigint;
begin
 select covered_cents into covered from public.icash_duplicate_discovery_coverage where account_id=p_account and operation_key=p_operation;
 return greatest(0,p_gross-coalesce(covered,0));
end $$;
commit;
