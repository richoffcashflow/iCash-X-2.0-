begin;
alter table public.icash_funding_orders add column auto_recharge boolean not null default false;
create table public.icash_auto_recharges (
 account_id uuid not null references public.icash_accounts(id),mode text not null check(mode in ('live','test')),
 enabled boolean not null default false,pending_order uuid references public.icash_funding_orders(id),approved_order uuid references public.icash_funding_orders(id),
 amount_cents bigint check(amount_cents between 1000 and 100000),stripe_customer_id text,stripe_payment_method_id text,
 last_attempt_at timestamptz,issue text,updated_at timestamptz not null default now(),primary key(account_id,mode)
);
create table public.icash_auto_recharge_attempts (
 id uuid primary key default gen_random_uuid(),account_id uuid not null,mode text not null,
 order_id uuid not null unique references public.icash_funding_orders(id),approved_order uuid not null references public.icash_funding_orders(id),
 amount_cents bigint not null,stripe_customer_id text not null,stripe_payment_method_id text not null,
 stripe_payment_id text unique,state text not null default 'pending' check(state in ('pending','paid','failed','cancelled')),
 lease_until timestamptz,created_at timestamptz not null default now(),foreign key(account_id,mode) references public.icash_auto_recharges(account_id,mode)
);
create unique index icash_auto_recharge_pending on public.icash_auto_recharge_attempts(account_id,mode) where state='pending';
create index icash_auto_recharge_candidates on public.icash_auto_recharges(mode,last_attempt_at) where enabled;
create index icash_auto_recharge_recovery on public.icash_auto_recharge_attempts(mode,created_at) where state='pending';
alter table public.icash_auto_recharges enable row level security;
alter table public.icash_auto_recharge_attempts enable row level security;
revoke all on public.icash_auto_recharges,public.icash_auto_recharge_attempts from public,anon,authenticated;
grant all on public.icash_auto_recharges,public.icash_auto_recharge_attempts to service_role;

create function public.icash_prepare_auto_recharge(p_order uuid) returns void language plpgsql set search_path='' as $$
declare o public.icash_funding_orders;
begin
 select * into strict o from public.icash_funding_orders where id=p_order;
 if not o.auto_recharge or o.account_id is null or o.state<>'pending' then raise exception 'Invalid auto recharge setup';end if;
 insert into public.icash_auto_recharges(account_id,mode,pending_order) values(o.account_id,o.mode,o.id)
 on conflict(account_id,mode) do update set pending_order=excluded.pending_order,updated_at=now();
end $$;
create function public.icash_activate_auto_recharge(p_order uuid,p_customer text,p_method text) returns void language plpgsql set search_path='' as $$
declare o public.icash_funding_orders;
begin
 select * into strict o from public.icash_funding_orders where id=p_order;
 if not o.auto_recharge or o.state<>'paid' or o.credited_at is null or p_customer !~ '^cus_[A-Za-z0-9]+$' or p_method !~ '^pm_[A-Za-z0-9]+$'
 or not exists(select 1 from public.icash_funding_consents where order_id=o.id and version='work-credits-2026-10-06.1:recharge-2026-10-06.1' and price_cents=o.price_cents and account_id=o.account_id)
 then raise exception 'Unverified auto recharge authorization';end if;
 update public.icash_auto_recharges set enabled=true,approved_order=o.id,pending_order=null,amount_cents=o.price_cents,stripe_customer_id=p_customer,stripe_payment_method_id=p_method,issue=null,updated_at=now()
 where account_id=o.account_id and mode=o.mode and pending_order=o.id;
end $$;
create function public.icash_due_auto_recharges(p_mode text) returns table(account_id uuid) language sql stable set search_path='' as $$
 select candidates.account_id from (
  select t.account_id,t.created_at as due from public.icash_auto_recharge_attempts t where t.mode=p_mode and t.state='pending' and (t.lease_until is null or t.lease_until<=now())
  union
  select r.account_id,coalesce(r.last_attempt_at,'epoch'::timestamptz) from public.icash_auto_recharges r join public.icash_wallets w on w.account_id=r.account_id join public.icash_accounts a on a.id=r.account_id
  where r.mode=p_mode and r.enabled and not a.bot_paused and w.balance_cents-w.reserved_cents<500 and (r.last_attempt_at is null or r.last_attempt_at<=now()-interval '24 hours')
  and public.icash_membership_work_allowed(a.id) and not exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null)
 ) candidates order by due limit 20;
