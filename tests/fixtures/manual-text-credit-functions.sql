CREATE OR REPLACE FUNCTION public.icash_apply_prepaid_purchase(p_order uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.icash_funding_orders;funded bigint;a public.icash_accounts;
begin
 select * into o from public.icash_funding_orders where id=p_order for update;
 if not found or o.mode<>'live' or o.state<>'paid' or o.account_id is null or o.credited_at is null then return false;end if;
 if o.prepaid_applied_at is not null then return true;end if;
 if not exists(select 1 from public.icash_funding_consents c where c.order_id=o.id and c.version in ('work-credits-2026-10-03.1','work-credits-2026-10-05.1','work-credits-2026-10-06.1','work-credits-2026-10-06.1:recharge-2026-10-06.1') and c.account_id=o.account_id and c.price_cents=o.price_cents and c.credit_cents=o.credit_cents) then return false;end if;
 select * into a from public.icash_accounts where id=o.account_id for update;
 if exists(select 1 from public.icash_daily_plans where account_id=a.id and mode='live' and state<>'stopped') then return false;end if;
 if exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null) or not public.icash_membership_work_allowed(a.id) then return false;end if;
 perform 1 from public.icash_wallets where account_id=a.id for update;
 select coalesce(sum(credit_cents),0) into funded from public.icash_funding_orders where account_id=a.id and mode='live' and state='paid' and credited_at is not null;
 if funded<=0 or funded>100000000 then return false;end if;
 insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents) values(a.id,true,funded)
 on conflict(account_id) do update set enabled=true,customer_cap_cents=excluded.customer_cap_cents;
 update public.icash_accounts set billing_model=case when billing_model='legacy' then 'prepaid' else billing_model end,daily_limit_cents=(select reserved_cents+public.icash_credit_work_pace(greatest(0,balance_cents-reserved_cents))+coalesce((select sum(-delta_cents) from public.icash_credit_ledger where account_id=a.id and kind='usage' and created_at>now()-interval '24 hours'),0) from public.icash_wallets where account_id=a.id),bot_paused=false where id=a.id;
 update public.icash_funding_orders set prepaid_applied_at=now(),pacing_applied_at=now() where id=o.id;
 -- Provider/channel, identity, contact, cost, offer and contract authority checks still run at dispatch.
 return true;
end $function$
;
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
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_reserve_before_membership(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cap bigint;used numeric;charge bigint;b public.icash_operating_budget;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.require_company_reserve then
 select customer_cap_cents into cap from public.icash_spend_activations where account_id=p_account and enabled;
 if cap is null or not exists(select 1 from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null) then raise exception 'Account spending not activated';end if;
 if not exists(select 1 from public.icash_operation_spend where operation_key=p_operation) then
 select charge_cents into charge from public.icash_operation_rates where id=p_rate;
 select coalesce(sum(case when state='settled' then charged_cents else charge_cap_cents end),0) into used from public.icash_operation_spend where account_id=p_account and state in ('reserved','dispatched','settled');
 if charge is null or used+charge>cap then raise exception 'Activation spending cap reached';end if;
 end if;
 end if;
 return public.icash_reserve_before_activation(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_settle_auto_recharge(p_attempt uuid, p_payment text, p_amount bigint, p_customer text, p_method text, p_mode text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_auto_recharge_attempts;o public.icash_funding_orders;funded bigint;
begin
 select * into strict t from public.icash_auto_recharge_attempts where id=p_attempt for update;
 if t.mode is distinct from p_mode or p_payment is null or p_payment !~ '^pi_[A-Za-z0-9]+$' or t.amount_cents is distinct from p_amount or t.stripe_customer_id is distinct from p_customer or t.stripe_payment_method_id is distinct from p_method or (t.stripe_payment_id is not null and t.stripe_payment_id<>p_payment) then raise exception 'Auto recharge payment mismatch';end if;
 select * into strict o from public.icash_funding_orders where id=t.order_id for update;
 if o.credited_at is null then
  update public.icash_funding_orders set state='paid',stripe_payment_id=p_payment,paid_at=now(),charged_total_cents=p_amount,credited_at=now(),payer_email=(select payer_email from public.icash_funding_orders where id=t.approved_order) where id=o.id;
  if p_mode='live' then perform public.icash_post_credit(t.account_id,'stripe-funding:'||o.id,'purchase',o.credit_cents,p_payment);end if;
 end if;
 update public.icash_auto_recharge_attempts set state='paid',stripe_payment_id=p_payment,lease_until=null where id=t.id;
 -- Grow the already-authorized work cap; never undo a pause or cancellation.
 if p_mode='live' then
  select coalesce(sum(credit_cents),0) into funded from public.icash_funding_orders where account_id=t.account_id and mode='live' and state='paid' and credited_at is not null;
  update public.icash_spend_activations set customer_cap_cents=funded where account_id=t.account_id and enabled;
 end if;
end $function$
;
