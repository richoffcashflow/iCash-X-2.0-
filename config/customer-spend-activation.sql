begin;
-- First-time activation only. No existing account cap is raised or re-enabled.
-- Records an explicit signed-in customer's review of already-paid credits.
create table public.icash_spend_activation_receipts (
 account_id uuid primary key references public.icash_accounts(id),
 actor_user_id uuid not null,review_key text not null,
 customer_cap_cents bigint not null check(customer_cap_cents between 1 and 100000),
 daily_limit_cents bigint not null check(daily_limit_cents>0),
 consent_version text not null check(consent_version='activation-2026-10-03.1'),
 accepted_at timestamptz not null default now()
);
alter table public.icash_spend_activation_receipts enable row level security;
revoke all on public.icash_spend_activation_receipts from public,anon,authenticated,service_role;
grant select,insert on public.icash_spend_activation_receipts to service_role;

create function public.icash_spend_activation_review(p_user uuid,p_account uuid)
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare a public.icash_accounts;w public.icash_wallets;paid bigint;cap bigint;q jsonb;
begin
 select * into a from public.icash_accounts where id=p_account and owner_user_id=p_user;
 if not found then raise exception 'Account ownership required';end if;
 if exists(select 1 from public.icash_spend_activations where account_id=p_account)
 then return jsonb_build_object('available',false,'reason','existing_activation_preserved');end if;
 if not a.bot_paused or a.daily_limit_cents<=0 then return jsonb_build_object('available',false,'reason','paused_funded_budget_required');end if;
 if not exists(select 1 from public.icash_operating_budget where id=1 and enabled and not require_company_reserve)
 then return jsonb_build_object('available',false,'reason','operating_setup_required');end if;
 if exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
 then return jsonb_build_object('available',false,'reason','billing_review_required');end if;
 -- Prior paid work or holds require operator review; this does not repair old ledgers.
 if exists(select 1 from public.icash_operation_spend where account_id=p_account)
 or exists(select 1 from public.icash_credit_reservations where account_id=p_account)
 then return jsonb_build_object('available',false,'reason','existing_work_requires_review');end if;
 select * into w from public.icash_wallets where account_id=p_account;
 if not found or w.currency<>'USD' or w.balance_cents<=0 or w.reserved_cents<>0
 then return jsonb_build_object('available',false,'reason','unreserved_paid_credits_required');end if;
 select coalesce(sum(credit_cents),0) into paid from public.icash_funding_orders
 where account_id=p_account and mode='live' and state='paid' and credited_at is not null;
 if paid<=0 or w.balance_cents>paid then return jsonb_build_object('available',false,'reason','paid_credit_review_required');end if;
 -- Match every wallet credit to a confirmed purchase. Grants, refunds or prior
 -- usage require a separate review; historical payment totals are not enough.
 if exists(select 1 from public.icash_credit_ledger where account_id=p_account and kind<>'purchase')
 or (select coalesce(sum(delta_cents),0) from public.icash_credit_ledger where account_id=p_account)<>w.balance_cents
 or exists(select 1 from public.icash_credit_ledger l where l.account_id=p_account and not exists(
  select 1 from public.icash_funding_orders o where o.account_id=p_account and o.mode='live' and o.state='paid' and o.credited_at is not null
  and l.delta_cents=o.credit_cents and l.evidence_ref=o.stripe_payment_id
  and (l.event_key='stripe-funding:'||o.id::text or (o.stripe_invoice_id is not null and l.event_key='daily-invoice:'||o.stripe_invoice_id))
 )) then return jsonb_build_object('available',false,'reason','paid_credit_review_required');end if;
 cap:=least(w.balance_cents,paid,100000);
 q:=jsonb_build_object('accountId',p_account,'customerCapCents',cap,'dailyLimitCents',a.daily_limit_cents,
 'balanceCents',w.balance_cents,'paidCreditCents',paid,'consentVersion','activation-2026-10-03.1');
 return q||jsonb_build_object('available',true,'reviewKey',md5(q::text));
end $$;

create function public.icash_confirm_spend_activation(p_user uuid,p_account uuid,p_review_key text,p_consent_version text,p_accepted boolean)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q jsonb;r public.icash_spend_activation_receipts;
begin
 if p_accepted is distinct from true or p_consent_version is distinct from 'activation-2026-10-03.1'
 or p_review_key is null or p_review_key !~ '^[a-f0-9]{32}$' then raise exception 'Explicit current activation acceptance required';end if;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then raise exception 'Account ownership required';end if;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 select * into r from public.icash_spend_activation_receipts where account_id=p_account;
 if found then
  if r.actor_user_id=p_user and r.review_key=p_review_key and exists(select 1 from public.icash_spend_activations x where x.account_id=p_account and x.enabled and x.customer_cap_cents=r.customer_cap_cents)
  then return jsonb_build_object('saved',true,'alreadySaved',true,'started',false);end if;
  raise exception 'Existing activation preserved';
 end if;
 q:=public.icash_spend_activation_review(p_user,p_account);
 if q->>'available' is distinct from 'true' or q->>'reviewKey' is distinct from p_review_key then raise exception 'Activation review changed';end if;
 insert into public.icash_spend_activations(account_id,enabled,customer_cap_cents)
 values(p_account,true,(q->>'customerCapCents')::bigint);
 insert into public.icash_spend_activation_receipts(account_id,actor_user_id,review_key,customer_cap_cents,daily_limit_cents,consent_version)
 values(p_account,p_user,p_review_key,(q->>'customerCapCents')::bigint,(q->>'dailyLimitCents')::bigint,p_consent_version);
 -- Explicit Start is still a separate existing action. No pause, permission,
 -- campaign, provider, funding, wallet, budget, or rate record is changed here.
 return jsonb_build_object('saved',true,'alreadySaved',false,'started',false);
end $$;
revoke all on function public.icash_spend_activation_review(uuid,uuid),public.icash_confirm_spend_activation(uuid,uuid,text,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_spend_activation_review(uuid,uuid),public.icash_confirm_spend_activation(uuid,uuid,text,text,boolean) to service_role;
commit;