$$;
revoke all on function public.icash_due_auto_recharges(text) from public,anon,authenticated;
grant execute on function public.icash_due_auto_recharges(text) to service_role;
create function public.icash_claim_auto_recharge(p_account uuid,p_mode text) returns jsonb language plpgsql set search_path='' as $$
declare r public.icash_auto_recharges;t public.icash_auto_recharge_attempts;o public.icash_funding_orders;oid uuid:=gen_random_uuid();available bigint;
begin
 select * into r from public.icash_auto_recharges where account_id=p_account and mode=p_mode for update;
 if not found then return null;end if;
 select * into t from public.icash_auto_recharge_attempts where account_id=p_account and mode=p_mode and state='pending' for update;
 if found then
  if t.lease_until>now() then return null;end if;
  update public.icash_auto_recharge_attempts set lease_until=now()+interval '3 minutes' where id=t.id;
  return to_jsonb(t);
 end if;
 if not r.enabled or r.approved_order is null or r.last_attempt_at>now()-interval '24 hours'
 or not public.icash_membership_work_allowed(p_account)
 or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused)
 or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
 or exists(select 1 from public.icash_daily_plans where account_id=p_account and mode=p_mode and state<>'stopped') then return null;end if;
 select case when p_mode='live' then balance_cents-reserved_cents else 100000 end into available from public.icash_wallets where account_id=p_account;
 if available is null or available>=500 then return null;end if;
 select * into strict o from public.icash_funding_orders where id=r.approved_order and state='paid';
 insert into public.icash_funding_orders(id,mode,guest_hash,account_id,pack_code,price_cents,credit_cents,run_days,flexible_pacing)
 values(oid,p_mode,repeat(md5(oid::text),2),p_account,o.pack_code,r.amount_cents,r.amount_cents,1,true);
 insert into public.icash_auto_recharge_attempts(account_id,mode,order_id,approved_order,amount_cents,stripe_customer_id,stripe_payment_method_id,lease_until)
 values(p_account,p_mode,oid,r.approved_order,r.amount_cents,r.stripe_customer_id,r.stripe_payment_method_id,now()+interval '3 minutes') returning * into t;
 update public.icash_auto_recharges set last_attempt_at=now() where account_id=p_account and mode=p_mode;
 return to_jsonb(t);
end $$;
create function public.icash_auto_recharge_allowed(p_attempt uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_auto_recharge_attempts t join public.icash_auto_recharges r using(account_id,mode) join public.icash_accounts a on a.id=t.account_id
 where t.id=p_attempt and t.state='pending' and r.enabled and r.approved_order=t.approved_order and not a.bot_paused and public.icash_membership_work_allowed(a.id)
 and not exists(select 1 from public.icash_billing_reviews where account_id=a.id and resolved_at is null)
 and not exists(select 1 from public.icash_daily_plans where account_id=a.id and mode=t.mode and state<>'stopped'));
$$;
create function public.icash_settle_auto_recharge(p_attempt uuid,p_payment text,p_amount bigint,p_customer text,p_method text,p_mode text) returns void language plpgsql set search_path='' as $$
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
end $$;
revoke all on function public.icash_prepare_auto_recharge(uuid),public.icash_activate_auto_recharge(uuid,text,text),public.icash_claim_auto_recharge(uuid,text),public.icash_auto_recharge_allowed(uuid),public.icash_settle_auto_recharge(uuid,text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_prepare_auto_recharge(uuid),public.icash_activate_auto_recharge(uuid,text,text),public.icash_claim_auto_recharge(uuid,text),public.icash_auto_recharge_allowed(uuid),public.icash_settle_auto_recharge(uuid,text,bigint,text,text,text) to service_role;
do $$ declare def text;needle text;begin
 def:=pg_get_functiondef('public.icash_apply_prepaid_purchase(uuid)'::regprocedure);
 needle:='c.version in (''work-credits-2026-10-03.1'',''work-credits-2026-10-05.1'')';
 if position(needle in def)=0 then raise exception 'Prepaid authorization definition changed';end if;
 execute replace(def,needle,'c.version in (''work-credits-2026-10-03.1'',''work-credits-2026-10-05.1'',''work-credits-2026-10-06.1'',''work-credits-2026-10-06.1:recharge-2026-10-06.1'')');
 def:=pg_get_functiondef('public.icash_load_workspace_account(uuid,text)'::regprocedure);
 needle:='''reservedCents'',case';
 if position(needle in def)=0 then raise exception 'Account snapshot definition changed';end if;
 execute replace(def,needle,'''hasCreditHistory'',coalesce((totals->>''creditCents'')::bigint,0)>0 or (p_mode=''live'' and (wallet.balance_cents>0 or exists(select 1 from public.icash_credit_ledger l where l.account_id=a.id and l.delta_cents>0))), '||needle);
end $$;
commit;
