-- Paid VIP is an optional subscription layered over a private Standard grant.
-- Keep the original free membership, balance and work controls intact.
create table public.icash_private_vip_subscriptions (
 id uuid primary key default gen_random_uuid(),
 membership_id uuid not null references public.icash_memberships(id),
 account_id uuid not null references public.icash_accounts(id),
 mode text not null check(mode in ('live','test')),
 state text not null default 'pending' check(state in ('pending','active','past_due','cancelled','expired','needs_review')),
 customer_id text unique, session_id text unique, subscription_id text unique,
 paid_until timestamptz, cancel_at_period_end boolean not null default false,
 created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create unique index icash_private_vip_open on public.icash_private_vip_subscriptions(membership_id) where state not in ('cancelled','expired');
create index icash_private_vip_account on public.icash_private_vip_subscriptions(account_id,created_at desc);
create table public.icash_private_vip_invoices (
 invoice_id text primary key, subscription_id uuid not null references public.icash_private_vip_subscriptions(id),
 payment_id text not null unique, amount_cents bigint not null check(amount_cents=5000),
 period_start timestamptz not null, period_end timestamptz not null,
 created_at timestamptz not null default now(), check(period_end>period_start and period_end<=period_start+interval '32 days')
);
alter table public.icash_private_vip_subscriptions enable row level security;
alter table public.icash_private_vip_invoices enable row level security;
revoke all on public.icash_private_vip_subscriptions,public.icash_private_vip_invoices from public,anon,authenticated;
grant select,insert,update on public.icash_private_vip_subscriptions to service_role;
grant select,insert on public.icash_private_vip_invoices to service_role;
-- VIP's paid expiry can now be projected onto the free grant; its $0 base never changes.
alter table public.icash_memberships drop constraint icash_memberships_price_cents_check;
alter table public.icash_memberships add constraint icash_memberships_price_cents_check check(
 (private_invite_id is null and price_cents between 100 and 100000)
 or (private_invite_id is not null and price_cents=0 and account_id is not null
 and stripe_session_id is null and stripe_subscription_id is null and stripe_customer_id is null
 and checkout_url is null and vip_retained_at is null and retention_requested_at is null)
);
create function public.icash_begin_private_vip(p_membership uuid,p_account uuid,p_mode text)
returns public.icash_private_vip_subscriptions language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships; v public.icash_private_vip_subscriptions;
begin
 select * into m from public.icash_memberships where id=p_membership for update;
 if m.id is null or m.account_id is distinct from p_account or m.mode is distinct from p_mode or m.private_invite_id is null or m.price_cents<>0 or m.state<>'active' or m.paid_through<=now() then raise exception 'Free Standard access required';end if;
 select * into v from public.icash_private_vip_subscriptions where membership_id=m.id and state not in ('cancelled','expired');
 if v.id is not null then return v;end if;
 if m.vip_until>now() then raise exception 'VIP is already active';end if;
 insert into public.icash_private_vip_subscriptions(membership_id,account_id,mode) values(m.id,p_account,p_mode) returning * into v;
 return v;
end $$;
create function public.icash_refresh_private_vip() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 update public.icash_memberships m set vip_until=(select max(v.paid_until) from public.icash_private_vip_subscriptions v
 where v.membership_id=m.id and v.account_id=m.account_id and v.mode=m.mode and v.state in ('active','past_due','cancelled')),updated_at=now()
 where m.id=new.membership_id and m.private_invite_id is not null;
 return new;
end $$;
create trigger icash_private_vip_projection after insert or update on public.icash_private_vip_subscriptions for each row execute function public.icash_refresh_private_vip();
create function public.icash_settle_private_vip(p_id uuid,p_subscription text,p_customer text,p_invoice text,p_payment text,p_start timestamptz,p_end timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare v public.icash_private_vip_subscriptions; prior public.icash_private_vip_invoices;
begin
 select * into strict v from public.icash_private_vip_subscriptions where id=p_id for update;
 if v.subscription_id is distinct from p_subscription or v.customer_id is distinct from p_customer
 or p_invoice is null or p_invoice !~ '^in_[A-Za-z0-9]+$' or p_payment is null or p_payment !~ '^pi_[A-Za-z0-9]+$'
 or p_start is null or p_end is null or p_end<=p_start or p_end>p_start+interval '32 days' or p_start>now()+interval '5 minutes'
 then raise exception 'VIP invoice binding mismatch';end if;
 if not exists(select 1 from public.icash_purchase_acceptances where kind='vip' and reference_id=v.id and account_id=v.account_id and mode=v.mode and version='private-vip-50-monthly-v1' and amount_cents=5000) then raise exception 'VIP acceptance missing';end if;
 select * into prior from public.icash_private_vip_invoices where invoice_id=p_invoice;
 if prior.invoice_id is not null then
 if prior.subscription_id<>v.id or prior.payment_id<>p_payment or prior.period_start<>p_start or prior.period_end<>p_end then raise exception 'VIP invoice changed';end if;return;end if;
 if v.state in ('expired','needs_review') then raise exception 'VIP payment requires review';end if;
 insert into public.icash_private_vip_invoices values(p_invoice,v.id,p_payment,5000,p_start,p_end,now());
 update public.icash_private_vip_subscriptions set paid_until=greatest(paid_until,p_end),
 state=case when exists(select 1 from public.icash_billing_reviews where payment_id=p_payment and resolved_at is null) then 'needs_review' else state end,updated_at=now() where id=v.id;
end $$;
-- Include the optional subscription in immutable acceptance binding without changing ordinary upgrades.
do $$ declare definition text; needle text:='elsif p_kind=''daily'' then';begin
 definition:=pg_get_functiondef('public.icash_record_purchase_acceptance(text,uuid,text,uuid,text,text,text,bigint,text,text,jsonb)'::regprocedure);
 if position(needle in definition)=0 then raise exception 'Purchase acceptance definition changed';end if;
 definition:=replace(definition,needle,$patch$
 if matched is distinct from true then
 select true into matched from public.icash_private_vip_subscriptions v join public.icash_memberships m on m.id=v.membership_id
 where v.id=p_reference and v.state='pending' and v.mode=p_mode and v.account_id=p_account and m.guest_hash=p_guest
 and m.private_invite_id is not null and p_amount=5000 and p_version='private-vip-50-monthly-v1' for share of v;
 end if;
 elsif p_kind='daily' then
 $patch$);execute definition;
end $$;
create function public.icash_flag_private_vip_issue(p_payment text) returns void language sql security invoker set search_path='' as $$
 update public.icash_private_vip_subscriptions set state='needs_review',updated_at=now()
 where id in (select subscription_id from public.icash_private_vip_invoices where payment_id=p_payment);
$$;
revoke all on function public.icash_begin_private_vip(uuid,uuid,text),public.icash_refresh_private_vip(),public.icash_settle_private_vip(uuid,text,text,text,text,timestamptz,timestamptz),public.icash_flag_private_vip_issue(text) from public,anon,authenticated;
grant execute on function public.icash_begin_private_vip(uuid,uuid,text),public.icash_refresh_private_vip(),public.icash_settle_private_vip(uuid,text,text,text,text,timestamptz,timestamptz),public.icash_flag_private_vip_issue(text) to service_role;
