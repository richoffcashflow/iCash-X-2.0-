-- Stable public paths are allocated by PostgreSQL, including concurrent creates.
alter table public.icash_webinars add column public_code bigint generated always as identity (start with 100000);
create unique index icash_webinars_public_code_unique on public.icash_webinars(public_code);
revoke all on sequence public.icash_webinars_public_code_seq from public,anon,authenticated;
grant usage,select on sequence public.icash_webinars_public_code_seq to service_role;

-- Links resume only their own recording. An open second link cannot replace it.
create or replace function public.icash_webinar_begin(p_visitor uuid,p_id uuid,p_config jsonb,p_preview boolean,p_advance_from uuid default null)
returns public.icash_webinar_sessions language plpgsql security invoker set search_path='' as $$
declare s public.icash_webinar_sessions; zone text; target uuid:=(p_config->>'id')::uuid;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_visitor::text||':'||p_preview::text,729));
 select timezone into zone from public.icash_webinar_visitors where id=p_visitor;
 if not found then raise exception 'visitor unavailable';end if;
 if not exists(select 1 from public.icash_webinars w where w.id=target and (p_preview or w.config->>'status'='published')) then raise exception 'session unavailable';end if;
 select h.* into s from public.icash_webinar_sessions h
 where h.visitor_id=p_visitor and h.webinar_id=target and h.completed_at is null and h.superseded_at is null and h.is_preview=p_preview
 and (p_advance_from is null or h.id<>p_advance_from)
 and timezone(zone,h.updated_at)::date=timezone(zone,now())::date
 and (not p_preview or (h.revision=(p_config->>'revision')::integer and coalesce(h.config->>'recordingVersion','day')=coalesce(p_config->>'recordingVersion','day')))
 order by h.updated_at desc limit 1;
 if found then return s;end if;
 update public.icash_webinar_sessions set superseded_at=now() where visitor_id=p_visitor and webinar_id=target and completed_at is null and superseded_at is null and is_preview=p_preview;
 insert into public.icash_webinar_sessions(id,visitor_id,webinar_id,revision,config,is_preview)
 values(p_id,p_visitor,target,(p_config->>'revision')::integer,p_config,p_preview) returning * into s;
 return s;
end $$;
revoke all on function public.icash_webinar_begin(uuid,uuid,jsonb,boolean,uuid) from public,anon,authenticated;
grant execute on function public.icash_webinar_begin(uuid,uuid,jsonb,boolean,uuid) to service_role;
update public.icash_webinar_settings set config=jsonb_set(config,'{optimizer,enabled}','false'::jsonb);

-- Playback telemetry records forward playback, not the time a tab sits open.
-- A seek cannot add more watch time than elapsed server time. Preview data is
-- retained for recovery but excluded by every report.
alter table public.icash_webinar_sessions
 add column watched_seconds numeric(12,3) not null default 0 check(watched_seconds>=0),
 add column watch_position_seconds integer not null default 0,
 add column watch_updated_at timestamptz;
update public.icash_webinar_sessions set watched_seconds=least(max_seconds,(config->>'durationSeconds')::integer),watch_position_seconds=progress_seconds;
create or replace function public.icash_webinar_record(p_visitor uuid,p_session uuid,p_seconds integer,p_kind text,p_key text default 'once') returns void
language plpgsql security invoker set search_path='' as $$
declare s public.icash_webinar_sessions; seconds integer; delta numeric;
begin
 select * into s from public.icash_webinar_sessions where id=p_session and visitor_id=p_visitor for update;
 if not found then raise exception 'session not found';end if;
 seconds:=greatest(0,least(p_seconds,(s.config->>'durationSeconds')::integer));
 delta:=case when s.watch_updated_at is null then 0 else least(greatest(0,seconds-s.watch_position_seconds),greatest(0,extract(epoch from now()-s.watch_updated_at))) end;
 update public.icash_webinar_sessions set progress_seconds=seconds,max_seconds=greatest(max_seconds,seconds),updated_at=now(),
 watched_seconds=least((s.config->>'durationSeconds')::integer,watched_seconds+delta),watch_position_seconds=seconds,watch_updated_at=now(),
 completed_at=case when p_kind='completed' and seconds>=(s.config->>'durationSeconds')::integer-5 then coalesce(completed_at,now()) else completed_at end where id=s.id;
 if p_kind<>'progress' then insert into public.icash_webinar_events(visitor_id,session_id,kind,event_key) values(p_visitor,p_session,p_kind,left(p_key,100)) on conflict do nothing;end if;
 update public.icash_webinar_visitors set last_seen_at=now() where id=p_visitor;
