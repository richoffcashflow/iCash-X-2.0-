create or replace function public.icash_next_work(p_account uuid)
returns table(candidate_id uuid,action text,deal_id uuid,charge_cents bigint,reason text)
language sql stable security invoker set search_path='' as $$
 with cfg as (
 select settings from icash_private.engine_configs where engine='deal' and enabled
 ), funding as (
 select a.id,a.daily_limit_cents,w.balance_cents-w.reserved_cents as available,
 a.daily_limit_cents-w.reserved_cents-coalesce((select sum(-l.delta_cents)
 from public.icash_credit_ledger l where l.account_id=a.id and l.kind='usage'
 and l.created_at>now()-interval '24 hours'),0) as remaining
 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
 where a.id=p_account and not a.bot_paused
 )
 select c.id,c.action,c.deal_id,c.estimated_charge_cents,
 case when c.deadline_at<=now()+interval '48 hours' then 'Contract deadline'
 when d.seller_signed_at is not null then 'Protect active contract'
 when c.action='seller_callback' then 'Honor seller callback'
 else 'Verified opportunity within budget' end
 from icash_private.work_candidates c
 join public.icash_deals d on d.account_id=c.account_id and d.id=c.deal_id
 join funding f on f.id=c.account_id cross join cfg
 where c.status='pending' and c.due_at<=now() and c.permission_verified_until>now()
 and d.stage not in ('closed','stopped') and not d.needs_user
 and c.estimated_charge_cents<=least(f.available,f.remaining)
 and (c.action<>'prospect' or not exists (
 select 1 from icash_private.work_candidates urgent
 join public.icash_deals active on active.account_id=urgent.account_id and active.id=urgent.deal_id
 where urgent.account_id=c.account_id and urgent.status='pending' and active.seller_signed_at is not null
 and active.stage not in ('closed','stopped') and urgent.due_at<=now()+interval '48 hours'
 ))
 and (c.estimated_charge_cents/100.0-c.estimated_provider_cost_usd)/(c.estimated_charge_cents/100.0)
 >= coalesce((cfg.settings->>'minimum_gross_margin')::numeric,1)
 order by (c.deadline_at<=now()+interval '48 hours') desc nulls last,
 (d.seller_signed_at is not null) desc,
 (c.action='seller_callback') desc,
 c.deadline_at asc nulls last,c.quality_score desc,c.due_at,c.id
 limit 1;
$$;

create or replace function public.icash_retention_action(p_account uuid)
returns text language plpgsql stable security invoker set search_path='' as $$
declare a public.icash_accounts; w public.icash_wallets; prefs public.icash_notification_preferences; active_count bigint;
begin
 if not exists(select 1 from icash_private.engine_configs where engine='retention' and enabled) then return 'disabled'; end if;
 select * into a from public.icash_accounts where id=p_account;
 if not found then return 'no_account'; end if;
 select * into prefs from public.icash_notification_preferences where account_id=p_account;
 if not found or not prefs.in_app_enabled then return 'none'; end if;
 if exists(select 1 from public.icash_deals where account_id=p_account and needs_user and stage not in ('closed','stopped')) then return 'needs_you'; end if;
 if a.bot_paused then return 'paused_by_user'; end if;
 select * into w from public.icash_wallets where account_id=p_account;
 if not found then return 'none'; end if;
 if prefs.last_funding_prompt_at>now()-make_interval(hours=>greatest(24,coalesce((select (settings->>'minimum_hours_between_prompts')::integer from icash_private.engine_configs where engine='retention'),24))) then return 'none'; end if;
 select count(*) into active_count from public.icash_deals where account_id=p_account and stage in ('seller','offer','contract','buyer','title','closing');
 if active_count>0 and exists (
 select 1 from icash_private.work_candidates c where c.account_id=p_account and c.status='pending'
 and c.due_at<=now() and c.permission_verified_until>now()
 and c.estimated_charge_cents>w.balance_cents-w.reserved_cents
 and c.estimated_charge_cents<=a.daily_limit_cents-w.reserved_cents-coalesce(
 (select sum(-delta_cents) from public.icash_credit_ledger where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours'),0)
 and exists(select 1 from public.icash_deals d where d.account_id=c.account_id and d.id=c.deal_id and not d.needs_user and d.stage not in ('closed','stopped'))
 and exists(select 1 from icash_private.engine_configs cfg where cfg.engine='deal' and cfg.enabled
 and (c.estimated_charge_cents/100.0-c.estimated_provider_cost_usd)/(c.estimated_charge_cents/100.0)>=coalesce((cfg.settings->>'minimum_gross_margin')::numeric,1))
 ) then return 'fund_verified_work'; end if;
 return 'none';
end; $$;

create view icash_private.account_economics with (security_invoker=true) as
select a.id as account_id,
 coalesce(l.purchases,0) as purchased_credit_cents,
 coalesce(l.refunds,0) as refunded_credit_cents,
 coalesce(l.consumed,0) as consumed_credit_cents,
 coalesce(c.cost,0) as provider_cost_usd,
 coalesce(l.consumed,0)/100.0-coalesce(c.cost,0) as usage_contribution_usd,
 case when coalesce(l.consumed,0)>0 then
 (l.consumed/100.0-coalesce(c.cost,0))/(l.consumed/100.0) else null end as usage_margin,
 coalesce(d.contracts,0) as contracts, coalesce(d.closings,0) as confirmed_closings
from public.icash_accounts a
left join lateral (select sum(delta_cents) filter(where kind='purchase') as purchases,
 sum(-delta_cents) filter(where kind='refund') as refunds,
 sum(-delta_cents) filter(where kind='usage') as consumed
 from public.icash_credit_ledger where account_id=a.id) l on true
left join lateral(select sum(cost_usd) as cost from icash_private.provider_costs where account_id=a.id) c on true
left join lateral(select count(*) filter(where seller_signed_at is not null) as contracts,
 count(*) filter(where closed_confirmed_at is not null) as closings
 from public.icash_deals where account_id=a.id) d on true;
revoke all on icash_private.account_economics from public,anon,authenticated;
grant select on icash_private.account_economics to service_role;
