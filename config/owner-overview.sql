-- Read-only platform reporting. The actor is the existing platform owner identity,
-- never a caller-supplied account or user-metadata claim. Browser roles cannot call it.
create index if not exists icash_seller_intakes_overview_created_idx
 on public.icash_seller_intakes(created_at desc,id desc)
 where canonical_id is null and state<>'duplicate';

create or replace function public.icash_owner_overview(
 p_actor uuid,p_days integer default 30,p_include_owner boolean default false,
 p_query text default '',p_page integer default 1
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare
 owner_id constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';
 end_at timestamptz:=now();start_at timestamptz;search_text text;result jsonb;
begin
 if p_actor is distinct from owner_id then raise exception 'Owner required' using errcode='42501';end if;
 if p_days is null or p_days not in (1,7,30) or p_include_owner is null
  or p_page is null or p_page not between 1 and 100000
  or p_query is null or length(p_query)>100 then raise exception 'Invalid report filters';end if;
 -- Calendar days in Central time, including the current partial day. DST-safe.
 start_at:=((end_at at time zone 'America/Chicago')::date-(p_days-1))::timestamp at time zone 'America/Chicago';
 -- A literal substring search, including user-entered percent/underscore/backslash.
 search_text:='%'||replace(replace(replace(trim(p_query),'\','\\'),'%','\%'),'_','\_')||'%';
 with accounts as materialized (
  select a.id from public.icash_accounts a
  where (p_include_owner or a.owner_user_id<>owner_id)
   and (not exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='test' and f.state='paid')
    or exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid'))
 ), completed as materialized (
  select o.*,coalesce(c.covered_cents,0) covered_cents
  from public.icash_operation_spend o join accounts a on a.id=o.account_id
  left join public.icash_usage_coverage c on c.operation_key=o.operation_key and c.account_id=o.account_id
  where o.state='settled' and o.settled_at>=start_at and o.settled_at<end_at
 ), money as (
  select count(*) completed_count,
   count(*) filter(where charged_cents is null) missing_charge_count,
   coalesce(sum(greatest(0,charged_cents-covered_cents)),0) charged_cents,
   coalesce(sum(covered_cents),0) covered_cents,
   coalesce(sum(actual_micros) filter(where cost_basis in ('verified','estimated')),0) known_cost_micros,
   count(*) filter(where actual_micros is null or cost_basis is null or cost_basis not in ('verified','estimated')) missing_cost_count,
   count(*) filter(where cost_basis='estimated') estimated_count
  from completed
 ), leads as materialized (
  select l.id,l.name,l.address,l.phone,l.email,l.state,l.attribution,l.assigned_account,l.created_at
  from public.icash_seller_intakes l
  where l.canonical_id is null and l.state<>'duplicate' and l.created_at>=start_at and l.created_at<end_at
 ), matching as materialized (
  select * from leads l where trim(p_query)='' or
   l.name ilike search_text or l.address ilike search_text or l.phone ilike search_text or l.email ilike search_text
 ), page_rows as (
  select l.*,coalesce(nullif(a.legal_name,''),nullif(a.assistant_name,''),'Assigned account') assigned_name
  from (select * from matching order by created_at desc,id desc limit 25 offset (p_page-1)*25) l
  left join public.icash_accounts a on a.id=l.assigned_account
 )
 select jsonb_build_object(
  'days',p_days,'includeOwner',p_include_owner,'query',trim(p_query),'page',p_page,'pageSize',25,
  'timezone','America/Chicago','startAt',start_at,'endAt',end_at,
  'leadCount',(select count(*) from leads),
  'reviewCount',(select count(*) from leads where state in ('review','numbers_review','market_review','unmatched')),
  'matchedCount',(select count(*) from matching),
  'usage',jsonb_build_object(
   'completedCount',m.completed_count,'missingChargeCount',m.missing_charge_count,
   'chargedCents',case when m.missing_charge_count=0 then m.charged_cents else null end,
   'coveredCents',m.covered_cents,'knownCostMicros',m.known_cost_micros,
   'costMicros',case when m.missing_cost_count=0 then m.known_cost_micros else null end,
   'marginMicros',case when m.missing_cost_count=0 and m.missing_charge_count=0 then m.charged_cents*10000-m.known_cost_micros else null end,
   'missingCostCount',m.missing_cost_count,'estimatedCount',m.estimated_count,
   'pendingCount',(select count(*) from public.icash_operation_spend o join accounts a on a.id=o.account_id
    where o.state='dispatched' and coalesce(o.dispatched_at,o.created_at)>=start_at and coalesce(o.dispatched_at,o.created_at)<end_at)
  ),
  'leads',coalesce((select jsonb_agg(jsonb_build_object(
   'id',l.id,'name',l.name,'address',l.address,'phone',l.phone,'email',l.email,'state',l.state,
   'source',coalesce(nullif(l.attribution->>'source',''),'direct'),
   'campaign',nullif(l.attribution->>'campaign',''),
   'assignedTo',case when l.assigned_account is not null then l.assigned_name else null end,
   'createdAt',l.created_at
  ) order by l.created_at desc,l.id desc) from page_rows l),'[]'::jsonb)
 ) into result from money m;
 return result;
end $$;
revoke all on function public.icash_owner_overview(uuid,integer,boolean,text,integer) from public,anon,authenticated;
grant execute on function public.icash_owner_overview(uuid,integer,boolean,text,integer) to service_role;
