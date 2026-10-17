begin;
-- Direct Checkout purchases have a signed visitor identity, but no webinar session.
-- Billing writes this binding only after verifying ownership of an open Checkout.
create table public.icash_checkout_measurement (
 checkout_id text not null check(checkout_id ~ '^cs_live_[A-Za-z0-9]{1,240}$'),
 visitor_id uuid not null references public.icash_webinar_visitors(id) on delete cascade,
 created_at timestamptz not null default now(),
 primary key(checkout_id,visitor_id)
);
alter table public.icash_checkout_measurement enable row level security;
revoke all on public.icash_checkout_measurement from public,anon,authenticated;
grant select,insert on public.icash_checkout_measurement to service_role;
alter table public.icash_webinar_meta_events alter column session_id drop not null;

create function public.icash_bind_checkout_measurement(p_checkout text,p_visitor uuid) returns void
language sql security invoker set search_path='' as $$
 insert into public.icash_checkout_measurement(checkout_id,visitor_id) values(p_checkout,p_visitor)
 on conflict do nothing
$$;
revoke all on function public.icash_bind_checkout_measurement(text,uuid) from public,anon,authenticated;
grant execute on function public.icash_bind_checkout_measurement(text,uuid) to service_role;

-- Preserve verified first-payment/VIP rules, privacy timing, and payment-ID deduplication.
-- Prefer the exact Checkout binding; retain started-session attribution for older purchases.
create or replace function public.icash_webinar_meta_purchases()
returns table(payment_id text,value_cents bigint,occurred_at timestamptz,session_id uuid,visitor_id uuid,purchase_kind text)
language sql stable security invoker set search_path='' as $$
 with payments as (
  select i.stripe_payment_id as payment_id,i.amount_cents as value_cents,i.recorded_at as occurred_at,
   m.guest_hash,m.account_id,'membership'::text as purchase_kind,m.stripe_session_id as checkout_id
  from public.icash_membership_invoices i join public.icash_memberships m on m.id=i.membership_id
  where m.mode='live' and i.recorded_at>=now()-interval '37 days'
   -- Check the complete invoice history, including invoices outside this window.
   and not exists(select 1 from public.icash_membership_invoices old where old.membership_id=i.membership_id
    and (old.period_end,old.recorded_at,old.stripe_invoice_id)<(i.period_end,i.recorded_at,i.stripe_invoice_id))
  union all
  -- reconcileVipCheckout verifies this $50 one-time payment before applying it.
  -- Retention, owner tier switches, downgrades and pending payments are excluded.
  select c.payment_id,5000::bigint,c.applied_at,m.guest_hash,c.account_id,'vip_upgrade'::text,c.session_id
  from public.icash_plan_changes c join public.icash_memberships m on m.id=c.membership_id
  where m.mode='live' and c.action='upgrade' and c.state='applied' and c.payment_id is not null
   and c.from_price=5000 and c.to_price=10000 and c.applied_at>=now()-interval '37 days'
 ), verified as (
  select distinct on(p.payment_id) p.* from payments p
  where p.value_cents>0 and not exists(select 1 from public.icash_billing_reviews r where r.payment_id=p.payment_id)
  order by p.payment_id,p.occurred_at
 )
 select p.payment_id,p.value_cents,p.occurred_at,s.id,coalesce(b.visitor_id,s.visitor_id),p.purchase_kind
 from verified p left join lateral (
  select b.visitor_id from public.icash_checkout_measurement b
  where b.checkout_id=p.checkout_id and b.created_at<=p.occurred_at
   and b.created_at>=p.occurred_at-interval '7 days'
  order by b.created_at desc,b.visitor_id limit 1
 ) b on true
 left join lateral (
  select h.id,h.visitor_id from public.icash_webinar_sessions h join public.icash_webinar_visitors v on v.id=h.visitor_id
  where not h.is_preview and h.created_at<=p.occurred_at and h.created_at>=p.occurred_at-interval '7 days'
   and ((b.visitor_id is not null and v.id=b.visitor_id) or (b.visitor_id is null and
    (v.funding_guest_hash=p.guest_hash or (p.account_id is not null and v.account_id=p.account_id))))
   and exists(select 1 from public.icash_webinar_events e where e.session_id=h.id and e.kind='started' and e.created_at<=p.occurred_at)
  order by h.created_at desc,h.id limit 1
 ) s on true
 where coalesce(b.visitor_id,s.visitor_id) is not null
$$;
commit;
