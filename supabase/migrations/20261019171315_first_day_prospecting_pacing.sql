-- Owner-authorized first-day policy: fixed 50% allowance, released over 12 hours
-- in bounded hourly batches. Existing funding snapshots and charges stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$
declare release_definition text;availability_definition text;progress_definition text;
begin
 release_definition:=pg_get_functiondef('public.icash_prospecting_released(bigint,timestamptz)'::regprocedure);
 availability_definition:=pg_get_functiondef('public.icash_prospecting_available(uuid)'::regprocedure);
 progress_definition:=pg_get_functiondef('public.icash_prospecting_progress(uuid)'::regprocedure);
 if position('(29*86400)' in release_definition)=0
  or position('ceil(b.limit_cents/30.0)' in availability_definition)=0
  or position('recent_amount' in availability_definition)=0
  or position('''pacingDays'',30' in progress_definition)=0 then
  raise exception 'First-day prospecting prerequisite changed';
 end if;
end $guard$;
create or replace function public.icash_prospecting_released(p_balance bigint,p_started timestamptz) returns bigint
language sql stable set search_path='' as $$
 with cap as (select greatest(0,p_balance/2) total),
 starter as (select total,least(total,greatest(500,ceil(total/10.0))) initial from cap)
 select (initial+floor((total-initial)*least(1,greatest(0,extract(epoch from (now()-p_started))/(12*3600)))))::bigint from starter;
$$;
create or replace function public.icash_prospecting_available(p_account uuid) returns bigint
language sql stable set search_path='' as $$
 with budget as (select * from public.icash_prospecting_budgets where account_id=p_account order by id desc limit 1),
 usage as (select
  coalesce(sum(case when o.state='settled' and (o.prospecting_budget_id=b.id or (o.prospecting_budget_id is not null and o.settled_at>now()-interval '24 hours')) then o.charged_cents
   when o.state in ('reserved','dispatched') and (o.prospecting_budget_id is not null or public.icash_new_prospect_operation(p_account,o.operation_key,o.rate_id)) then o.charge_cap_cents else 0 end),0) amount,
  coalesce(sum(case when o.state='settled' and o.prospecting_budget_id is not null and o.settled_at>now()-interval '24 hours' then o.charged_cents
   when o.state in ('reserved','dispatched') and (o.prospecting_budget_id is not null or public.icash_new_prospect_operation(p_account,o.operation_key,o.rate_id)) then o.charge_cap_cents else 0 end),0) recent_amount,
  coalesce(sum(case when o.state='settled' and o.prospecting_budget_id is not null and o.settled_at>now()-interval '1 hour' then o.charged_cents
   when o.state in ('reserved','dispatched') and (o.prospecting_budget_id is not null or public.icash_new_prospect_operation(p_account,o.operation_key,o.rate_id)) then o.charge_cap_cents else 0 end),0) hour_amount
  from public.icash_operation_spend o cross join budget b where o.account_id=p_account)
 select coalesce((select greatest(0,least(
  public.icash_prospecting_total_available(p_account),
  public.icash_prospecting_released(b.baseline_cents,b.created_at)-usage.amount,
  b.limit_cents-usage.recent_amount,
  least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))-usage.hour_amount
 ))::bigint from budget b cross join usage),0);
$$;
do $progress$
declare definition text;needle text:='''pacingDays'',30';
begin
 definition:=pg_get_functiondef('public.icash_prospecting_progress(uuid)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Prospecting progress policy boundary changed';end if;
 execute replace(definition,needle,'''pacingHours'',12,''batchHours'',1,''hourlyLimitCents'',least(b.limit_cents,greatest(500,ceil(b.limit_cents/10.0)))');
end $progress$;
revoke all on function public.icash_prospecting_released(bigint,timestamptz),public.icash_prospecting_available(uuid),public.icash_prospecting_progress(uuid) from public,anon,authenticated;
grant execute on function public.icash_prospecting_released(bigint,timestamptz),public.icash_prospecting_available(uuid),public.icash_prospecting_progress(uuid) to service_role;
commit;
