alter table public.icash_funding_orders add column run_days integer check(run_days between 1 and 30),add column pacing_applied_at timestamptz;
create function public.icash_apply_funding_pacing(p_account uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.icash_funding_orders;
begin
 perform 1 from public.icash_accounts where id=p_account for update;
 if not found then raise exception 'Account missing';end if;
 select * into o from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null and run_days is not null and pacing_applied_at is null order by created_at desc limit 1 for update;
 if not found then return;end if;
 update public.icash_accounts set daily_limit_cents=greatest(1,o.credit_cents/o.run_days) where id=p_account;
 update public.icash_funding_orders set pacing_applied_at=now() where account_id=p_account and mode='live' and state='paid' and credited_at is not null and run_days is not null and pacing_applied_at is null and created_at<=o.created_at;
end $$;
revoke all on function public.icash_apply_funding_pacing(uuid) from public,anon,authenticated;
grant execute on function public.icash_apply_funding_pacing(uuid) to service_role;
