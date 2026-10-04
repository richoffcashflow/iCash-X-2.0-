-- Anonymous, recent activity from verified billing records. Display settings stay
-- in each webinar's existing JSON configuration; simulated viewers never enter it.
alter table public.icash_webinar_visitors add column activity_region text check(length(activity_region)<=80);
create index icash_webinar_recent_funding on public.icash_funding_orders(paid_at desc)
 where mode='live' and state='paid' and stripe_payment_id is not null;
create index icash_webinar_recent_memberships on public.icash_membership_invoices(recorded_at desc);
create index icash_webinar_first_daily_payment on public.icash_funding_orders(daily_plan_id,paid_at,id)
 where daily_plan_id is not null and mode='live' and paid_at is not null;

create function public.icash_webinar_recent_activity(p_visitor uuid,p_session uuid)
returns table(id text,kind text,"amountCents" bigint,"occurredAt" timestamptz,region text)
language plpgsql stable security invoker set search_path='' as $$
declare s public.icash_webinar_sessions; viewer public.icash_webinar_visitors; current_config jsonb; show_region boolean;
begin
 select * into s from public.icash_webinar_sessions h where h.id=p_session and h.visitor_id=p_visitor;
 if s.id is null then raise exception 'Session not found';end if;
 select * into viewer from public.icash_webinar_visitors v where v.id=p_visitor;
 select w.config into current_config from public.icash_webinars w where w.id=s.webinar_id;
 if s.is_preview or s.superseded_at is not null or current_config->>'status' is distinct from 'published'
 or not coalesce((current_config->'purchaseNotifications'->>'enabled')::boolean,true)
 or not coalesce((s.config->'purchaseNotifications'->>'enabled')::boolean,true)
 or not exists(select 1 from public.icash_webinar_events e where e.session_id=s.id and e.kind='started') then return;end if;
 show_region=coalesce((current_config->'purchaseNotifications'->>'includeRegion')::boolean,true)
 and coalesce((s.config->'purchaseNotifications'->>'includeRegion')::boolean,true);

 return query
 with payments as materialized (
  select f.stripe_payment_id as payment_id,case when f.daily_plan_id is null then 'funding' else 'daily' end as event_kind,
   f.credit_cents as cents,f.paid_at as occurred_at,f.guest_hash,f.account_id
  from public.icash_funding_orders f
  where f.mode='live' and f.state='paid' and f.stripe_payment_id is not null and f.credit_cents>0
  and f.paid_at between now()-interval '15 minutes' and now()
  -- Daily renewals are not new viewers starting a budget.
  and (f.daily_plan_id is null or not exists(
   select 1 from public.icash_funding_orders previous where previous.daily_plan_id=f.daily_plan_id
   and previous.mode='live' and previous.paid_at is not null and (previous.paid_at,previous.id)<(f.paid_at,f.id)))
  union all
  select i.stripe_payment_id,'membership',i.amount_cents,i.recorded_at,m.guest_hash,m.account_id
  from public.icash_membership_invoices i join public.icash_memberships m on m.id=i.membership_id
  where m.mode='live' and m.state='active' and m.paid_through>now() and i.amount_cents>0
  and i.recorded_at between now()-interval '15 minutes' and now()
  and not exists(select 1 from public.icash_membership_invoices previous where previous.membership_id=m.id
   and (previous.recorded_at,previous.stripe_invoice_id)<(i.recorded_at,i.stripe_invoice_id))
 ), verified as (
  select distinct on(p.payment_id) p.* from payments p
  where p.payment_id is not null
  and not exists(select 1 from public.icash_billing_reviews r where r.payment_id=p.payment_id)
  and not coalesce(viewer.funding_guest_hash=p.guest_hash,false)
  and not coalesce(viewer.account_id=p.account_id,false)
  order by p.payment_id,p.occurred_at
 )
 select md5(p_session::text||':'||p.payment_id),p.event_kind,p.cents,p.occurred_at,
  case when show_region then attribution.activity_region else null end
 from verified p cross join lateral (
  select v.activity_region from public.icash_webinar_sessions h join public.icash_webinar_visitors v on v.id=h.visitor_id
  where not h.is_preview and h.visitor_id<>p_visitor
  and h.created_at between p.occurred_at-interval '7 days' and p.occurred_at
  and (v.funding_guest_hash=p.guest_hash or (p.account_id is not null and v.account_id=p.account_id))
  and exists(select 1 from public.icash_webinar_events e where e.session_id=h.id and e.kind='started' and e.created_at<=p.occurred_at)
  order by h.created_at desc,h.id limit 1
 ) attribution
 order by p.occurred_at desc,p.payment_id limit 12;
end $$;
revoke all on function public.icash_webinar_recent_activity(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_webinar_recent_activity(uuid,uuid) to service_role;
