-- Admin feature previews are separate from paid VIP and its discounts.
begin;
create table public.icash_workspace_previews (
 account_id uuid primary key references public.icash_accounts(id),
 user_id uuid not null,
 mode text not null check(mode in ('standard','vip')),
 expires_at timestamptz not null,
 updated_at timestamptz not null default now()
);
alter table public.icash_workspace_previews enable row level security;
revoke all on public.icash_workspace_previews from public,anon,authenticated;
grant all on public.icash_workspace_previews to service_role;

create function public.icash_set_workspace_preview(p_account uuid,p_user uuid,p_mode text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 -- Reuse the installed platform-owner authorization, never user-editable claims.
 perform public.icash_owner_overview(p_user,1,false,'',1);
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then raise exception 'Account required';end if;
 if p_mode is null then
  delete from public.icash_workspace_previews where account_id=p_account and user_id=p_user;
  return;
 end if;
 if p_mode not in ('standard','vip') then raise exception 'Invalid preview';end if;
 if exists(select 1 from public.icash_accounts a where a.id=p_account and a.billing_model='membership_credits'
  and not exists(select 1 from public.icash_memberships m where m.account_id=a.id and m.mode='live' and m.state='active' and m.paid_through>now())) then
  raise exception 'Active subscription required';
 end if;
 insert into public.icash_workspace_previews(account_id,user_id,mode,expires_at)
 values(p_account,p_user,p_mode,now()+interval '4 hours')
 on conflict(account_id) do update set user_id=excluded.user_id,mode=excluded.mode,expires_at=excluded.expires_at,updated_at=now();
end $$;

create function public.icash_workspace_preview_mode(p_account uuid)
returns text language sql stable security invoker set search_path='' as $$
 select p.mode from public.icash_workspace_previews p
 join public.icash_accounts a on a.id=p.account_id and a.owner_user_id=p.user_id
 where p.account_id=p_account and p.expires_at>now()
 and (a.billing_model<>'membership_credits' or exists(select 1 from public.icash_memberships m
  where m.account_id=a.id and m.mode='live' and m.state='active' and m.paid_through>now()))
$$;
create function public.icash_vip_features_active(p_account uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select case public.icash_workspace_preview_mode(p_account)
  when 'vip' then true when 'standard' then false else public.icash_vip_active(p_account) end
$$;
create function public.icash_workspace_vip_access(p_account uuid)
returns jsonb language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('vip',public.icash_vip_active(p_account),
  'vipFeatures',public.icash_vip_features_active(p_account),
  'workspacePreview',public.icash_workspace_preview_mode(p_account))
$$;
revoke all on function public.icash_set_workspace_preview(uuid,uuid,text),public.icash_workspace_preview_mode(uuid),public.icash_vip_features_active(uuid),public.icash_workspace_vip_access(uuid) from public,anon,authenticated;
grant execute on function public.icash_set_workspace_preview(uuid,uuid,text),public.icash_workspace_preview_mode(uuid),public.icash_vip_features_active(uuid),public.icash_workspace_vip_access(uuid) to service_role;

-- Only feature gates change. Pricing, savings, priority and subscription functions
-- continue to use icash_vip_active and verified paid membership.
do $features$
declare signature text;definition text;
begin
 foreach signature in array array[
  'public.icash_begin_custom_voice(uuid,uuid,text,text)',
  'public.icash_set_custom_voice_enabled(uuid,uuid,boolean)',
  'public.icash_vip_call_voice(uuid)',
  'public.icash_network_deal_current(uuid,uuid)',
  'public.icash_network_demand(uuid)',
  'public.icash_network_save_buyer(uuid,jsonb)',
  'public.icash_network_save_settings(uuid,uuid,boolean,text)',
  'public.icash_network_workspace(uuid,uuid)',
  'public.icash_queue_fulfillment()'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if strpos(definition,'public.icash_vip_active(')=0 then raise exception 'Missing expected feature gate in %',signature;end if;
  execute replace(definition,'public.icash_vip_active(','public.icash_vip_features_active(');
 end loop;
end $features$;

-- Keep the existing RPC name for clients already open during deployment.
create or replace function public.icash_save_vip_bot_name(p_user uuid,p_account uuid,p_name text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_accounts a where a.id=p_account and a.owner_user_id=p_user
  and (a.billing_model<>'membership_credits' or exists(select 1 from public.icash_memberships m
   where m.account_id=a.id and m.mode='live' and m.state='active' and m.paid_through>now())) for update;
 if not found then raise exception 'Active account required';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 64 or p_name ~ '[<>{}[:cntrl:]]' then raise exception 'Invalid bot name';end if;
 update public.icash_accounts set assistant_name=trim(p_name) where id=p_account;
 update public.icash_bot_setups set profile=jsonb_set(profile,'{displayName}',to_jsonb(trim(p_name))),revision=revision+1,updated_at=now() where account_id=p_account;
end $$;
revoke all on function public.icash_save_vip_bot_name(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_save_vip_bot_name(uuid,uuid,text) to service_role;
commit;
