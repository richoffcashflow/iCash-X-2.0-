
create table icash_private.work_candidates (
 id uuid primary key default gen_random_uuid(), account_id uuid not null, deal_id uuid not null,
 action text not null check(action in ('title_followup','buyer_followup','seller_callback','negotiate','analyze','prospect')),
 due_at timestamptz not null, deadline_at timestamptz,
 estimated_charge_cents bigint not null check(estimated_charge_cents>0),
 estimated_provider_cost_usd numeric(18,8) not null check(estimated_provider_cost_usd>=0),
 quality_score numeric(5,4) not null check(quality_score between 0 and 1),
 evidence_ref text not null check(length(trim(evidence_ref))>0),
 permission_verified_until timestamptz not null,
 status text not null default 'pending' check(status in ('pending','claimed','done','canceled')),
 operation_key text not null unique,
 foreign key(account_id,deal_id) references public.icash_deals(account_id,id)
);
create index icash_work_due on icash_private.work_candidates(account_id,deal_id,status,due_at);
alter table icash_private.work_candidates enable row level security;
grant select,insert,update on icash_private.work_candidates to service_role;

create table public.icash_notification_preferences (
 account_id uuid primary key references public.icash_accounts(id),
 in_app_enabled boolean not null default true,
 email_enabled boolean not null default false,
 push_enabled boolean not null default false,
 sms_enabled boolean not null default false,
 sms_consent_at timestamptz,
 last_funding_prompt_at timestamptz,
 check(not sms_enabled or sms_consent_at is not null)
);
alter table public.icash_notification_preferences enable row level security;
revoke all on public.icash_notification_preferences from anon,authenticated;
grant select on public.icash_notification_preferences to authenticated;
grant select,insert,update on public.icash_notification_preferences to service_role;
create policy own_account on public.icash_notification_preferences for select to authenticated
using(account_id in(select id from public.icash_accounts where owner_user_id=(select auth.uid())));

-- Recommendations only; dispatch must recheck permissions, claim an exclusive lease and reserve credits.
create function public.icash_next_work(p_account uuid)
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
 and (c.estimated_charge_cents/100.0-c.estimated_provider_cost_usd)/(c.estimated_charge_cents/100.0)
 >= coalesce((cfg.settings->>'minimum_gross_margin')::numeric,1)
 order by (c.deadline_at<=now()+interval '48 hours') desc nulls last,
 (d.seller_signed_at is not null) desc,
 (c.action='seller_callback') desc,
 c.deadline_at asc nulls last,c.quality_score desc,c.due_at,c.id
 limit 1;
$$;

create function public.icash_retention_action(p_account uuid)
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
 if prefs.last_funding_prompt_at>now()-interval '24 hours' then return 'none'; end if;
 select count(*) into active_count from public.icash_deals where account_id=p_account and stage in ('seller','offer','contract','buyer','title','closing');
 if active_count>0 and exists (
 select 1 from icash_private.work_candidates c where c.account_id=p_account and c.status='pending'
 and c.due_at<=now() and c.permission_verified_until>now()
 and c.estimated_charge_cents>w.balance_cents-w.reserved_cents
 ) then return 'fund_verified_work'; end if;
 return 'none';
end; $$;
revoke all on function public.icash_next_work(uuid) from public,anon,authenticated;
revoke all on function public.icash_retention_action(uuid) from public,anon,authenticated;
grant execute on function public.icash_next_work(uuid),public.icash_retention_action(uuid) to service_role;
