-- The owner revised the platform-wide rolling daily work target from 30% to
-- 25% on October 24, 2026. Preserve verified baselines, actual usage, pending
-- reservations, account fairness and every existing admission/billing limit.
begin;
set local lock_timeout='5s';
create or replace function public.icash_daily_work_target(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 with budget as (
  select baseline_cents from public.icash_prospecting_budgets
  where account_id=p_account order by id desc limit 1
 ), usage as (
  select coalesce(sum(greatest(0,o.charged_cents-coalesce(c.covered_cents,0)))
    filter(where o.state='settled' and o.settled_at>now()-interval '24 hours'),0)::bigint spent,
   coalesce(sum(o.charge_cap_cents) filter(where o.state in ('reserved','dispatched')),0)::bigint pending
  from public.icash_operation_spend o
  left join public.icash_duplicate_discovery_coverage c on c.operation_key=o.operation_key and c.account_id=o.account_id
  where o.account_id=p_account and (o.state in ('reserved','dispatched') or (o.state='settled' and o.settled_at>now()-interval '24 hours'))
 ), target as (
  select baseline_cents,floor(baseline_cents::numeric*0.25)::bigint cents from budget
 )
 select jsonb_build_object('percent',25,'windowHours',24,'baselineCents',t.baseline_cents,
  'targetCents',t.cents,'spentCents',u.spent,'pendingCents',u.pending,
  'remainingCents',greatest(0,t.cents-u.spent-u.pending),
  'priorityRatio',case when t.cents>0 then least(1,(u.spent::numeric+u.pending)/t.cents) else 1 end)
 from target t cross join usage u;
$$;
revoke all on function public.icash_daily_work_target(uuid) from public,anon,authenticated;
grant execute on function public.icash_daily_work_target(uuid) to service_role;
commit;