end $$;
revoke all on function public.icash_webinar_record(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.icash_webinar_record(uuid,uuid,integer,text,text) to service_role;

create or replace function public.icash_webinar_daily_report(p_period text default 'today',p_timezone text default 'America/Chicago')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare first_day date;last_day date;starts_at timestamptz;ends_at timestamptz;empty_metrics jsonb;empty_watch jsonb;result jsonb;
begin
 if p_period is null or p_period not in ('today','yesterday','7d','30d') then raise exception 'Invalid report period';end if;
 if p_timezone is null or not exists(select 1 from public.icash_timezone_names where name=p_timezone) then raise exception 'Invalid report timezone';end if;
 last_day=(now() at time zone p_timezone)::date-case when p_period='yesterday' then 1 else 0 end;
 first_day=last_day-case when p_period='7d' then 6 when p_period='30d' then 29 else 0 end;
 starts_at=first_day::timestamp at time zone p_timezone;ends_at=(last_day+1)::timestamp at time zone p_timezone;
 empty_metrics='{"viewers":0,"addToCart":0,"checkouts":0,"purchases":0,"buyers":0,"cohortBuyers":0,"revenueCents":0,"leads":0,"offerViews":0}'::jsonb;
 empty_watch='{"startedSessions":0,"averageWatchSeconds":0,"averageWatchPercent":0,"completions":0}'::jsonb;
 with events as materialized (
  select e.visitor_id,e.kind,e.created_at,s.webinar_id,s.id as session_id,coalesce(s.config->>'recordingVersion',case when s.config->>'audience'='night' then 'night' else 'day' end) as version
  from public.icash_webinar_events e join public.icash_webinar_sessions s on s.id=e.session_id
  where not s.is_preview and e.created_at>=starts_at and e.created_at<ends_at and e.created_at<=now()
  and e.kind in ('started','add_to_cart','checkout_started','contact_saved','pitch_shown')
 ), payments as materialized (
  select p.*,coalesce(s.config->>'recordingVersion',case when s.config->>'audience'='night' then 'night' else 'day' end) as version from public.icash_webinar_attributed_purchases() p join public.icash_webinar_sessions s on s.id=p.session_id
  where p.occurred_at>=starts_at and p.occurred_at<ends_at and p.occurred_at<=now()
 ), records as (
  select k.key,e.visitor_id,e.kind,null::text as payment_id,0::bigint as cents,false as cohort_buyer
  from events e cross join lateral (values('total'),('webinar:'||e.webinar_id::text),('recording:'||e.webinar_id::text||':'||e.version),('day:'||(e.created_at at time zone p_timezone)::date::text)) k(key)
  union all
  select k.key,p.visitor_id,'purchase',p.payment_id,p.value_cents,exists(
   select 1 from events e where e.kind='started' and e.visitor_id=p.visitor_id and e.webinar_id=p.webinar_id
   and e.created_at<=p.occurred_at and (k.key not like 'recording:%' or e.version=p.version) and (k.key not like 'day:%' or (e.created_at at time zone p_timezone)::date=(p.occurred_at at time zone p_timezone)::date))
  from payments p cross join lateral (values('total'),('webinar:'||p.webinar_id::text),('recording:'||p.webinar_id::text||':'||p.version),('day:'||(p.occurred_at at time zone p_timezone)::date::text)) k(key)
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
   'averageWatchSeconds',coalesce(round(avg(least(s.watched_seconds,(s.config->>'durationSeconds')::integer))),0),
   'averageWatchPercent',coalesce(round(avg(100*least(s.watched_seconds,(s.config->>'durationSeconds')::integer)/nullif((s.config->>'durationSeconds')::numeric,0)),1),0),
   'completions',count(*) filter(where s.completed_at is not null)) as value
  from events e join public.icash_webinar_sessions s on s.id=e.session_id
  cross join lateral (values('total'),('webinar:'||e.webinar_id::text),('recording:'||e.webinar_id::text||':'||e.version),('day:'||(e.created_at at time zone p_timezone)::date::text)) k(key)
  where e.kind='started' group by k.key
 )
 select jsonb_build_object('period',p_period,'timezone',p_timezone,'startDate',first_day,'endDate',last_day,
  'startsAt',starts_at,'endsAt',ends_at,'generatedAt',now(),
  'summary',coalesce((select m.value from metrics m where m.key='total'),empty_metrics)||coalesce((select t.value from watches t where t.key='total'),empty_watch),
  'webinars',coalesce((select jsonb_agg(jsonb_build_object('webinarId',w.id)||coalesce(m.value,empty_metrics)||coalesce(t.value,empty_watch) order by w.updated_at desc)
   from public.icash_webinars w left join metrics m on m.key='webinar:'||w.id::text left join watches t on t.key='webinar:'||w.id::text),'[]'::jsonb),
  'recordings',coalesce((select jsonb_agg(jsonb_build_object('webinarId',w.id,'version',v.version)||coalesce(m.value,empty_metrics)||coalesce(t.value,empty_watch) order by w.updated_at desc,v.version)
   from public.icash_webinars w cross join lateral (values('day'),('night')) v(version)
   left join metrics m on m.key='recording:'||w.id::text||':'||v.version left join watches t on t.key='recording:'||w.id::text||':'||v.version
   where v.version='day' or w.config->'nightVersion' is not null and w.config->'nightVersion'<>'null'::jsonb or m.key is not null),'[]'::jsonb),
  'days',(select jsonb_agg(jsonb_build_object('date',d.day::date)||coalesce(m.value,empty_metrics)||coalesce(t.value,empty_watch) order by d.day)
   from generate_series(first_day::timestamp,last_day::timestamp,interval '1 day') d(day)
   left join metrics m on m.key='day:'||d.day::date::text left join watches t on t.key='day:'||d.day::date::text)
 ) into result;
 return result;
end $$;
revoke all on function public.icash_webinar_daily_report(text,text) from public,anon,authenticated;
grant execute on function public.icash_webinar_daily_report(text,text) to service_role;
