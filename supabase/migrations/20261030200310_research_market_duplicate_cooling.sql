-- Share only recent, settled duplicate-only supply evidence. No paid request,
-- pricing, contact, assignment, quota, cursor or financial-hold mutation.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create index icash_filter_supply_recent on public.icash_discovery_filter_pages
 (zip,(plan->>'strategy'),created_at desc,operation_key desc)
 where plan->>'version'='seller-filters-v1';

create function public.icash_market_duplicate_supply(p_zip text,p_strategy text,p_size integer,p_policy jsonb)
returns boolean language sql stable security invoker set search_path='' as $$
 -- Limit the original attempts BEFORE joining their receipts. A newer pending,
 -- unknown, differently shaped or incomplete page must break the streak.
 with recent as materialized (
  select p.operation_key,p.account_id,p.state from public.icash_discovery_filter_pages p
  where p.zip=p_zip and p.plan->>'strategy'=p_strategy and p.plan->>'version'='seller-filters-v1'
   and p_strategy in ('baseline','vacant','absentee','repairs')
   and p.created_at between now()-interval '24 hours' and now()
  order by p.created_at desc,p.operation_key desc limit 3
 )
 select coalesce(count(*)=3 and bool_and(coalesce(
  p.state='complete' and s.state='settled' and s.actual_micros>=0 and s.charged_cents>=0
  and r.zip=p_zip and r.strategy=p_strategy and r.per_page=p_size
  and r.query_policy=p_policy and p_policy->>'exclusionListId' is null
  and p_policy->>'version' in ('research-efficiency-v1','research-efficiency-v2')
  and r.returned_properties>0 and r.queued_properties=0
  and r.duplicate_properties=r.returned_properties
  and r.created_at between now()-interval '24 hours' and now()
  and r.operation_key is not null and s.operation_key is not null
 ,false)),false)
 from recent p
 left join public.icash_discovery_inventory_receipts r using(operation_key,account_id)
 left join public.icash_operation_spend s using(operation_key,account_id);
$$;
revoke all on function public.icash_market_duplicate_supply(text,text,integer,jsonb) from public,anon,authenticated;
grant execute on function public.icash_market_duplicate_supply(text,text,integer,jsonb) to service_role;

-- The original reader still owns cursor preparation, unknown-page fences,
-- targeting exclusions and local outcomes. Only the bounded cooling statistic
-- changes; duplicate supply is never a seller rejection or conversion label.
alter function public.icash_discovery_filter_state_v2(uuid,uuid,integer) rename to icash_filter_state_before_supply_cooling;
create function public.icash_discovery_filter_state_v2(p_account uuid,p_revision uuid,p_page integer)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare source jsonb;c public.icash_discovery_configs;policy jsonb;
begin
 source:=public.icash_filter_state_before_supply_cooling(p_account,p_revision,p_page);
 if source is null then return null;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 if not found or c.revision<>p_revision or c.next_page<>p_page
  or c.research_version not in (1,2) or c.research_list_id is not null then return source;end if;
 policy:=jsonb_build_object('version',case when c.research_version=2 then 'research-efficiency-v2' else 'research-efficiency-v1' end,'exclusionListId',null);
 return (select jsonb_agg(case when public.icash_market_duplicate_supply(c.zip,item->>'strategy',c.per_page,policy)
  then item||jsonb_build_object('recentUnproductivePages',3) else item end order by position)
  from jsonb_array_elements(source) with ordinality as rows(item,position));
end $$;
revoke all on function public.icash_discovery_filter_state_v2(uuid,uuid,integer),public.icash_filter_state_before_supply_cooling(uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_discovery_filter_state_v2(uuid,uuid,integer),public.icash_filter_state_before_supply_cooling(uuid,uuid,integer) to service_role;
commit;
