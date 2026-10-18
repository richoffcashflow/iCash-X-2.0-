begin;
-- First-party reminder measurement. No historical clicks are manufactured.
create table public.icash_webinar_reminder_tracking (
 id integer primary key check(id=1),started_at timestamptz not null default now()
);
insert into public.icash_webinar_reminder_tracking(id) values(1);
create table public.icash_webinar_reminder_visits (
 id uuid primary key,job_id uuid not null references public.icash_webinar_outbox(id) on delete cascade,
 opened_at timestamptz not null default now(),confirmed_at timestamptz,watched_at timestamptz,
 watch_session_id uuid references public.icash_webinar_sessions(id) on delete set null,
 check(confirmed_at is null or confirmed_at>=opened_at),
 check(watched_at is null or (confirmed_at is not null and watched_at>=confirmed_at))
);
create index icash_webinar_reminder_visits_job on public.icash_webinar_reminder_visits(job_id,opened_at);
create index icash_webinar_reminder_visits_session on public.icash_webinar_reminder_visits(watch_session_id) where watch_session_id is not null;
create table public.icash_webinar_reminder_checkouts (
 checkout_id text not null check(checkout_id ~ '^cs_live_[A-Za-z0-9]{1,240}$'),
 visit_id uuid not null references public.icash_webinar_reminder_visits(id) on delete cascade,
 created_at timestamptz not null default now(),primary key(checkout_id,visit_id)
);
create index icash_webinar_reminder_checkouts_visit on public.icash_webinar_reminder_checkouts(visit_id);
alter table public.icash_webinar_reminder_tracking enable row level security;
alter table public.icash_webinar_reminder_visits enable row level security;
alter table public.icash_webinar_reminder_checkouts enable row level security;
revoke all on public.icash_webinar_reminder_tracking,public.icash_webinar_reminder_visits,public.icash_webinar_reminder_checkouts from public,anon,authenticated;
grant select on public.icash_webinar_reminder_tracking to service_role;
grant select,insert,update on public.icash_webinar_reminder_visits to service_role;
grant select,insert on public.icash_webinar_reminder_checkouts to service_role;

create function public.icash_webinar_open_reminder(p_job uuid,p_visit uuid,p_visitor uuid) returns boolean
language plpgsql security invoker set search_path='' as $$
begin
 if p_visit is null or not exists(
  select 1 from public.icash_webinar_outbox o
  join public.icash_webinar_sessions s on s.id=o.session_id and s.visitor_id=o.visitor_id
  join public.icash_webinar_visitors v on v.id=o.visitor_id
  where o.id=p_job and o.visitor_id=p_visitor and not s.is_preview
   and coalesce(o.sent_at,o.first_attempt_at) between now()-interval '30 days' and now()
   and nullif(v.measurement->>'opt_out_at','') is null
 ) then return false;end if;
 insert into public.icash_webinar_reminder_visits(id,job_id) values(p_visit,p_job) on conflict do nothing;
 return exists(select 1 from public.icash_webinar_reminder_visits where id=p_visit and job_id=p_job);
end $$;

create function public.icash_webinar_confirm_reminder(p_visit uuid,p_visitor uuid,p_action text,p_session uuid default null) returns boolean
language plpgsql security invoker set search_path='' as $$
declare visit public.icash_webinar_reminder_visits;
begin
 if p_action is null or p_action not in ('visit','watch') then return false;end if;
 select x.* into visit from public.icash_webinar_reminder_visits x
 join public.icash_webinar_outbox o on o.id=x.job_id
 join public.icash_webinar_visitors v on v.id=o.visitor_id
 where x.id=p_visit and o.visitor_id=p_visitor and x.opened_at between now()-interval '7 days' and now()-interval '1 second'
  and nullif(v.measurement->>'opt_out_at','') is null for update of x;
 if visit.id is null then return false;end if;
 if p_action='watch' then
  if visit.confirmed_at is null or not exists(select 1 from public.icash_webinar_sessions s
   where s.id=p_session and s.visitor_id=p_visitor and not s.is_preview and s.updated_at>=visit.opened_at
    and exists(select 1 from public.icash_webinar_events e where e.session_id=s.id and e.kind='started')) then return false;end if;
  update public.icash_webinar_reminder_visits set watched_at=coalesce(watched_at,now()),watch_session_id=coalesce(watch_session_id,p_session) where id=p_visit;
 else
  update public.icash_webinar_reminder_visits set confirmed_at=coalesce(confirmed_at,now()) where id=p_visit;
 end if;
 return true;
