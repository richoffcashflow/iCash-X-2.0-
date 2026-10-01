begin;
-- Persist Stop intent before any provider reads. No billing or account data is changed on install.
create function public.icash_pause_work_and_billing(p_user uuid,p_account uuid,p_mode text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if p_mode is null or p_mode not in ('live','test') then raise exception 'Billing mode required';end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account ownership required';end if;
 -- Keep budget first; invoice settlement already takes its plan before the account.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_daily_plans where account_id=p_account and mode=p_mode and state<>'stopped' order by id for update;
 perform public.icash_set_work_control(p_user,p_account,'pause',null);
 update public.icash_daily_plans set state='stop_requested' where account_id=p_account and mode=p_mode and state not in ('stop_requested','stopped');
end $$;
revoke all on function public.icash_pause_work_and_billing(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_pause_work_and_billing(uuid,uuid,text) to service_role;
commit;
