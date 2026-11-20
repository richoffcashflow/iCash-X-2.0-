-- Cold prospecting may use at most three sevenths of a verified funded budget
-- in 72 hours. Replies and deal work use their existing separate admissions.
set local lock_timeout='2s';
create index icash_cold_spend_rolling_window on public.icash_operation_spend(account_id,settled_at desc)
 include(charged_cents,operation_key) where state='settled' and prospecting_budget_id is not null;
create function icash_work_private.cold_runway_available(p_account uuid)
returns bigint language sql stable set search_path='' as $fn$
 with budget as (select b.baseline_cents from public.icash_prospecting_budgets b
  where b.account_id=p_account order by b.id desc limit 1),
 committed as (select coalesce(sum(case when o.state='settled' then greatest(0,o.charged_cents-coalesce(c.covered_cents,0))
  else icash_reliability_private.pending_planning_cents(o) end),0)::bigint cents
  from public.icash_operation_spend o left join public.icash_duplicate_discovery_coverage c
   on c.account_id=o.account_id and c.operation_key=o.operation_key
  where o.account_id=p_account and o.prospecting_budget_id is not null and
   (o.state in ('reserved','dispatched') or o.state='settled' and o.settled_at between now()-interval '72 hours' and now()))
 select coalesce((select greatest(0,floor(b.baseline_cents::numeric*3/7)::bigint-c.cents)
  from budget b cross join committed c),0)
$fn$;
revoke all on function icash_work_private.cold_runway_available(uuid) from public,anon,authenticated;
grant execute on function icash_work_private.cold_runway_available(uuid) to service_role;
do $patch$
declare src text:=pg_get_functiondef('icash_work_private.daily_work_priority(uuid)'::regprocedure);
begin
 if md5(src)<>'ba7dbc01ec454d3a1fe7cd3c672c99dc' then raise exception 'Unexpected daily_work_priority predecessor';end if;
 src:=replace(src,$old$select baseline_cents from public.icash_prospecting_budgets
  where account_id=p_account order by id desc limit 1$old$,$new$select b.baseline_cents,a.daily_limit_cents from public.icash_prospecting_budgets b
  join public.icash_accounts a on a.id=b.account_id where b.account_id=p_account order by b.id desc limit 1$new$);
 src:=replace(src,$old$floor(baseline_cents::numeric*0.80)::bigint$old$,$new$least(floor(baseline_cents::numeric/7),floor(daily_limit_cents::numeric*0.80))::bigint$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_daily_work_target(uuid)'::regprocedure);
begin
 if md5(src)<>'19eeb3f58ecd7fe1f928a4365d309a75' then raise exception 'Unexpected icash_daily_work_target predecessor';end if;
 src:=replace(src,$old$select baseline_cents from public.icash_prospecting_budgets
  where account_id=p_account order by id desc limit 1$old$,$new$select b.baseline_cents,a.daily_limit_cents from public.icash_prospecting_budgets b
  join public.icash_accounts a on a.id=b.account_id where b.account_id=p_account order by b.id desc limit 1$new$);
 src:=replace(src,$old$select baseline_cents,floor(baseline_cents::numeric*0.80)::bigint cents$old$,$new$select baseline_cents,daily_limit_cents,least(floor(baseline_cents::numeric/7),floor(daily_limit_cents::numeric*0.30))::bigint minimum_cents,least(floor(baseline_cents::numeric/7),floor(daily_limit_cents::numeric*0.80))::bigint cents$new$);
 src:=replace(src,$old$floor(t.baseline_cents*0.30)::bigint$old$,$new$t.minimum_cents$new$);
 src:=replace(src,$old$'percent',80,'windowHours',24$old$,$new$'percent',80,'dailyLimitCents',t.daily_limit_cents,'runwayDays',7,'windowHours',24$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('public.icash_prospecting_available(uuid)'::regprocedure);
begin
 if md5(src)<>'9b8658ca38e513d6c6a37b282673e1b6' then raise exception 'Unexpected icash_prospecting_available predecessor';end if;
 src:=replace(src,$old$select public.icash_prospecting_total_available(p_account);$old$,$new$select least(public.icash_prospecting_total_available(p_account),icash_work_private.cold_runway_available(p_account));$new$);
 execute src;
end $patch$;
do $patch$
declare src text:=pg_get_functiondef('icash_work_private.platform_usage_pace(boolean)'::regprocedure);
begin
 if md5(src)<>'4dc5b06b103d688aad0b530ae6655932' then raise exception 'Unexpected platform_usage_pace predecessor';end if;
 src:=replace(src,$old$ )
 select jsonb_build_object('settledCents',cents,'minimumCents',50000,'targetCents',75000,'windowHours',24,
  'prioritySeconds',case when cents<50000 then 50 when cents<75000 then 45 else 30 end)
 from observed$old$,$new$ ), funded as (
  select w.balance_cents-w.reserved_cents available,a.daily_limit_cents,b.baseline_cents
  from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
  join public.icash_discovery_configs d on d.account_id=a.id and d.enabled and d.auto_enabled
  join lateral (select b.baseline_cents from public.icash_prospecting_budgets b where b.account_id=a.id order by b.id desc limit 1) b on true
  where not a.bot_paused and (p_include_owner or a.owner_user_id is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid)
   and exists(select 1 from public.icash_memberships m where m.account_id=a.id and m.mode='live' and m.paid_through>now() and m.state in ('active','trialing'))
 ), capacity as (
  select count(*) accounts,coalesce(sum(least(floor(available::numeric/7),floor(baseline_cents::numeric/7),
   floor(daily_limit_cents::numeric*0.80))),0)::bigint cents from funded
 )
 select jsonb_build_object('settledCents',o.cents,'minimumCents',50000,'stretchCents',100000,
  'targetCents',least(100000,c.cents),'fundedAccounts',c.accounts,'runwayDays',7,'capacityCents',c.cents,'windowHours',24,
  'prioritySeconds',case when o.cents<least(50000,c.cents) then 50 when o.cents<least(100000,c.cents) then 45 else 30 end)
 from observed o cross join capacity c$new$);
 execute src;
end $patch$;
