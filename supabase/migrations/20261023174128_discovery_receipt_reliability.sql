-- Correct derived inventory counters and stop reminting an unresolved paid page.
-- Provider receipts, funding snapshots, charges and unknown holds are unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create or replace function public.icash_record_discovery_inventory() returns trigger language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;ids text[];queued integer;duplicates integer;plan jsonb;
begin
 select * into strict c from public.icash_discovery_configs where account_id=new.account_id;
 select coalesce(array_agg(value->>'dm_property_id'),'{}') into ids from jsonb_array_elements(new.result->'rows');
 select count(*) into queued from public.icash_screening_jobs s where s.account_id=new.account_id
 and s.event_key in (select new.operation_key||':'||pid.property_id from unnest(ids) as pid(property_id));
 select count(*) into duplicates from unnest(ids) as pid(property_id)
 join public.icash_outbound_property_owners o on o.property_id=pid.property_id
 where not exists(select 1 from public.icash_screening_jobs s where s.account_id=new.account_id
  and s.event_key=new.operation_key||':'||pid.property_id);
 plan:=new.result->'filterPlan';
 insert into public.icash_discovery_inventory_receipts(operation_key,account_id,revision,zip,strategy,provider_page,per_page,property_ids,returned_properties,queued_properties,duplicate_properties,has_next_page,created_at)
 values(new.operation_key,new.account_id,c.revision,c.zip,coalesce(plan->>'strategy','baseline'),coalesce((plan->>'providerPage')::integer,c.next_page),c.per_page,ids,cardinality(ids),queued,duplicates,(new.result->>'hasNextPage')::boolean,new.created_at);
 return new;
end $$;

-- Recompute derived counts from assignments already present at receipt time.
-- Later assignments must not turn an earlier rejected row into a duplicate.
with corrected as (
 select r.operation_key,(select count(*) from unnest(r.property_ids) as pid(property_id)
  join public.icash_outbound_property_owners o on o.property_id=pid.property_id and o.assigned_at<=r.created_at
  where not exists(select 1 from public.icash_screening_jobs s where s.account_id=r.account_id
   and s.event_key=r.operation_key||':'||pid.property_id)) duplicates
 from public.icash_discovery_inventory_receipts r
)
update public.icash_discovery_inventory_receipts r set duplicate_properties=c.duplicates
from corrected c where r.operation_key=c.operation_key and r.duplicate_properties<>c.duplicates;

create or replace function public.icash_outbound_search_due(p_account uuid) returns boolean
language sql stable set search_path='' as $$
 select not exists(select 1 from public.icash_operation_spend o
   where o.account_id=p_account and o.operation_key='discovery:'||c.account_id||':'||c.revision||':'||c.next_page
   and o.state<>'reserved')
  and public.icash_prospecting_available(p_account)>=public.icash_research_admission_quote(p_account,'property_search',r.charge_cents)
  and not public.icash_research_waiting_on_outreach(p_account)
  and (not c.contacts_enabled or public.icash_enrichment_before_prospecting_budget(p_account) is null)
  and public.icash_search_due_before_prospecting_budget(p_account)
 from public.icash_discovery_configs c join public.icash_operation_rates r on r.id=c.rate_id where c.account_id=p_account;
$$;
revoke all on function public.icash_record_discovery_inventory(),public.icash_outbound_search_due(uuid) from public,anon,authenticated;
grant execute on function public.icash_record_discovery_inventory(),public.icash_outbound_search_due(uuid) to service_role;
commit;
