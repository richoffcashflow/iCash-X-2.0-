-- Keep the 30-day cumulative release, and prevent an idle/paused account from
-- spending all accumulated capacity when useful work becomes available again.
begin;
set local lock_timeout='5s';
create or replace function public.icash_prospecting_available(p_account uuid) returns bigint
language sql stable set search_path='' as $$
 with budget as (select * from public.icash_prospecting_budgets where account_id=p_account order by id desc limit 1),
 usage as (select
  coalesce(sum(case when o.state='settled' and (o.prospecting_budget_id=b.id or (o.prospecting_budget_id is not null and o.settled_at>now()-interval '24 hours')) then o.charged_cents
   when o.state in ('reserved','dispatched') and (o.prospecting_budget_id is not null or public.icash_new_prospect_operation(p_account,o.operation_key,o.rate_id)) then o.charge_cap_cents else 0 end),0) amount,
  coalesce(sum(case when o.state='settled' and o.prospecting_budget_id is not null and o.settled_at>now()-interval '24 hours' then o.charged_cents
   when o.state in ('reserved','dispatched') and (o.prospecting_budget_id is not null or public.icash_new_prospect_operation(p_account,o.operation_key,o.rate_id)) then o.charge_cap_cents else 0 end),0) recent_amount
  from public.icash_operation_spend o cross join budget b where o.account_id=p_account)
 select coalesce((select greatest(0,least(
  public.icash_prospecting_total_available(p_account),
  public.icash_prospecting_released(b.baseline_cents,b.created_at)-usage.amount,
  least(b.limit_cents,greatest(250,ceil(b.limit_cents/30.0)))-usage.recent_amount
 ))::bigint from budget b cross join usage),0);
$$;
revoke all on function public.icash_prospecting_available(uuid) from public,anon,authenticated;
grant execute on function public.icash_prospecting_available(uuid) to service_role;
commit;
