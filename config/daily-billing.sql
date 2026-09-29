create table public.icash_daily_plans(
 id uuid primary key default gen_random_uuid(), mode text not null check(mode in ('test','live')),guest_hash text not null,
 account_id uuid references public.icash_accounts(id),stripe_subscription_id text unique,stripe_session_id text unique,
 state text not null default 'pending' check(state in ('pending','active','payment_failed','stop_requested','stopped')),
 reconciled_at timestamptz,checkout_url text,consent_version text not null,consent_text text not null,created_at timestamptz not null default now()
);
create unique index icash_daily_one_guest on public.icash_daily_plans(guest_hash,mode) where state<>'stopped';
create unique index icash_daily_one_account on public.icash_daily_plans(account_id,mode) where state<>'stopped';
create table public.icash_daily_quotes(
 id uuid primary key default gen_random_uuid(),plan_id uuid not null references public.icash_daily_plans(id),
 pack_code text not null references public.icash_credit_packs(code),budget_cents bigint not null check(budget_cents between 1000 and 100000),
 credit_cents bigint not null check(credit_cents>0),fee_cents bigint not null check(fee_cents>=0),
 budget_price text unique,fee_price text unique,created_at timestamptz not null default now(),consent_text text not null
);
alter table public.icash_funding_orders add column if not exists daily_plan_id uuid references public.icash_daily_plans(id),add column if not exists stripe_invoice_id text unique;
create function public.icash_settle_daily_invoice(p_plan uuid,p_quote uuid,p_invoice text,p_payment text,p_amount bigint,p_tax bigint,p_email text,p_phone text) returns void language plpgsql set search_path='' as $$
declare p public.icash_daily_plans;q public.icash_daily_quotes; a uuid;
begin
 select * into p from public.icash_daily_plans where id=p_plan for update;
 select * into q from public.icash_daily_quotes where id=p_quote and plan_id=p_plan;
 if p.id is null or q.id is null or p_invoice not like 'in_%' or p_payment not like 'pi_%' or p_tax is null or p_tax<0 or p_amount is null or p_amount<>q.budget_cents+q.fee_cents+p_tax or p_email is null then raise exception 'Daily payment mismatch'; end if;
 if exists(select 1 from public.icash_funding_orders where stripe_invoice_id=p_invoice) then return;end if;
 a:=p.account_id;
 if a is null then select account_id into a from public.icash_funding_orders where daily_plan_id=p.id and account_id is not null limit 1;end if;
 insert into public.icash_funding_orders(mode,guest_hash,account_id,pack_code,price_cents,credit_cents,state,stripe_payment_id,payer_email,payer_phone,paid_at,credited_at,run_days,flexible_pacing,pacing_applied_at,processing_fee_cents,tax_required,tax_cents,charged_total_cents,daily_plan_id,stripe_invoice_id)
 values(p.mode,p.guest_hash,a,q.pack_code,q.budget_cents+q.fee_cents,q.credit_cents,'paid',p_payment,lower(trim(p_email)),p_phone,now(),case when a is not null then now() end,1,false,now(),q.fee_cents,true,p_tax,p_amount,p.id,p_invoice);
 if a is not null and p.mode='live' then
 perform public.icash_post_credit(a,'daily-invoice:'||p_invoice,'purchase',q.credit_cents,p_payment);
 update public.icash_accounts set daily_limit_cents=q.credit_cents where id=a;
 end if;
 update public.icash_daily_plans set account_id=a,state=case when state in ('stop_requested','stopped') then state else 'active' end where id=p.id;
end $$;
create function public.icash_daily_claim(p_account uuid) returns void language plpgsql set search_path='' as $$
begin
 update public.icash_daily_plans p set account_id=p_account where p.account_id is null and exists(select 1 from public.icash_funding_orders o where o.daily_plan_id=p.id and o.account_id=p_account);
end $$;
alter table public.icash_daily_plans enable row level security;
alter table public.icash_daily_quotes enable row level security;
revoke all on public.icash_daily_plans,public.icash_daily_quotes from public,anon,authenticated;
grant all on public.icash_daily_plans,public.icash_daily_quotes to service_role;
revoke all on function public.icash_settle_daily_invoice(uuid,uuid,text,text,bigint,bigint,text,text),public.icash_daily_claim(uuid) from public,anon,authenticated;
grant execute on function public.icash_settle_daily_invoice(uuid,uuid,text,text,bigint,bigint,text,text),public.icash_daily_claim(uuid) to service_role;

-- 6x buffered all-in cost target: $300 usage allows at most $49.98 cost.
update public.icash_operating_budget set minimum_margin_bps=8334 where id=1;