end $$;

create function public.icash_webinar_bind_reminder_checkout(p_visit uuid,p_visitor uuid,p_checkout text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare v public.icash_webinar_visitors;
begin
 if p_checkout is null or p_checkout !~ '^cs_live_[A-Za-z0-9]{1,240}$' then return false;end if;
 select u.* into v from public.icash_webinar_reminder_visits x join public.icash_webinar_outbox o on o.id=x.job_id
 join public.icash_webinar_visitors u on u.id=o.visitor_id
 where x.id=p_visit and o.visitor_id=p_visitor and x.opened_at between now()-interval '7 days' and now()
  and nullif(u.measurement->>'opt_out_at','') is null;
 if v.id is null then return false;end if;
 -- Billing has already verified the open Stripe Checkout. Also require its
 -- persisted ownership here; a client-supplied payment/recipient cannot bind it.
 if not exists(select 1 from public.icash_memberships m where m.stripe_session_id=p_checkout and m.mode='live' and m.state='pending'
  and (m.guest_hash=v.funding_guest_hash or (v.account_id is not null and m.account_id=v.account_id)))
 and not exists(select 1 from public.icash_plan_changes c join public.icash_memberships m on m.id=c.membership_id
  where c.session_id=p_checkout and c.action='upgrade' and c.state='pending' and m.mode='live'
   and (m.guest_hash=v.funding_guest_hash or (v.account_id is not null and c.account_id=v.account_id))) then return false;end if;
 insert into public.icash_webinar_reminder_checkouts(checkout_id,visit_id) values(p_checkout,p_visit) on conflict do nothing;
 return true;
end $$;

-- Read settled billing evidence, not thank-you pages or browser purchase events.
-- Each payment belongs to one latest confirmed reminder attached to its exact
-- Checkout within seven days. Renewals, credits, test payments and billing
-- reviews (including refunds/disputes) never count as recovered acquisitions.
create function public.icash_webinar_reminder_purchases()
returns table(payment_id text,value_cents bigint,occurred_at timestamptz,visit_id uuid,job_id uuid,visitor_id uuid,purchase_kind text)
language sql stable security invoker set search_path='' as $$
 with checkouts as materialized (select distinct checkout_id from public.icash_webinar_reminder_checkouts),
 payments as (
  select i.stripe_payment_id as payment_id,i.amount_cents as value_cents,i.recorded_at as occurred_at,m.stripe_session_id as checkout_id,'membership'::text as purchase_kind
  from checkouts b join public.icash_memberships m on m.stripe_session_id=b.checkout_id
  cross join lateral (
   select i.* from public.icash_membership_invoices i where i.membership_id=m.id
   order by i.period_end,i.recorded_at,i.stripe_invoice_id limit 1
  ) i where m.mode='live'
  union all
  select c.payment_id,5000::bigint,c.applied_at,c.session_id,'vip_upgrade'::text
  from checkouts b join public.icash_plan_changes c on c.session_id=b.checkout_id
  join public.icash_memberships m on m.id=c.membership_id
  where m.mode='live' and c.action='upgrade' and c.state='applied' and c.payment_id is not null
   and c.from_price=5000 and c.to_price=10000
 )
 select distinct on(p.payment_id) p.payment_id,p.value_cents,p.occurred_at,x.id,x.job_id,o.visitor_id,p.purchase_kind
 from payments p join public.icash_webinar_reminder_checkouts b on b.checkout_id=p.checkout_id
 join public.icash_webinar_reminder_visits x on x.id=b.visit_id
 join public.icash_webinar_outbox o on o.id=x.job_id
 join public.icash_webinar_visitors v on v.id=o.visitor_id
 where p.payment_id is not null and p.value_cents>0
  and x.confirmed_at between x.opened_at and p.occurred_at
  and x.opened_at between p.occurred_at-interval '7 days' and p.occurred_at
  and b.created_at between x.opened_at and p.occurred_at
  and nullif(v.measurement->>'opt_out_at','') is null
  and not exists(select 1 from public.icash_billing_reviews r where r.payment_id=p.payment_id)
 order by p.payment_id,x.opened_at desc,b.created_at desc,x.id
$$;

create function public.icash_webinar_reminder_results(p_jobs uuid[] default '{}') returns jsonb
language sql stable security invoker set search_path='' as $$
 with channels(channel) as (values ('all'::text),('email'),('sms')),
 jobs as materialized (
  select o.id,o.visitor_id,o.channel,o.state,o.created_at,coalesce(nullif(lower(v.email),''),nullif(v.phone,''),v.id::text) as person
  from public.icash_webinar_outbox o join public.icash_webinar_visitors v on v.id=o.visitor_id
 ), visits as materialized (
  select x.*,j.channel,j.person from public.icash_webinar_reminder_visits x join jobs j on j.id=x.job_id
 ), purchases as materialized (select p.*,j.channel,j.person from public.icash_webinar_reminder_purchases() p join jobs j on j.id=p.job_id),
 deliveries as (
  select c.channel,count(j.id) filter(where j.state='delivered') as delivered,
   count(distinct j.person) filter(where j.state='delivered') as people,
   count(j.id) filter(where j.state in ('pending','claimed','sending')) as queued
  from channels c left join jobs j on c.channel='all' or c.channel=j.channel group by c.channel
 ), engagement as (
  select c.channel,count(x.id) as opens,count(distinct x.person) filter(where x.confirmed_at is not null) as clicked,
   count(distinct x.person) filter(where x.watched_at is not null) as returned,
   count(distinct x.person) filter(where x.confirmed_at is not null and exists(select 1 from public.icash_webinar_reminder_checkouts b where b.visit_id=x.id)) as checkout
  from channels c left join visits x on c.channel='all' or c.channel=x.channel group by c.channel
 ), sales as (
  select c.channel,count(p.payment_id) as purchases,count(distinct p.person) as buyers,
   count(p.payment_id) filter(where p.purchase_kind='membership') as memberships,
   count(p.payment_id) filter(where p.purchase_kind='vip_upgrade') as vip,coalesce(sum(p.value_cents),0) as revenue
  from channels c left join purchases p on c.channel='all' or c.channel=p.channel group by c.channel
 ), metrics as (
  select d.channel,d.delivered as "deliveredMessages",d.people as "deliveredPeople",d.queued as "queuedMessages",
   e.opens as "linkOpens",e.clicked as "clickedPeople",e.returned as "returnedPeople",e.checkout as "checkoutPeople",
   s.purchases,s.buyers,s.memberships as "membershipPurchases",s.vip as "vipPurchases",s.revenue as "revenueCents"
  from deliveries d join engagement e using(channel) join sales s using(channel)
 ), selected_jobs as (select id from jobs where id=any(p_jobs) order by created_at desc,id desc limit 100),
 job_metrics as (
  select j.id as "jobId",(select count(*) from visits x where x.job_id=j.id) as "linkOpens",
   (select count(*) from visits x where x.job_id=j.id and x.confirmed_at is not null) as "confirmedVisits",
   exists(select 1 from visits x where x.job_id=j.id and x.watched_at is not null) as returned,
   (select count(*) from purchases p where p.job_id=j.id) as purchases,
   (select coalesce(sum(p.value_cents),0) from purchases p where p.job_id=j.id) as "revenueCents"
  from selected_jobs j
 )
 select jsonb_build_object('trackingSince',(select started_at from public.icash_webinar_reminder_tracking where id=1),
  'overall',(select to_jsonb(m) from metrics m where channel='all'),
  'channels',(select jsonb_agg(to_jsonb(m) order by channel) from metrics m where channel<>'all'),
  'jobs',coalesce((select jsonb_agg(to_jsonb(m)) from job_metrics m),'[]'::jsonb))
$$;
revoke all on function public.icash_webinar_open_reminder(uuid,uuid,uuid),public.icash_webinar_confirm_reminder(uuid,uuid,text,uuid),public.icash_webinar_bind_reminder_checkout(uuid,uuid,text),public.icash_webinar_reminder_purchases(),public.icash_webinar_reminder_results(uuid[]) from public,anon,authenticated;
grant execute on function public.icash_webinar_open_reminder(uuid,uuid,uuid),public.icash_webinar_confirm_reminder(uuid,uuid,text,uuid),public.icash_webinar_bind_reminder_checkout(uuid,uuid,text),public.icash_webinar_reminder_purchases(),public.icash_webinar_reminder_results(uuid[]) to service_role;
notify pgrst,'reload schema';
commit;
