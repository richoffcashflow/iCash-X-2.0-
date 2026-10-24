-- Owner-requested 30% daily work target. This is scheduling priority, not a
-- debit or permission to exceed existing funding, contact or provider limits.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.icash_daily_work_target(p_account uuid) returns jsonb
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
  select baseline_cents,floor(baseline_cents::numeric*0.30)::bigint cents from budget
 )
 select jsonb_build_object('percent',30,'windowHours',24,'baselineCents',t.baseline_cents,
  'targetCents',t.cents,'spentCents',u.spent,'pendingCents',u.pending,
  'remainingCents',greatest(0,t.cents-u.spent-u.pending),
  'priorityRatio',case when t.cents>0 then least(1,(u.spent::numeric+u.pending)/t.cents) else 1 end)
 from target t cross join usage u;
$$;
revoke all on function public.icash_daily_work_target(uuid) from public,anon,authenticated;
grant execute on function public.icash_daily_work_target(uuid) to service_role;

do $patch$
declare d text;needle text:=' order by d.next_run_at,d.account_id limit 20 for update of d skip locked loop';
begin
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 if md5(d)<>'cc2718ea2d90e18ec60d19cc0c728a7f' or (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then
  raise exception 'Daily work target scheduler source changed; review before applying';
 end if;
 -- Accounts overdue by five minutes retain oldest-first service. Within the
 -- normal rotation, prioritize the least-served fraction of each funded target.
 -- No new claims, retries, debits, permission changes or account unpauses.
 execute replace(d,needle,$new$ order by
  (d.next_run_at<now()-interval '5 minutes') desc,
  case when d.next_run_at<now()-interval '5 minutes' then d.next_run_at end,
  coalesce((public.icash_daily_work_target(d.account_id)->>'priorityRatio')::numeric,1),
  d.next_run_at,d.account_id limit 20 for update of d skip locked loop$new$);
end $patch$;
commit;
