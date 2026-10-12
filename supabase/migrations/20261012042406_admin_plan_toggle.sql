-- Actual, durable plan selection for the platform owner's own account.
-- Stripe membership and existing usage records are never rewritten.
begin;
create table public.icash_admin_plans (
 account_id uuid primary key references public.icash_accounts(id),
 user_id uuid not null,
 plan text not null check(plan in ('standard','vip')),
 updated_at timestamptz not null default now()
);
alter table public.icash_admin_plans enable row level security;
revoke all on public.icash_admin_plans from public,anon,authenticated;
grant all on public.icash_admin_plans to service_role;

create function public.icash_set_admin_plan(p_account uuid,p_user uuid,p_plan text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.icash_owner_overview(p_user,1,false,'',1);
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then raise exception 'Account required';end if;
 if p_plan is null or p_plan not in ('standard','vip') then raise exception 'Invalid plan';end if;
 if exists(select 1 from public.icash_accounts a where a.id=p_account and a.billing_model='membership_credits'
  and not exists(select 1 from public.icash_memberships m where m.account_id=a.id and m.mode='live' and m.state='active' and m.paid_through>now())) then
  raise exception 'Active subscription required';
 end if;
 insert into public.icash_admin_plans(account_id,user_id,plan) values(p_account,p_user,p_plan)
 on conflict(account_id) do update set user_id=excluded.user_id,plan=excluded.plan,updated_at=now();
end $$;

create function public.icash_admin_plan_mode(p_account uuid)
returns text language sql stable security invoker set search_path='' as $$
 select p.plan from public.icash_admin_plans p
 join public.icash_accounts a on a.id=p.account_id and a.owner_user_id=p.user_id
 where p.account_id=p_account
 and (a.billing_model<>'membership_credits' or exists(select 1 from public.icash_memberships m
  where m.account_id=a.id and m.mode='live' and m.state='active' and m.paid_through>now()))
$$;

-- All real feature, usage-discount and lead-priority gates share this entitlement.
-- Customer subscription renewal/checkout still uses its paid membership fields.
create or replace function public.icash_vip_active(p_account uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(public.icash_admin_plan_mode(p_account)='vip',
  exists(select 1 from public.icash_memberships m where m.account_id=p_account and m.mode='live'
   and m.state='active' and m.paid_through>now() and m.vip_until>now()))
$$;
create or replace function public.icash_vip_features_active(p_account uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select public.icash_vip_active(p_account)
$$;
create or replace function public.icash_workspace_vip_access(p_account uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('vip',public.icash_vip_active(p_account),
  'vipFeatures',public.icash_vip_active(p_account),'adminPlan',public.icash_admin_plan_mode(p_account),
  'workspacePreview',null)
$$;

-- Already-open clients must refresh instead of silently choosing a real plan
-- through a button labeled preview. Old sign-out cleanup cannot undo the plan.
create or replace function public.icash_set_workspace_preview(p_account uuid,p_user uuid,p_mode text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.icash_owner_overview(p_user,1,false,'',1);
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account required';end if;
 if p_mode is not null then raise exception 'Refresh to use the admin account plan switch';end if;
 -- Legacy cleanup is a no-op; the new plan is intentionally durable.
 return;
end $$;
create or replace function public.icash_workspace_preview_mode(p_account uuid)
returns text language sql stable security invoker set search_path='' as $$select null::text$$;

revoke all on function public.icash_set_admin_plan(uuid,uuid,text),public.icash_admin_plan_mode(uuid),public.icash_vip_active(uuid),public.icash_vip_features_active(uuid),public.icash_workspace_vip_access(uuid),public.icash_set_workspace_preview(uuid,uuid,text),public.icash_workspace_preview_mode(uuid) from public,anon,authenticated;
grant execute on function public.icash_set_admin_plan(uuid,uuid,text),public.icash_admin_plan_mode(uuid),public.icash_vip_active(uuid),public.icash_vip_features_active(uuid),public.icash_workspace_vip_access(uuid),public.icash_set_workspace_preview(uuid,uuid,text),public.icash_workspace_preview_mode(uuid) to service_role;
commit;
