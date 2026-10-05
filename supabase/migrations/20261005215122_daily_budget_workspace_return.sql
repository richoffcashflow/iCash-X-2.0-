begin;
-- Daily usage funding can coexist with the existing monthly membership.
-- Customers opt in through checkout; this does not create or change a subscription.
CREATE OR REPLACE FUNCTION public.icash_daily_claim(p_account uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a public.icash_accounts;p public.icash_daily_plans;last_budget bigint;funded bigint;
begin
 select * into a from public.icash_accounts where id=p_account for update;
 if not found or not public.icash_membership_work_allowed(p_account) then return;end if;
 update public.icash_daily_plans d set account_id=p_account where d.account_id is null and exists(select 1 from public.icash_funding_orders o where o.daily_plan_id=d.id and o.account_id=p_account);
 select * into p from public.icash_daily_plans where account_id=p_account and mode='live' and state='active' order by created_at desc limit 1 for update;
 if not found then return;end if;
 select credit_cents into last_budget from public.icash_funding_orders where account_id=p_account and daily_plan_id=p.id and mode='live' and state='paid' and credited_at is not null order by billing_period_start desc nulls last,paid_at desc,created_at desc,id desc limit 1;
 if last_budget is null then return;end if;
 update public.icash_accounts set daily_limit_cents=last_budget where id=p_account;
 if p.consent_version not like 'daily-2026-10-04.1%' or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null) then return;end if;
 select coalesce(sum(credit_cents),0) into funded from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null;
 if funded not between 1 and 100000000 then return;end if;
 if p.activated_at is not null then
  -- Renewals grow an already-authorized cap, but never undo Pause or a review hold.
  update public.icash_spend_activations set customer_cap_cents=funded where account_id=p_account and enabled;
  return;
 end if;
 insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents) values(p_account,true,funded)
 on conflict(account_id) do update set enabled=true,customer_cap_cents=excluded.customer_cap_cents;
 update public.icash_accounts set billing_model=case when billing_model='membership_credits' then billing_model else 'daily' end,bot_paused=false where id=p_account;
 update public.icash_daily_plans set activated_at=now() where id=p.id;
end $function$;

revoke all on function public.icash_daily_claim(uuid) from public,anon,authenticated;
grant execute on function public.icash_daily_claim(uuid) to service_role;
commit;
