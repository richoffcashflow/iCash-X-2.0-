-- One immutable decision per smart-link session. Dedicated /live/ links and
-- previews do not enter experiments. Only the service role may read this data.
create table public.icash_webinar_assignments (
 session_id uuid primary key references public.icash_webinar_sessions(id) on delete cascade,
 visitor_id uuid not null references public.icash_webinar_visitors(id) on delete cascade,
 webinar_id uuid not null references public.icash_webinars(id) on delete cascade,
 revision integer not null check(revision>0),
 recording_version text not null check(recording_version in ('day','night')),
 ad_key text not null check(ad_key='direct' or ad_key~'^ad:[0-9]{5,30}$'),
 context_key text not null check(context_key in ('new:day','new:night','returning:day','returning:night')),
 pool_key text not null check(pool_key~'^[a-f0-9]{64}$'),
 baseline_key text not null check(length(baseline_key) between 40 and 80),
 mode text not null check(mode in ('learning','explore','winner','holdout','single','fallback')),
 probability numeric not null check(probability>0 and probability<=1),
 policy_version integer not null default 1 check(policy_version=1),
 created_at timestamptz not null default now()
);
create index icash_webinar_assignments_context on public.icash_webinar_assignments(context_key,created_at desc,ad_key);
create index icash_webinar_assignments_visitor on public.icash_webinar_assignments(visitor_id,created_at desc);
create index icash_webinar_assignments_webinar on public.icash_webinar_assignments(webinar_id);
alter table public.icash_webinar_assignments enable row level security;
revoke all on public.icash_webinar_assignments from public,anon,authenticated;
grant select,insert,update,delete on public.icash_webinar_assignments to service_role;

create function public.icash_webinar_begin_intelligent(p_visitor uuid,p_id uuid,p_config jsonb,p_assignment jsonb,p_advance_from uuid default null)
returns public.icash_webinar_sessions language plpgsql security invoker set search_path='' as $$
declare s public.icash_webinar_sessions; zone text;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_visitor::text||':false',729));
 select timezone into zone from public.icash_webinar_visitors where id=p_visitor;
 if not found then raise exception 'visitor unavailable';end if;
 -- Advancing expires the old smart journey once, without fabricating completion.
 if p_advance_from is not null then
  update public.icash_webinar_sessions set superseded_at=coalesce(superseded_at,now())
  where id=p_advance_from and visitor_id=p_visitor and not is_preview;
 end if;
 -- Concurrent tabs can select different candidates; the first saved assignment wins.
 select h.* into s from public.icash_webinar_sessions h
 join public.icash_webinar_assignments a on a.session_id=h.id
 join public.icash_webinars w on w.id=h.webinar_id
 where h.visitor_id=p_visitor and not h.is_preview and h.completed_at is null and h.superseded_at is null
 and timezone(zone,h.updated_at)::date=timezone(zone,now())::date and w.config->>'status'='published'
 order by h.created_at desc limit 1;
 if found then return s;end if;
 s:=public.icash_webinar_begin(p_visitor,p_id,p_config,false,p_advance_from);
 if s.id=p_id then
  insert into public.icash_webinar_assignments(session_id,visitor_id,webinar_id,revision,recording_version,ad_key,context_key,pool_key,baseline_key,mode,probability,policy_version)
  values(s.id,s.visitor_id,s.webinar_id,s.revision,coalesce(s.config->>'recordingVersion','day'),p_assignment->>'ad_key',p_assignment->>'context_key',p_assignment->>'pool_key',p_assignment->>'baseline_key',p_assignment->>'mode',(p_assignment->>'probability')::numeric,(p_assignment->>'policy_version')::integer);
 end if;
 return s;
