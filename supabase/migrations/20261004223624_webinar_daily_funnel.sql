alter table public.icash_webinar_events drop constraint icash_webinar_events_kind_check;
alter table public.icash_webinar_events add constraint icash_webinar_events_kind_check
 check(kind in ('started','name_saved','contact_saved','pitch_shown','add_to_cart','checkout_opened','checkout_started','completed','chat_question','returning_customer'));
create index icash_webinar_event_reporting on public.icash_webinar_events(created_at,kind,session_id);

-- A saved, live Stripe checkout is the source of a checkout start. A CTA click or
-- an arbitrary browser event cannot manufacture it. Applies to all billing paths.
create function public.icash_webinar_checkout_created() returns trigger
language plpgsql security invoker set search_path='' as $$
declare s public.icash_webinar_sessions;
begin
 if new.mode<>'live' or new.state<>'pending' or new.stripe_session_id is null
 or new.stripe_session_id not like 'cs_live_%' then return new;end if;
 if tg_op='UPDATE' and old.stripe_session_id is not distinct from new.stripe_session_id then return new;end if;
 select h.* into s from public.icash_webinar_sessions h join public.icash_webinar_visitors v on v.id=h.visitor_id
 where not h.is_preview and h.created_at between now()-interval '7 days' and now()
 and (v.funding_guest_hash=new.guest_hash or (new.account_id is not null and v.account_id=new.account_id))
 and exists(select 1 from public.icash_webinar_events e where e.session_id=h.id and e.kind='started')
 order by h.created_at desc,h.id limit 1;
 if s.id is not null then
  insert into public.icash_webinar_events(visitor_id,session_id,kind,event_key)
  values(s.visitor_id,s.id,'add_to_cart','once'),(s.visitor_id,s.id,'checkout_started','once') on conflict do nothing;
 end if;
 return new;
exception when others then
 -- Measurement must never interrupt an otherwise valid payment session.
 raise log 'Webinar checkout measurement unavailable';return new;
end $$;
revoke all on function public.icash_webinar_checkout_created() from public,anon,authenticated;
grant execute on function public.icash_webinar_checkout_created() to service_role;
create trigger icash_webinar_membership_checkout after insert or update of stripe_session_id on public.icash_memberships for each row execute function public.icash_webinar_checkout_created();
create trigger icash_webinar_funding_checkout after insert or update of stripe_session_id on public.icash_funding_orders for each row execute function public.icash_webinar_checkout_created();
create trigger icash_webinar_daily_checkout after insert or update of stripe_session_id on public.icash_daily_plans for each row execute function public.icash_webinar_checkout_created();

create function public.icash_webinar_daily_report(p_period text default 'today',p_timezone text default 'America/Chicago')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare first_day date;last_day date;starts_at timestamptz;ends_at timestamptz;empty_metrics jsonb;result jsonb;
begin
 if p_period is null or p_period not in ('today','yesterday','7d','30d') then raise exception 'Invalid report period';end if;
 if p_timezone is null or not exists(select 1 from pg_timezone_names where name=p_timezone) then raise exception 'Invalid report timezone';end if;
 last_day=(now() at time zone p_timezone)::date-case when p_period='yesterday' then 1 else 0 end;
 first_day=last_day-case when p_period='7d' then 6 when p_period='30d' then 29 else 0 end;
 starts_at=first_day::timestamp at time zone p_timezone;ends_at=(last_day+1)::timestamp at time zone p_timezone;
 empty_metrics='{"viewers":0,"addToCart":0,"checkouts":0,"purchases":0,"buyers":0,"cohortBuyers":0,"revenueCents":0,"leads":0,"offerViews":0}'::jsonb;
 with events as materialized (
  select e.visitor_id,e.kind,e.created_at,s.webinar_id
  from public.icash_webinar_events e join public.icash_webinar_sessions s on s.id=e.session_id
  where not s.is_preview and e.created_at>=starts_at and e.created_at<ends_at and e.created_at<=now()
  and e.kind in ('started','add_to_cart','checkout_started','contact_saved','pitch_shown')
 ), payments as materialized (
  select * from public.icash_webinar_attributed_purchases() p
  where p.occurred_at>=starts_at and p.occurred_at<ends_at and p.occurred_at<=now()
 ), records as (
  select k.key,e.visitor_id,e.kind,null::text as payment_id,0::bigint as cents,false as cohort_buyer
  from events e cross join lateral (values('total'),('webinar:'||e.webinar_id::text),('day:'||(e.created_at at time zone p_timezone)::date::text)) k(key)
  union all
  select k.key,p.visitor_id,'purchase',p.payment_id,p.value_cents,exists(
   select 1 from events e where e.kind='started' and e.visitor_id=p.visitor_id and e.webinar_id=p.webinar_id
   and e.created_at<=p.occurred_at and (k.key not like 'day:%' or (e.created_at at time zone p_timezone)::date=(p.occurred_at at time zone p_timezone)::date))
  from payments p cross join lateral (values('total'),('webinar:'||p.webinar_id::text),('day:'||(p.occurred_at at time zone p_timezone)::date::text)) k(key)
 ), metrics as (
  select key,jsonb_build_object(
   'viewers',count(distinct visitor_id) filter(where kind='started'),
   'addToCart',count(distinct visitor_id) filter(where kind='add_to_cart'),
   'checkouts',count(distinct visitor_id) filter(where kind='checkout_started'),
   'leads',count(distinct visitor_id) filter(where kind='contact_saved'),
   'offerViews',count(distinct visitor_id) filter(where kind='pitch_shown'),
   'purchases',count(distinct payment_id),'buyers',count(distinct visitor_id) filter(where kind='purchase'),
   'cohortBuyers',count(distinct visitor_id) filter(where cohort_buyer),
   'revenueCents',coalesce(sum(cents),0)) as value
  from records group by key
 )
 select jsonb_build_object('period',p_period,'timezone',p_timezone,'startDate',first_day,'endDate',last_day,
  'startsAt',starts_at,'endsAt',ends_at,'generatedAt',now(),
  'summary',coalesce((select m.value from metrics m where m.key='total'),empty_metrics),
  'webinars',coalesce((select jsonb_agg(jsonb_build_object('webinarId',w.id)||coalesce(m.value,empty_metrics) order by w.updated_at desc)
   from public.icash_webinars w left join metrics m on m.key='webinar:'||w.id::text),'[]'::jsonb),
  'days',(select jsonb_agg(jsonb_build_object('date',d.day::date)||coalesce(m.value,empty_metrics) order by d.day)
   from generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d(day)
   left join metrics m on m.key='day:'||d.day::date::text)
 ) into result;
 return result;
end $$;
revoke all on function public.icash_webinar_daily_report(text,text) from public,anon,authenticated;
grant execute on function public.icash_webinar_daily_report(text,text) to service_role;
