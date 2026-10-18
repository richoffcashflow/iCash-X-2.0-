-- Teaching progress only. It never grants membership, accepts terms, funds or runs work.
create table public.icash_workspace_walkthroughs (
 account_id uuid not null references public.icash_accounts(id) on delete cascade,
 version integer not null check (version=1),
 step integer not null default 0 check (step between 0 and 3),
 state text not null check (state in ('available','active','dismissed','completed')),
 updated_at timestamptz not null default now(),
 primary key (account_id,version),
 check (state<>'completed' or step=3)
);
alter table public.icash_workspace_walkthroughs enable row level security;
revoke all on public.icash_workspace_walkthroughs from public,anon,authenticated;
grant select,insert,update on public.icash_workspace_walkthroughs to service_role;

-- Existing workspace users can choose the tour from their menu; do not claim they completed it.
insert into public.icash_workspace_walkthroughs(account_id,version,state)
 select id,1,'available' from public.icash_accounts where workspace_ack_version is not null;

create function public.icash_save_workspace_walkthrough(p_account uuid,p_user uuid,p_step integer,p_state text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if p_step is null or p_step not between 0 and 3 or p_state is null
 or p_state not in ('active','dismissed','completed') or (p_state='completed' and p_step<>3) then
  raise exception 'Invalid walkthrough progress';
 end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then
  raise exception 'Account owner required';
 end if;
 insert into public.icash_workspace_walkthroughs(account_id,version,step,state)
 values(p_account,1,p_step,p_state)
 on conflict(account_id,version) do update set step=excluded.step,state=excluded.state,updated_at=now();
 return jsonb_build_object('step',p_step,'state',p_state);
end $$;
revoke all on function public.icash_save_workspace_walkthrough(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.icash_save_workspace_walkthrough(uuid,uuid,integer,text) to service_role;