end $$;
revoke all on function public.icash_webinar_begin_intelligent(uuid,uuid,jsonb,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.icash_webinar_begin_intelligent(uuid,uuid,jsonb,jsonb,uuid) to service_role;

create function public.icash_webinar_intelligence_report(p_context text default 'new:day',p_ad_key text default '*')
returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if p_context not in ('new:day','new:night','returning:day','returning:night') or p_context is null
 or p_ad_key is null or not(p_ad_key in ('*','direct') or p_ad_key~'^ad:[0-9]{5,30}$') then raise exception 'invalid intelligence context';end if;
 return (
 with ranked as materialized (
  select a.*,row_number() over(partition by a.visitor_id,a.ad_key order by a.created_at,a.session_id) as ad_visit,
   row_number() over(partition by a.visitor_id order by a.created_at,a.session_id) as shared_visit
  from public.icash_webinar_assignments a join public.icash_webinar_sessions s on s.id=a.session_id
  where a.context_key=p_context and a.created_at>=now()-interval '30 days' and not s.is_preview and a.policy_version=1
 ), cohort as materialized (
  select r.*,r.ad_key as report_ad from ranked r where r.ad_visit=1 and r.ad_key=p_ad_key
  union all select r.*,'*'::text as report_ad from ranked r where r.shared_visit=1
 ), paid as materialized (select * from public.icash_webinar_attributed_purchases()),
 outcomes as materialized (
  select c.*,c.created_at<=now()-interval '24 hours' as mature,
   coalesce(p.cents,0)::numeric as cents,coalesce(p.purchases,0)>0 as bought,
   coalesce(e.started,false) as started,coalesce(e.checkout,false) as checkout,
   least(s.watched_seconds,(s.config->>'durationSeconds')::numeric) as watched_seconds
  from cohort c join public.icash_webinar_sessions s on s.id=c.session_id
  left join lateral (
   select sum(greatest(p.value_cents,0)) as cents,count(*) as purchases from paid p
   where p.session_id=c.session_id and p.occurred_at>=c.created_at and p.occurred_at<c.created_at+interval '24 hours'
  ) p on true
  left join lateral (
   select bool_or(e.kind='started') as started,bool_or(e.kind='checkout_started') as checkout
   from public.icash_webinar_events e where e.session_id=c.session_id and e.created_at<c.created_at+interval '24 hours'
  ) e on true
 ), metrics as (
  select report_ad as ad_key,webinar_id,revision,recording_version,count(*) as visitors,
   count(*) filter(where mature) as mature_visitors,count(*) filter(where mature and bought) as buyers,
   coalesce(sum(cents) filter(where mature),0) as revenue_cents,count(*) filter(where checkout) as checkouts,
   coalesce(round(avg(watched_seconds) filter(where started),0),0) as average_watch_seconds,
   count(*) filter(where mature and mode in ('learning','explore')) as learning_visitors,
   count(*) filter(where mature and mode in ('learning','explore') and bought) as learning_buyers,
   coalesce(sum(cents) filter(where mature and mode in ('learning','explore')),0) as learning_value_cents,
   coalesce(sum(cents*cents) filter(where mature and mode in ('learning','explore')),0) as learning_value_squares
  from outcomes group by report_ad,webinar_id,revision,recording_version
 ), comparisons as (
  select pool_key,baseline_key,
   count(*) filter(where mode='holdout') as holdout_visitors,
   count(*) filter(where mode='holdout' and bought) as holdout_buyers,
   coalesce(sum(cents) filter(where mode='holdout'),0) as holdout_value_cents,
   count(*) filter(where mode<>'holdout') as adaptive_visitors,
   count(*) filter(where mode<>'holdout' and bought) as adaptive_buyers,
   coalesce(sum(cents) filter(where mode<>'holdout'),0) as adaptive_value_cents
  from outcomes where mature and report_ad=p_ad_key and mode in ('holdout','learning','explore','winner')
  group by pool_key,baseline_key order by count(*) desc limit 20
 ), ads as (
  select ad_key,count(*) as visitors from ranked where ad_visit=1 group by ad_key order by count(*) desc limit 100
 )
 select jsonb_build_object('generatedAt',now(),'rows',coalesce((select jsonb_agg(to_jsonb(m)) from metrics m),'[]'::jsonb),
  'comparisons',coalesce((select jsonb_agg(to_jsonb(c)) from comparisons c),'[]'::jsonb),
  'ads',coalesce((select jsonb_agg(to_jsonb(a)) from ads a),'[]'::jsonb))
 );
end $$;
revoke all on function public.icash_webinar_intelligence_report(text,text) from public,anon,authenticated;
grant execute on function public.icash_webinar_intelligence_report(text,text) to service_role;

-- Shipping authorization enables on-site routing. Meta measurement stays unchanged.
create function public.icash_webinar_intelligence_settings(p_enabled boolean)
returns void language sql security invoker set search_path='' as $$
 update public.icash_webinar_settings set config=jsonb_set(config,'{optimizer}',coalesce(config->'optimizer','{"explorationPercent":20,"minVisitors":100}'::jsonb)||jsonb_build_object('enabled',coalesce(p_enabled,false))),updated_at=now() where id=1;
$$;
revoke all on function public.icash_webinar_intelligence_settings(boolean) from public,anon,authenticated;
grant execute on function public.icash_webinar_intelligence_settings(boolean) to service_role;
update public.icash_webinar_settings set config=jsonb_set(config,'{optimizer}',coalesce(config->'optimizer','{}'::jsonb)||'{"enabled":true,"explorationPercent":20,"minVisitors":100}'::jsonb),updated_at=now() where id=1;
