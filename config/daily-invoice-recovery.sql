begin;
alter table public.icash_daily_plans add column if not exists invoice_reconcile_cursor text;
-- Provider billing-period chronology is separate from payment completion and local processing time.
alter table public.icash_funding_orders add column if not exists billing_period_start timestamptz;

create or replace function public.icash_settle_daily_invoice_v2(p_plan uuid,p_quote uuid,p_invoice text,p_payment text,p_amount bigint,p_tax bigint,p_email text,p_phone text,p_cycle_start timestamptz,p_paid_at timestamptz) returns void language plpgsql set search_path='' as $$
declare p public.icash_daily_plans;q public.icash_daily_quotes;o public.icash_funding_orders;a uuid;last_budget bigint;
begin
 select * into p from public.icash_daily_plans where id=p_plan for update;
 select * into q from public.icash_daily_quotes where id=p_quote and plan_id=p_plan;
 if p.id is null or q.id is null or p_invoice is null or p_invoice not like 'in_%' or p_payment is null or p_payment not like 'pi_%' or p_tax is null or p_tax<0 or p_amount is null or p_amount<>q.budget_cents+q.fee_cents+p_tax or p_email is null then raise exception 'Daily payment mismatch';end if;
 if (p_cycle_start is null)<>(p_paid_at is null) or (p_cycle_start is not null and (not isfinite(p_cycle_start) or not isfinite(p_paid_at))) then raise exception 'Daily chronology mismatch';end if;
 select * into o from public.icash_funding_orders where stripe_invoice_id=p_invoice for update;
 if found then
  if o.daily_plan_id is distinct from p.id or o.mode is distinct from p.mode or o.state is distinct from 'paid' or o.stripe_payment_id is distinct from p_payment or o.pack_code is distinct from q.pack_code or o.credit_cents is distinct from q.credit_cents or o.charged_total_cents is distinct from p_amount or o.tax_cents is distinct from p_tax or (p.account_id is not null and o.account_id is not null and p.account_id<>o.account_id) or (o.billing_period_start is not null and p_cycle_start is not null and (o.billing_period_start<>p_cycle_start or o.paid_at<>p_paid_at)) then raise exception 'Daily receipt mismatch';end if;
  -- A verified replay can enrich a legacy receipt without posting credit again.
  if o.billing_period_start is null and p_cycle_start is not null then update public.icash_funding_orders set billing_period_start=p_cycle_start,paid_at=p_paid_at where id=o.id;end if;
  a:=coalesce(p.account_id,o.account_id);
 else
  a:=p.account_id;
  if a is null then select account_id into a from public.icash_funding_orders where daily_plan_id=p.id and account_id is not null limit 1;end if;
  insert into public.icash_funding_orders(mode,guest_hash,account_id,pack_code,price_cents,credit_cents,state,stripe_payment_id,payer_email,payer_phone,paid_at,credited_at,run_days,flexible_pacing,pacing_applied_at,processing_fee_cents,tax_required,tax_cents,charged_total_cents,daily_plan_id,stripe_invoice_id,billing_period_start)
  values(p.mode,p.guest_hash,a,q.pack_code,q.budget_cents+q.fee_cents,q.credit_cents,'paid',p_payment,lower(trim(p_email)),p_phone,coalesce(p_paid_at,now()),case when a is not null then now() end,1,false,now(),q.fee_cents,true,p_tax,p_amount,p.id,p_invoice,p_cycle_start);
  if a is not null and p.mode='live' then perform public.icash_post_credit(a,'daily-invoice:'||p_invoice,'purchase',q.credit_cents,p_payment);end if;
 end if;
 if a is not null and p.mode='live' then
  -- Serialize the chronology read with other plans and account refreshes before choosing a limit.
  perform 1 from public.icash_accounts where id=a for update;
  select credit_cents into last_budget from public.icash_funding_orders where account_id=a and daily_plan_id is not null and mode='live' and state='paid' order by billing_period_start desc nulls last,paid_at desc,created_at desc,id desc limit 1;
  if last_budget is not null then update public.icash_accounts set daily_limit_cents=last_budget where id=a;end if;
 end if;
 -- Refund/dispute events can precede a delayed paid-invoice webhook or historical recovery.
 if a is not null then update public.icash_billing_reviews set account_id=a where payment_id=p_payment and account_id is null;end if;
 if exists(select 1 from public.icash_billing_reviews where payment_id=p_payment and resolved_at is null) then
  if a is not null then update public.icash_accounts set bot_paused=true where id=a;end if;
  update public.icash_daily_plans set state=case when state='stopped' then state else 'stop_requested' end where id=p.id;
 end if;
 update public.icash_daily_plans set account_id=a,state=case when state in ('stop_requested','stopped') then state else 'active' end where id=p.id;
end $$;

-- Old callers retain credit idempotency; unknown chronology cannot override a verified cycle.
create or replace function public.icash_settle_daily_invoice(p_plan uuid,p_quote uuid,p_invoice text,p_payment text,p_amount bigint,p_tax bigint,p_email text,p_phone text) returns void language sql set search_path='' as $$
 select public.icash_settle_daily_invoice_v2(p_plan,p_quote,p_invoice,p_payment,p_amount,p_tax,p_email,p_phone,null,null);
$$;

create or replace function public.icash_daily_claim(p_account uuid) returns void language plpgsql set search_path='' as $$
declare last_budget bigint;
begin
 update public.icash_daily_plans p set account_id=p_account where p.account_id is null and exists(select 1 from public.icash_funding_orders o where o.daily_plan_id=p.id and o.account_id=p_account);
 perform 1 from public.icash_accounts where id=p_account for update;
 select credit_cents into last_budget from public.icash_funding_orders where account_id=p_account and daily_plan_id is not null and mode='live' and state='paid' order by billing_period_start desc nulls last,paid_at desc,created_at desc,id desc limit 1;
 if last_budget is not null then update public.icash_accounts set daily_limit_cents=last_budget where id=p_account;end if;
end $$;
revoke all on function public.icash_settle_daily_invoice_v2(uuid,uuid,text,text,bigint,bigint,text,text,timestamptz,timestamptz) from public,anon,authenticated;
grant execute on function public.icash_settle_daily_invoice_v2(uuid,uuid,text,text,bigint,bigint,text,text,timestamptz,timestamptz) to service_role;
commit;
