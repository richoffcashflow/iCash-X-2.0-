begin;
create table public.icash_membership_offer (
 id integer primary key check(id=1),price_cents bigint not null check(price_cents between 100 and 100000),
 revision integer not null default 1 check(revision>0),enabled boolean not null default true,updated_by uuid,updated_at timestamptz not null default now()
);
insert into public.icash_membership_offer(id,price_cents) values(1,5000);
create table public.icash_memberships (
 id uuid primary key default gen_random_uuid(),mode text not null check(mode in ('test','live')),guest_hash text not null check(length(guest_hash)=64),
 account_id uuid references public.icash_accounts(id),price_cents bigint not null check(price_cents between 100 and 100000),offer_revision integer not null,
 state text not null default 'pending' check(state in ('pending','active','payment_failed','cancelled','needs_review')),
 stripe_session_id text unique,stripe_subscription_id text unique,stripe_customer_id text,checkout_url text,payer_email text,payer_phone text,
 paid_through timestamptz,cancel_at_period_end boolean not null default false,consent_version text not null,consent_text text not null,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create unique index icash_membership_guest on public.icash_memberships(guest_hash,mode) where state<>'cancelled';
create unique index icash_membership_account on public.icash_memberships(account_id,mode) where state<>'cancelled';
create index icash_membership_email on public.icash_memberships(lower(payer_email),mode);
create table public.icash_membership_invoices (
 stripe_invoice_id text primary key,membership_id uuid not null references public.icash_memberships(id),stripe_payment_id text not null unique,
 amount_cents bigint not null check(amount_cents>0),period_end timestamptz not null,recorded_at timestamptz not null default now()
);
create index icash_membership_invoice_member on public.icash_membership_invoices(membership_id);
alter table public.icash_membership_offer enable row level security;
alter table public.icash_memberships enable row level security;
alter table public.icash_membership_invoices enable row level security;
revoke all on public.icash_membership_offer,public.icash_memberships,public.icash_membership_invoices from public,anon,authenticated;
grant select,insert,update on public.icash_membership_offer,public.icash_memberships,public.icash_membership_invoices to service_role;
alter table public.icash_accounts add column billing_model text not null default 'legacy' check(billing_model in ('legacy','prepaid','membership_credits'));
alter table public.icash_funding_orders add column prepaid_applied_at timestamptz;

create function public.icash_begin_membership(p_guest text,p_account uuid,p_mode text,p_price bigint,p_revision integer,p_terms text) returns public.icash_memberships language plpgsql security invoker set search_path='' as $$
declare offer public.icash_membership_offer;m public.icash_memberships;
begin
 if p_mode is null or p_guest is null or p_terms is null or p_price is null or p_revision is null or p_mode not in ('test','live') or p_guest !~ '^[a-f0-9]{64}$' or length(p_terms) not between 20 and 4000 then raise exception 'Invalid membership';end if;
 select * into offer from public.icash_membership_offer where id=1 for share;
 if offer.id is null or not offer.enabled or offer.price_cents<>p_price or offer.revision<>p_revision then raise exception 'Price changed';end if;
 perform pg_advisory_xact_lock(hashtextextended(p_guest||':'||p_mode,612));
 if p_account is not null then
 perform 1 from public.icash_accounts where id=p_account for update;if not found then raise exception 'Account missing';end if;
 if exists(select 1 from public.icash_daily_plans where account_id=p_account and mode=p_mode and state<>'stopped') then raise exception 'Stop legacy daily billing first';end if;
 select * into m from public.icash_memberships where account_id=p_account and mode=p_mode and state<>'cancelled';
 end if;
 if m.id is null then select * into m from public.icash_memberships where guest_hash=p_guest and mode=p_mode and state<>'cancelled';end if;
 if m.id is not null then
 if m.state<>'pending' or m.account_id is distinct from p_account or m.price_cents<>p_price or m.offer_revision<>p_revision then raise exception 'Membership already exists or price changed';end if;
 return m;end if;
 insert into public.icash_memberships(guest_hash,account_id,mode,price_cents,offer_revision,consent_version,consent_text)
 values(p_guest,p_account,p_mode,p_price,p_revision,'membership-2026-10-03.1',p_terms) returning * into m;
 return m;
end $$;
create function public.icash_settle_membership_invoice(p_membership uuid,p_subscription text,p_customer text,p_invoice text,p_payment text,p_amount bigint,p_email text,p_phone text,p_period_end timestamptz) returns void language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;i public.icash_membership_invoices;
begin
 select * into m from public.icash_memberships where id=p_membership for update;
 if p_subscription is null or p_customer is null or p_invoice is null or p_payment is null or m.id is null or p_amount is distinct from m.price_cents or p_subscription !~ '^sub_[A-Za-z0-9]+$' or p_customer !~ '^cus_[A-Za-z0-9]+$' or p_invoice !~ '^in_[A-Za-z0-9]+$' or p_payment !~ '^pi_[A-Za-z0-9]+$' or p_period_end is null or p_email is null or position('@' in p_email)<2 or length(p_email)>320
 or (m.stripe_subscription_id is not null and m.stripe_subscription_id<>p_subscription) or (m.stripe_customer_id is not null and m.stripe_customer_id<>p_customer) then raise exception 'Membership invoice mismatch';end if;
 select * into i from public.icash_membership_invoices where stripe_invoice_id=p_invoice;
 if found then if i.membership_id<>m.id or i.stripe_payment_id<>p_payment or i.amount_cents<>p_amount or i.period_end<>p_period_end then raise exception 'Invoice replay mismatch';end if;return;end if;
 insert into public.icash_membership_invoices(stripe_invoice_id,membership_id,stripe_payment_id,amount_cents,period_end) values(p_invoice,m.id,p_payment,p_amount,p_period_end);
 update public.icash_memberships set stripe_subscription_id=p_subscription,stripe_customer_id=p_customer,payer_email=lower(trim(p_email)),payer_phone=left(p_phone,40),paid_through=greatest(paid_through,p_period_end),updated_at=now() where id=m.id;
 if exists(select 1 from public.icash_billing_reviews where payment_id=p_payment and resolved_at is null) then
 update public.icash_memberships set state='needs_review' where id=m.id;
 update public.icash_accounts set bot_paused=true where id=m.account_id;
 end if;
 -- Software payments never post to the work-credit wallet.
end $$;
create function public.icash_membership_work_allowed(p_account uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_accounts a where a.id=p_account and (a.billing_model<>'membership_credits' or exists(select 1 from public.icash_memberships m where m.account_id=a.id and m.mode='live' and m.state='active' and m.paid_through>now())))
$$;

CREATE OR REPLACE FUNCTION public.icash_claim_funding(p_user uuid, p_mode text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare email_address text; a uuid; o public.icash_funding_orders; created_account boolean:=false;
begin
 if p_mode is null or p_mode not in ('test','live') then raise exception 'Invalid mode'; end if;
 select lower(email) into email_address from auth.users where id=p_user and email_confirmed_at is not null;
 if email_address is null then raise exception 'Verified email required'; end if;
 -- Serialize claims across devices; email is read from Auth, never supplied by the client.
 perform pg_advisory_xact_lock(hashtextextended(p_user::text,0));
 select id into a from public.icash_accounts where owner_user_id=p_user;
 if a is null and not exists(select 1 from public.icash_funding_orders where lower(payer_email)=email_address and mode=p_mode and state='paid') and not exists(select 1 from public.icash_memberships where lower(payer_email)=email_address and mode=p_mode and state='active' and paid_through>now()) then
  raise exception 'Fund account first';
 end if;
 if a is null then a:=public.icash_create_account(p_user);created_account:=true;end if;
 for o in select * from public.icash_funding_orders where lower(payer_email)=email_address and mode=p_mode and state='paid' and credited_at is null order by id for update loop
  if o.account_id is not null and o.account_id<>a then raise exception 'Account mismatch'; end if;
  if p_mode='live' then perform public.icash_post_credit(a,'stripe-funding:'||o.id,'purchase',o.credit_cents,o.stripe_payment_id); end if;
  update public.icash_funding_orders set account_id=a,credited_at=now() where id=o.id;
 end loop;
 -- A refund/dispute arriving before account claim must still stop subsequent work.
 update public.icash_billing_reviews r set account_id=a from public.icash_funding_orders f
 where r.payment_id=f.stripe_payment_id and f.account_id=a and r.account_id is null;
 if exists(select 1 from public.icash_billing_reviews where account_id=a and resolved_at is null) then
  update public.icash_accounts set bot_paused=true where id=a;
 end if;
 -- Bind software access only after the payment email has been verified through Auth.
 update public.icash_memberships set account_id=a where lower(payer_email)=email_address and mode=p_mode and account_id is null and paid_through is not null;
 update public.icash_billing_reviews r set account_id=a from public.icash_membership_invoices i join public.icash_memberships m on m.id=i.membership_id where r.payment_id=i.stripe_payment_id and m.account_id=a and r.account_id is null;
 if exists(select 1 from public.icash_billing_reviews where account_id=a and resolved_at is null) then update public.icash_accounts set bot_paused=true where id=a;end if;
 if exists(select 1 from public.icash_memberships where account_id=a and mode=p_mode and paid_through is not null) then
 if p_mode='live' or created_account then update public.icash_accounts set billing_model='membership_credits' where id=a;end if;
 if not exists(select 1 from public.icash_bot_setups where account_id=a) then
 update public.icash_bot_setups set account_id=a where id=(select s.id from public.icash_bot_setups s join public.icash_memberships m on m.guest_hash=s.guest_hash where m.account_id=a and m.mode=p_mode and s.account_id is null order by m.created_at desc limit 1);
 end if;
 end if;
 return a;
end $function$
;

-- A prepaid purchase authorizes only the credits actually paid for, exactly once.
alter table public.icash_spend_activations drop constraint icash_spend_activations_customer_cap_cents_check;
alter table public.icash_spend_activations add constraint icash_spend_activations_customer_cap_cents_check check(customer_cap_cents between 1 and 100000000);
create function public.icash_apply_prepaid_purchase(p_order uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare o public.icash_funding_orders;funded bigint;a public.icash_accounts;
begin
 select * into o from public.icash_funding_orders where id=p_order for update;
 if not found or o.mode<>'live' or o.state<>'paid' or o.account_id is null or o.credited_at is null then return false;end if;
 if o.prepaid_applied_at is not null then return true;end if;
 if not exists(select 1 from public.icash_funding_consents c where c.order_id=o.id and c.version='work-credits-2026-10-03.1' and c.account_id=o.account_id and c.price_cents=o.price_cents and c.credit_cents=o.credit_cents) then return false;end if;
 select * into a from public.icash_accounts where id=o.account_id for update;
 if exists(select 1 from public.icash_daily_plans where account_id=a.id and mode='live' and state<>'stopped') then return false;end if;
 if exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null) or not public.icash_membership_work_allowed(a.id) then return false;end if;
 perform 1 from public.icash_wallets where account_id=a.id for update;
 select coalesce(sum(credit_cents),0) into funded from public.icash_funding_orders where account_id=a.id and mode='live' and state='paid' and credited_at is not null;
 if funded<=0 or funded>100000000 then return false;end if;
 insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents) values(a.id,true,funded)
 on conflict(account_id) do update set enabled=true,customer_cap_cents=excluded.customer_cap_cents;
 update public.icash_accounts set billing_model=case when billing_model='legacy' then 'prepaid' else billing_model end,daily_limit_cents=funded,bot_paused=false where id=a.id;
 update public.icash_funding_orders set prepaid_applied_at=now(),pacing_applied_at=now() where id=o.id;
 -- Provider/channel, identity, contact, cost, offer and contract authority checks still run at dispatch.
 return true;
end $$;
-- Preserve existing reservation, wallet, permission, idempotency and cost gates.
alter function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) rename to icash_reserve_before_membership;
create function public.icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 if not public.icash_membership_work_allowed(p_account) then raise exception 'Software membership is inactive';end if;
 return public.icash_reserve_before_membership(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
end $$;
alter function public.icash_claim_operation(text) rename to icash_claim_before_membership;
create function public.icash_claim_operation(p_operation text) returns boolean language plpgsql security invoker set search_path='' as $$
declare a uuid;
begin
 select account_id into a from public.icash_operation_spend where operation_key=p_operation;
 if not public.icash_membership_work_allowed(a) then return false;end if;
 return public.icash_claim_before_membership(p_operation);
end $$;
create function public.icash_flag_membership_issue(p_payment text) returns void language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_memberships set state='needs_review',updated_at=now() where id in (select membership_id from public.icash_membership_invoices where stripe_payment_id=p_payment);
 update public.icash_accounts set bot_paused=true where id in (select m.account_id from public.icash_memberships m join public.icash_membership_invoices i on i.membership_id=m.id where i.stripe_payment_id=p_payment);
end $$;
revoke all on function public.icash_begin_membership(text,uuid,text,bigint,integer,text),public.icash_settle_membership_invoice(uuid,text,text,text,text,bigint,text,text,timestamptz),public.icash_membership_work_allowed(uuid),public.icash_apply_prepaid_purchase(uuid),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_claim_operation(text),public.icash_flag_membership_issue(text) from public,anon,authenticated;
grant execute on function public.icash_begin_membership(text,uuid,text,bigint,integer,text),public.icash_settle_membership_invoice(uuid,text,text,text,text,bigint,text,text,timestamptz),public.icash_membership_work_allowed(uuid),public.icash_apply_prepaid_purchase(uuid),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_claim_operation(text),public.icash_flag_membership_issue(text) to service_role;
CREATE OR REPLACE FUNCTION public.icash_daily_claim(p_account uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare last_budget bigint;
begin
 if exists(select 1 from public.icash_accounts where id=p_account and billing_model<>'legacy') then return;end if;
 update public.icash_daily_plans p set account_id=p_account where p.account_id is null and exists(select 1 from public.icash_funding_orders o where o.daily_plan_id=p.id and o.account_id=p_account);
 perform 1 from public.icash_accounts where id=p_account for update;
 select credit_cents into last_budget from public.icash_funding_orders where account_id=p_account and daily_plan_id is not null and mode='live' and state='paid' order by billing_period_start desc nulls last,paid_at desc,created_at desc,id desc limit 1;
 if last_budget is not null then update public.icash_accounts set daily_limit_cents=last_budget where id=p_account;end if;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_reserve_credit(p_account uuid, p_operation text, p_amount bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.icash_wallets; r public.icash_credit_reservations; a public.icash_accounts; used bigint; result uuid;
begin
 if p_operation is null or trim(p_operation)='' or p_amount is null or p_amount<=0 then raise exception 'Invalid reservation'; end if;
 select * into a from public.icash_accounts where id=p_account for update;
 if not found then raise exception 'Account missing'; end if;
 if not public.icash_membership_work_allowed(p_account) then raise exception 'Software membership is inactive';end if;
 select * into w from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where operation_key=p_operation;
 if found then
  if r.account_id<>p_account or r.amount_cents<>p_amount then raise exception 'Idempotency conflict'; end if;
  if r.status<>'reserved' then raise exception 'Operation already resolved'; end if;
  if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) then raise exception 'Bot paused'; end if;
  return r.id;
 end if;
 if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) then raise exception 'Bot paused'; end if;
 if w.balance_cents-w.reserved_cents<p_amount then raise exception 'Insufficient credits'; end if;
 -- Rolling 24-hour consumption plus ALL outstanding reservations, including older work.
 select coalesce(sum(-delta_cents),0) into used from public.icash_credit_ledger
 where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours';
 if used+w.reserved_cents+p_amount>a.daily_limit_cents then raise exception 'Daily budget reached'; end if;
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents)
 values(p_account,p_operation,p_amount) returning id into result;
 update public.icash_wallets set reserved_cents=reserved_cents+p_amount where account_id=p_account;
 return result;
end; $function$
;

commit;
