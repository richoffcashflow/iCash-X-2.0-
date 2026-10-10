-- Read-only reports. Reporting never dispatches work or creates conversion events.
create or replace function public.icash_owner_overview_with_funnel(
 p_actor uuid,p_days integer default 30,p_include_owner boolean default false,
 p_query text default '',p_page integer default 1
) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare report jsonb;starts_at timestamptz;ends_at timestamptz;steps jsonb;
begin
 -- Reuse the existing owner check and filter validation before touching lead data.
 report:=public.icash_owner_overview(p_actor,p_days,p_include_owner,p_query,p_page);
 starts_at:=(report->>'startAt')::timestamptz;ends_at:=(report->>'endAt')::timestamptz;
 with leads as materialized (
  select l.id,l.created_at,l.assigned_account,l.screening_id,l.assigned_at
  from public.icash_seller_intakes l
  where l.canonical_id is null and l.state<>'duplicate' and l.created_at>=starts_at and l.created_at<ends_at
 ), matches as materialized (
  select m.lead_id,m.account_id,m.screening_id from public.icash_seller_matches m join leads l on l.id=m.lead_id
  where m.assigned_at<ends_at
  union
  select l.id,l.assigned_account,l.screening_id from leads l
  where l.assigned_account is not null and l.screening_id is not null and coalesce(l.assigned_at,l.created_at)<ends_at
 ), deals as materialized (
  select m.lead_id,d.id,d.account_id,
   exists(select 1 from public.icash_signing_envelopes e where e.account_id=d.account_id and e.deal_id=d.id
    and e.kind='purchase' and e.state='completed' and not e.test_mode and nullif(e.provider_id,'') is not null
    and e.created_at<ends_at and d.seller_signed_at<ends_at) purchase_signed,
   exists(select 1 from public.icash_signing_envelopes e where e.account_id=d.account_id and e.deal_id=d.id
    and e.kind='assignment' and e.state='completed' and not e.test_mode and nullif(e.provider_id,'') is not null
    and e.created_at<ends_at and d.assignment_signed_at<ends_at) buyer_signed,
   exists(select 1 from public.icash_closing_updates u join public.icash_title_replies r
    on r.id=u.reply_id and r.account_id=u.account_id and r.deal_id=u.deal_id and r.sender_verified
    where u.account_id=d.account_id and u.deal_id=d.id and u.kind='closed' and u.created_at<ends_at
    and r.received_at<ends_at and u.effective_date<=(ends_at at time zone 'America/Chicago')::date
    and (u.confirmed_by is not null or u.confirmation_source='verified_title_format')) closed
  from matches m join public.icash_deal_files d on d.account_id=m.account_id and d.screening_id=m.screening_id
  where d.created_at<ends_at
 ), milestones as (
  select l.id,greatest(
   case when exists(select 1 from matches m where m.lead_id=l.id) then 1 else 0 end,
   case when exists(select 1 from public.icash_seller_events e where e.lead_id=l.id and e.event_name='Contact'
    and e.occurred_at>=l.created_at and e.occurred_at<ends_at) then 2 else 0 end,
   coalesce((select max(case when d.purchase_signed and d.buyer_signed and d.closed then 5
    when d.purchase_signed and d.buyer_signed then 4 when d.purchase_signed then 3 else 0 end) from deals d where d.lead_id=l.id),0)
  ) reached from leads l
 )
 -- One lead, regardless of the number of assigned accounts, calls or envelopes.
 -- Later verified outcomes also establish that earlier stages were reached.
 select jsonb_agg(jsonb_build_object('key',s.key,'count',(select count(*) from milestones m where m.reached>=s.n)) order by s.n)
 into steps from (values(0,'inbound'),(1,'assigned'),(2,'engaged'),(3,'contract'),(4,'buyer'),(5,'closed')) s(n,key);
 return report||jsonb_build_object('funnel',steps);
end $$;

create or replace function public.icash_webinar_report_with_funnel(p_period text default 'today',p_timezone text default 'America/Chicago')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare report jsonb;starts_at timestamptz;ends_at timestamptz;funnels jsonb;
begin
 report:=public.icash_webinar_daily_report(p_period,p_timezone);
 starts_at:=(report->>'startsAt')::timestamptz;ends_at:=least((report->>'endsAt')::timestamptz,(report->>'generatedAt')::timestamptz);
 with cohort as materialized (
  select s.visitor_id,s.webinar_id,min(e.created_at) entered_at
  from public.icash_webinar_events e join public.icash_webinar_sessions s on s.id=e.session_id and s.visitor_id=e.visitor_id
  where not s.is_preview and e.kind='started' and e.created_at>=starts_at and e.created_at<ends_at
  group by s.visitor_id,s.webinar_id
 ), activity as (
  select c.visitor_id,c.webinar_id,0 reached from cohort c
  union all
  select c.visitor_id,c.webinar_id,case e.kind when 'checkout_started' then 3 when 'add_to_cart' then 2 else 1 end
  from cohort c join public.icash_webinar_sessions s on s.visitor_id=c.visitor_id and s.webinar_id=c.webinar_id and not s.is_preview
  join public.icash_webinar_events e on e.session_id=s.id and e.visitor_id=s.visitor_id
  where e.kind in ('pitch_shown','add_to_cart','checkout_started') and e.created_at>=c.entered_at and e.created_at<ends_at
  union all
  select c.visitor_id,c.webinar_id,4 from cohort c join public.icash_webinar_attributed_purchases() p
   on p.visitor_id=c.visitor_id and p.webinar_id=c.webinar_id
  join public.icash_webinar_sessions s on s.id=p.session_id and s.visitor_id=p.visitor_id and s.webinar_id=p.webinar_id and not s.is_preview
  where p.occurred_at>=c.entered_at and p.occurred_at<ends_at
 ), people as materialized (
  select k.key,a.visitor_id,max(a.reached) reached
  from activity a cross join lateral (values('total'),('webinar:'||a.webinar_id::text)) k(key)
  group by k.key,a.visitor_id
 ), scopes as (
  select 'total' key,null::uuid webinar_id
  union all select 'webinar:'||w.id::text,w.id from public.icash_webinars w
 ), counts as (
  select scope.key,scope.webinar_id,jsonb_agg(jsonb_build_object('key',s.key,'count',
   (select count(*) from people p where p.key=scope.key and p.reached>=s.n)) order by s.n) steps
  from scopes scope cross join (values(0,'viewers'),(1,'offer'),(2,'selected'),(3,'checkout'),(4,'purchased')) s(n,key)
  group by scope.key,scope.webinar_id
 )
 select jsonb_build_object('summary',(select steps from counts where key='total'),
  'webinars',coalesce((select jsonb_agg(jsonb_build_object('webinarId',webinar_id,'steps',steps) order by webinar_id) from counts where webinar_id is not null),'[]'::jsonb)) into funnels;
 return report||jsonb_build_object('conversionFunnel',funnels);
end $$;

revoke all on function public.icash_owner_overview_with_funnel(uuid,integer,boolean,text,integer),public.icash_webinar_report_with_funnel(text,text) from public,anon,authenticated;
grant execute on function public.icash_owner_overview_with_funnel(uuid,integer,boolean,text,integer),public.icash_webinar_report_with_funnel(text,text) to service_role;
