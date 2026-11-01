-- Owner-only read model. These totals never alter pricing, invoices or wallets.
begin;
set local lock_timeout='5s';
create function public.icash_owner_cost_evidence(p_actor uuid,p_days integer default 30,p_include_owner boolean default false)
returns jsonb language plpgsql stable security invoker set search_path='' as $function$
declare owner_id constant uuid:='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7';start_at timestamptz;end_at timestamptz:=now();result jsonb;
begin
 if p_actor is distinct from owner_id then raise exception 'Owner required' using errcode='42501';end if;
 if p_days is null or p_days not in (1,7,30) or p_include_owner is null then raise exception 'Invalid report filters';end if;
 start_at:=((end_at at time zone 'America/Chicago')::date-(p_days-1))::timestamp at time zone 'America/Chicago';
 with accounts as materialized (
  select a.id from public.icash_accounts a where (p_include_owner or a.owner_user_id<>owner_id)
   and (not exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='test' and f.state='paid')
    or exists(select 1 from public.icash_funding_orders f where f.account_id=a.id and f.mode='live' and f.state='paid'))
 ), completed as materialized (
  select o.operation_key,o.actual_micros,m.components,m.actual_micros manifest_micros
  from public.icash_operation_spend o join accounts a on a.id=o.account_id
  left join public.icash_cost_manifests m on m.operation_key=o.operation_key
  where o.state='settled' and o.settled_at>=start_at and o.settled_at<end_at
 ), parts as materialized (
  select c.operation_key,p.key provider,p.value->>'basis' basis,(p.value->>'amountMicros')::bigint amount
  from completed c cross join lateral jsonb_each(c.components) p
 ), part_totals as (
  select operation_key,sum(amount) total from parts group by operation_key
 ), providers as (
  select provider,coalesce(sum(amount) filter(where basis='verified'),0) verified,
   coalesce(sum(amount) filter(where basis='estimated'),0) estimated,
   coalesce(sum(amount) filter(where basis is null or basis not in ('verified','estimated')),0) unclassified
  from parts group by provider
 ) select jsonb_build_object(
  'days',p_days,'includeOwner',p_include_owner,'startAt',start_at,'endAt',end_at,
  'completedCount',(select count(*) from completed),
  'missingManifestCount',(select count(*) from completed where components is null),
  'mismatchedManifestCount',(select count(*) from completed c left join part_totals p using(operation_key) where components is not null and (
   manifest_micros is distinct from actual_micros or manifest_micros is distinct from p.total)),
  'recordedCostMicros',(select coalesce(sum(actual_micros),0) from completed),
  'verifiedMicros',(select coalesce(sum(verified),0) from providers),
  'estimatedMicros',(select coalesce(sum(estimated),0) from providers),
  'unclassifiedMicros',(select coalesce(sum(unclassified),0) from providers),
  'dealmachineCredits',(select coalesce(sum(obs.amount),0) from public.icash_cost_observations obs
   join completed c on c.operation_key=obs.event_key where obs.provider='dealmachine' and obs.units='provider_credits'),
  'providers',coalesce((select jsonb_agg(jsonb_build_object('provider',provider,'verifiedMicros',verified,
   'estimatedMicros',estimated,'unclassifiedMicros',unclassified) order by verified+estimated+unclassified desc,provider)
   from providers where verified+estimated+unclassified>0),'[]'::jsonb)
 ) into result;
 return result;
end $function$;
revoke all on function public.icash_owner_cost_evidence(uuid,integer,boolean) from public,anon,authenticated;
grant execute on function public.icash_owner_cost_evidence(uuid,integer,boolean) to service_role;
commit;
