-- Read-only production function baseline captured before the 2026-10-10 dispute migration.
CREATE OR REPLACE FUNCTION public.icash_activate_auto_recharge(p_order uuid, p_customer text, p_method text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.icash_funding_orders;
begin
 select * into strict o from public.icash_funding_orders where id=p_order;
 if not o.auto_recharge or o.state<>'paid' or o.credited_at is null or p_customer !~ '^cus_[A-Za-z0-9]+$' or p_method !~ '^pm_[A-Za-z0-9]+$'
 or not exists(select 1 from public.icash_funding_consents where order_id=o.id and version='work-credits-2026-10-06.1:recharge-2026-10-06.1' and price_cents=o.price_cents and account_id=o.account_id)
 then raise exception 'Unverified auto recharge authorization';end if;
 update public.icash_auto_recharges set enabled=true,approved_order=o.id,pending_order=null,amount_cents=o.price_cents,stripe_customer_id=p_customer,stripe_payment_method_id=p_method,issue=null,updated_at=now()
 where account_id=o.account_id and mode=o.mode and pending_order=o.id;
end $function$;

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
 select coalesce(sum(credit_cents),0)+public.icash_authorized_grant_cents(a.id) into funded from public.icash_funding_orders where account_id=a.id and mode='live' and state='paid' and credited_at is not null;
 if funded<=0 or funded>100000000 then return false;end if;
 insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents) values(a.id,true,funded)
 on conflict(account_id) do update set enabled=true,customer_cap_cents=excluded.customer_cap_cents;
 update public.icash_accounts set billing_model=case when billing_model='legacy' then 'prepaid' else billing_model end,daily_limit_cents=(select reserved_cents+public.icash_credit_work_pace(greatest(0,balance_cents-reserved_cents))+coalesce((select sum(-delta_cents) from public.icash_credit_ledger where account_id=a.id and kind='usage' and created_at>now()-interval '24 hours'),0) from public.icash_wallets where account_id=a.id),bot_paused=false where id=a.id;
 update public.icash_funding_orders set prepaid_applied_at=now(),pacing_applied_at=now() where id=o.id;
 -- Provider/channel, identity, contact, cost, offer and contract authority checks still run at dispatch.
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_begin_membership(p_guest text, p_account uuid, p_mode text, p_price bigint, p_revision integer, p_terms text)
 RETURNS icash_memberships
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 values(p_guest,p_account,p_mode,p_price,p_revision,'membership-2026-10-06.1',p_terms) returning * into m;
 return m;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_credit_acquisition_allowed(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
 join public.icash_spend_activations sa on sa.account_id=a.id and sa.enabled
 where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents
 and public.icash_membership_work_allowed(a.id)
 and not exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null)
 and (a.billing_model in ('prepaid','membership_credits') or (a.billing_model='daily' and exists(select 1 from public.icash_daily_plans p where p.account_id=a.id and p.state='active' and p.mode='live' and p.consent_version like 'daily-2026-10-04.1%'))))
$function$;

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
 select coalesce(sum(credit_cents),0)+public.icash_authorized_grant_cents(p_account) into funded from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null;
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
