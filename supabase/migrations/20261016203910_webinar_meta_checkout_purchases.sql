begin;
-- Acquisition conversions are separate from the broader internal revenue report.
-- A renewal or prepaid credit recharge must not look like a new webinar sale.
alter table public.icash_webinar_meta_events add column purchase_kind text
 check(purchase_kind in ('membership','vip_upgrade'));

create function public.icash_webinar_meta_purchases()
returns table(payment_id text,value_cents bigint,occurred_at timestamptz,session_id uuid,visitor_id uuid,purchase_kind text)
language sql stable security invoker set search_path='' as $$
 with payments as (
  select i.stripe_payment_id as payment_id,i.amount_cents as value_cents,i.recorded_at as occurred_at,
   m.guest_hash,m.account_id,'membership'::text as purchase_kind
  from public.icash_membership_invoices i join public.icash_memberships m on m.id=i.membership_id
  where m.mode='live' and i.recorded_at>=now()-interval '37 days'
   -- Check the complete invoice history, including invoices outside this window.
   and not exists(select 1 from public.icash_membership_invoices old where old.membership_id=i.membership_id
    and (old.period_end,old.recorded_at,old.stripe_invoice_id)<(i.period_end,i.recorded_at,i.stripe_invoice_id))
  union all
  -- reconcileVipCheckout verifies this $50 one-time payment before applying it.
  -- Retention, owner tier switches, downgrades and pending payments are excluded.
  select c.payment_id,5000::bigint,c.applied_at,m.guest_hash,c.account_id,'vip_upgrade'::text
  from public.icash_plan_changes c join public.icash_memberships m on m.id=c.membership_id
  where m.mode='live' and c.action='upgrade' and c.state='applied' and c.payment_id is not null
   and c.from_price=5000 and c.to_price=10000 and c.applied_at>=now()-interval '37 days'
 ), verified as (
  select distinct on(p.payment_id) p.* from payments p
  where p.value_cents>0 and not exists(select 1 from public.icash_billing_reviews r where r.payment_id=p.payment_id)
  order by p.payment_id,p.occurred_at
 )
 select p.payment_id,p.value_cents,p.occurred_at,s.id,s.visitor_id,p.purchase_kind
 from verified p cross join lateral (
  select h.id,h.visitor_id from public.icash_webinar_sessions h join public.icash_webinar_visitors v on v.id=h.visitor_id
  where not h.is_preview and h.created_at<=p.occurred_at and h.created_at>=p.occurred_at-interval '7 days'
   and (v.funding_guest_hash=p.guest_hash or (p.account_id is not null and v.account_id=p.account_id))
   and exists(select 1 from public.icash_webinar_events e where e.session_id=h.id and e.kind='started' and e.created_at<=p.occurred_at)
  order by h.created_at desc,h.id limit 1
 ) s
$$;
revoke all on function public.icash_webinar_meta_purchases() from public,anon,authenticated;
grant execute on function public.icash_webinar_meta_purchases() to service_role;

-- Preserve sent history. Stop unsent legacy credits/renewals from becoming sales.
update public.icash_webinar_meta_events e set purchase_kind=p.purchase_kind
 from public.icash_webinar_meta_purchases() p where e.payment_id=p.payment_id;
update public.icash_webinar_meta_events set state='canceled',payload=null
 where purchase_kind is null and state in ('pending','sending','failed');

create or replace function public.icash_webinar_sync_purchases(p_visitor uuid default null) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not coalesce((select (config->'meta'->>'enabled')::boolean from public.icash_webinar_settings where id=1),false) then return;end if;
 insert into public.icash_webinar_meta_events(event_id,payment_id,visitor_id,session_id,value_cents,occurred_at,purchase_kind)
 select 'webinar:purchase:'||p.payment_id,p.payment_id,p.visitor_id,p.session_id,p.value_cents,p.occurred_at,p.purchase_kind
 from public.icash_webinar_meta_purchases() p join public.icash_webinar_visitors v on v.id=p.visitor_id
 where (p_visitor is null or p.visitor_id=p_visitor) and v.marketing_consent_at<=p.occurred_at and p.occurred_at>=now()-interval '6 days'
 on conflict do nothing;
 update public.icash_webinar_meta_events e set state='canceled',payload=null
 where e.state in ('pending','sending','failed') and (p_visitor is null or e.visitor_id=p_visitor)
  and (e.purchase_kind is null or e.occurred_at<now()-interval '6 days'
   or not exists(select 1 from public.icash_webinar_visitors v where v.id=e.visitor_id and v.marketing_consent_at<=e.occurred_at)
   or exists(select 1 from public.icash_billing_reviews r where r.payment_id=e.payment_id));
end $$;
revoke all on function public.icash_webinar_sync_purchases(uuid) from public,anon,authenticated;
grant execute on function public.icash_webinar_sync_purchases(uuid) to service_role;
commit;
