-- Read-only reporting: reuse compact session metadata across cards, watch time and funnel.
CREATE OR REPLACE FUNCTION public.icash_webinar_report_with_funnel(p_period text DEFAULT 'today'::text, p_timezone text DEFAULT 'America/Chicago'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare first_day date;last_day date;starts_at timestamptz;ends_at timestamptz;empty_metrics jsonb;empty_watch jsonb;result jsonb;
begin
 if p_period is null or p_period not in ('today','yesterday','7d','30d') then raise exception 'Invalid report period';end if;
 if p_timezone is null or not exists(select 1 from public.icash_timezone_names where name=p_timezone) then raise exception 'Invalid report timezone';end if;
 last_day=(now() at time zone p_timezone)::date-case when p_period='yesterday' then 1 else 0 end;
 first_day=last_day-case when p_period='7d' then 6 when p_period='30d' then 29 else 0 end;
 starts_at=first_day::timestamp at time zone p_timezone;ends_at=(last_day+1)::timestamp at time zone p_timezone;
 empty_metrics='{"viewers":0,"addToCart":0,"checkouts":0,"purchases":0,"buyers":0,"cohortBuyers":0,"revenueCents":0,"leads":0,"offerViews":0}'::jsonb;
 empty_watch='{"startedSessions":0,"averageWatchSeconds":0,"averageWatchPercent":0,"completions":0}'::jsonb;
 -- Select the reporting window before reading large saved recording configurations.
 with source_events as materialized (
  select e.visitor_id,e.session_id,e.kind,e.created_at from public.icash_webinar_events e
  where e.created_at>=starts_at and e.created_at<ends_at and e.created_at<=now()
   and e.kind in ('started','add_to_cart','checkout_started','contact_saved','pitch_shown')
 ), source_payments as materialized (
  select p.* from public.icash_webinar_attributed_purchases() p
  where p.occurred_at>=starts_at and p.occurred_at<ends_at and p.occurred_at<=now()
 ), session_ids as (
  select session_id from source_events union select session_id from source_payments
 ), selected_sessions as materialized (
  select s.id,s.visitor_id,s.webinar_id,s.is_preview,s.watched_seconds,s.completed_at,s.config
  from session_ids i join public.icash_webinar_sessions s on s.id=i.session_id
 ), sessions as materialized (
  select s.id,s.visitor_id,s.webinar_id,s.is_preview,s.watched_seconds,s.completed_at,
   coalesce(m."recordingVersion",case when m.audience='night' then 'night' else 'day' end) as version,
   m."durationSeconds" as duration_seconds
  from selected_sessions s
  cross join lateral jsonb_to_record(case when jsonb_typeof(s.config)='object' then s.config else '{}'::jsonb end) as m("recordingVersion" text,audience text,"durationSeconds" text,"legacyCampaignId" text)
  where nullif(m."legacyCampaignId",'') is null
 ), events as materialized (
  select e.visitor_id,e.kind,e.created_at,s.webinar_id,s.id as session_id,s.version,s.visitor_id as session_visitor_id
  from source_events e join sessions s on s.id=e.session_id where not s.is_preview
 ), payments as materialized (
  select p.*,s.version,s.visitor_id as session_visitor_id,s.webinar_id as session_webinar_id,s.is_preview
  from source_payments p join sessions s on s.id=p.session_id
 ), starts as materialized (
  -- One first start per person, webinar and reporting scope replaces a scan for every payment.
  select k.key,e.visitor_id,e.webinar_id,min(e.created_at) as started_at
  from events e cross join lateral (values('total'),('webinar:'||e.webinar_id::text),('recording:'||e.webinar_id::text||':'||e.version),('day:'||(e.created_at at time zone p_timezone)::date::text)) k(key)
  where e.kind='started' group by k.key,e.visitor_id,e.webinar_id
 ), records as (
  select k.key,e.visitor_id,e.kind,null::text as payment_id,0::bigint as cents,false as cohort_buyer
  from events e cross join lateral (values('total'),('webinar:'||e.webinar_id::text),('recording:'||e.webinar_id::text||':'||e.version),('day:'||(e.created_at at time zone p_timezone)::date::text)) k(key)
  union all
  select k.key,p.visitor_id,'purchase',p.payment_id,p.value_cents,coalesce(st.started_at<=p.occurred_at,false)
  from payments p cross join lateral (values('total'),('webinar:'||p.webinar_id::text),('recording:'||p.webinar_id::text||':'||p.version),('day:'||(p.occurred_at at time zone p_timezone)::date::text)) k(key)
  left join starts st on st.key=k.key and st.visitor_id=p.visitor_id and st.webinar_id=p.webinar_id
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
 ), watches as (
  select k.key,jsonb_build_object('startedSessions',count(*),
   'averageWatchSeconds',coalesce(round(avg(least(s.watched_seconds,s.duration_seconds::integer))),0),
   'averageWatchPercent',coalesce(round(avg(100*least(s.watched_seconds,s.duration_seconds::integer)/nullif(s.duration_seconds::numeric,0)),1),0),
   'completions',count(*) filter(where s.completed_at is not null)) as value
  from events e join sessions s on s.id=e.session_id
  cross join lateral (values('total'),('webinar:'||e.webinar_id::text),('recording:'||e.webinar_id::text||':'||e.version),('day:'||(e.created_at at time zone p_timezone)::date::text)) k(key)
  where e.kind='started' group by k.key
 ), cohort as materialized (
  select e.visitor_id,e.webinar_id,min(e.created_at) entered_at from events e
  where e.kind='started' and e.visitor_id=e.session_visitor_id and e.created_at<least(ends_at,now())
  group by e.visitor_id,e.webinar_id
 ), activity as (
  select c.visitor_id,c.webinar_id,0 reached from cohort c
  union all
  select c.visitor_id,c.webinar_id,case e.kind when 'checkout_started' then 3 when 'add_to_cart' then 2 else 1 end
  from cohort c join events e on e.visitor_id=c.visitor_id and e.webinar_id=c.webinar_id
  where e.visitor_id=e.session_visitor_id and e.kind in ('pitch_shown','add_to_cart','checkout_started')
   and e.created_at>=c.entered_at and e.created_at<least(ends_at,now())
  union all
  select c.visitor_id,c.webinar_id,4 from cohort c join payments p
   on p.visitor_id=c.visitor_id and p.webinar_id=c.webinar_id
  where p.visitor_id=p.session_visitor_id and p.webinar_id=p.session_webinar_id and not p.is_preview
   and p.occurred_at>=c.entered_at and p.occurred_at<least(ends_at,now())
 ), people as materialized (
  select k.key,a.visitor_id,max(a.reached) reached
  from activity a cross join lateral (values('total'),('webinar:'||a.webinar_id::text)) k(key)
  group by k.key,a.visitor_id
 ), scopes as (
  select 'total' key,null::uuid webinar_id
  union all select 'webinar:'||w.id::text,w.id from public.icash_regular_webinars w
 ), counts as (
  select scope.key,scope.webinar_id,jsonb_agg(jsonb_build_object('key',s.key,'count',
   (select count(*) from people p where p.key=scope.key and p.reached>=s.n)) order by s.n) steps
  from scopes scope cross join (values(0,'viewers'),(1,'offer'),(2,'selected'),(3,'checkout'),(4,'purchased')) s(n,key)
  group by scope.key,scope.webinar_id
 )
 select jsonb_build_object('period',p_period,'timezone',p_timezone,'startDate',first_day,'endDate',last_day,
  'startsAt',starts_at,'endsAt',ends_at,'generatedAt',now(),
  'conversionFunnel',jsonb_build_object('summary',(select steps from counts where key='total'),
   'webinars',coalesce((select jsonb_agg(jsonb_build_object('webinarId',webinar_id,'steps',steps) order by webinar_id) from counts where webinar_id is not null),'[]'::jsonb)),
  'summary',coalesce((select m.value from metrics m where m.key='total'),empty_metrics)||coalesce((select t.value from watches t where t.key='total'),empty_watch),
  'webinars',coalesce((select jsonb_agg(jsonb_build_object('webinarId',w.id)||coalesce(m.value,empty_metrics)||coalesce(t.value,empty_watch) order by w.updated_at desc)
   from public.icash_regular_webinars w left join metrics m on m.key='webinar:'||w.id::text left join watches t on t.key='webinar:'||w.id::text),'[]'::jsonb),
  'recordings',coalesce((select jsonb_agg(jsonb_build_object('webinarId',w.id,'version',v.version)||coalesce(m.value,empty_metrics)||coalesce(t.value,empty_watch) order by w.updated_at desc,v.version)
   from public.icash_regular_webinars w cross join lateral (values('day'),('night')) v(version)
   left join metrics m on m.key='recording:'||w.id::text||':'||v.version left join watches t on t.key='recording:'||w.id::text||':'||v.version
   where v.version='day' or w.config->'nightVersion' is not null and w.config->'nightVersion'<>'null'::jsonb or m.key is not null),'[]'::jsonb),
  'days',(select jsonb_agg(jsonb_build_object('date',d.day::date)||coalesce(m.value,empty_metrics)||coalesce(t.value,empty_watch) order by d.day)
   from generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d(day)
   left join metrics m on m.key='day:'||d.day::date::text left join watches t on t.key='day:'||d.day::date::text)
 ) into result;
 return result;
end $function$;

revoke all on function public.icash_webinar_report_with_funnel(text,text) from public,anon,authenticated;
grant execute on function public.icash_webinar_report_with_funnel(text,text) to service_role;
