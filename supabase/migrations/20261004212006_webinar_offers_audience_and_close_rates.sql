-- Private heartbeat records; only aggregate active counts leave the server.
create table public.icash_webinar_presence (
 session_id uuid not null references public.icash_webinar_sessions(id) on delete cascade,
 tab_id uuid not null,
 visitor_id uuid not null references public.icash_webinar_visitors(id) on delete cascade,
 webinar_id uuid not null references public.icash_webinars(id) on delete cascade,
 sequence bigint not null check(sequence>=0),watching boolean not null,
 seen_at timestamptz not null default now(),primary key(session_id,tab_id)
);
create index icash_webinar_presence_active on public.icash_webinar_presence(webinar_id,seen_at) where watching;
create index icash_webinar_presence_expiry on public.icash_webinar_presence(seen_at);
alter table public.icash_webinar_presence enable row level security;
revoke all on public.icash_webinar_presence from public,anon,authenticated;
grant all on public.icash_webinar_presence to service_role;

create function public.icash_webinar_audience(p_visitor uuid,p_session uuid,p_tab uuid,p_sequence bigint,p_watching boolean)
returns jsonb language plpgsql security invoker set search_path=public as $$
declare s public.icash_webinar_sessions; enabled boolean; viewers bigint;
begin
 select * into s from icash_webinar_sessions where id=p_session and visitor_id=p_visitor;
 if not found then raise exception 'session not found';end if;
 select coalesce((w.config->>'showAudienceCount')::boolean,true) and w.config->>'status'='published' into enabled from icash_webinars w where w.id=s.webinar_id;
 delete from icash_webinar_presence where seen_at<now()-interval '2 minutes';
 if s.is_preview or s.superseded_at is not null or not enabled then
  delete from icash_webinar_presence where session_id=p_session;
  return jsonb_build_object('count',null);
 end if;
 insert into icash_webinar_presence(session_id,tab_id,visitor_id,webinar_id,sequence,watching)
 values(p_session,p_tab,p_visitor,s.webinar_id,p_sequence,p_watching and s.completed_at is null)
 on conflict(session_id,tab_id) do update set sequence=excluded.sequence,watching=excluded.watching,seen_at=now()
 where icash_webinar_presence.sequence<excluded.sequence;
 select count(distinct p.visitor_id) into viewers from icash_webinar_presence p
 join icash_webinar_sessions h on h.id=p.session_id
 where p.webinar_id=s.webinar_id and p.watching and p.seen_at>now()-interval '75 seconds'
 and not h.is_preview and h.superseded_at is null and h.completed_at is null;
 return jsonb_build_object('count',viewers);
end $$;
revoke all on function public.icash_webinar_audience(uuid,uuid,uuid,bigint,boolean) from public,anon,authenticated;
grant execute on function public.icash_webinar_audience(uuid,uuid,uuid,bigint,boolean) to service_role;

-- Existing allocation columns remain intact. Close rate uses unique viewers
-- who started playback, and unique buyers with an attributed live payment.
drop function public.icash_webinar_performance();
create function public.icash_webinar_performance()
returns table(webinar_id uuid,revision integer,visitors bigint,mature_visitors bigint,purchases bigint,value_cents bigint,mature_value_cents bigint,viewers bigint,buyers bigint,close_rate numeric)
language sql stable security invoker set search_path=public as $$
 with cohort as (
 select s.webinar_id,s.revision,s.visitor_id,min(s.created_at) as first_seen,
 bool_or(exists(select 1 from icash_webinar_events e where e.session_id=s.id and e.kind='started')) as watched
 from icash_webinar_sessions s where not s.is_preview and s.created_at>=now()-interval '30 days'
 group by s.webinar_id,s.revision,s.visitor_id
 ), paid as materialized (select * from icash_webinar_attributed_purchases())
 select c.webinar_id,c.revision,count(*),count(*) filter(where c.first_seen<=now()-interval '24 hours'),
 coalesce(sum(p.n),0)::bigint,coalesce(sum(p.cents),0)::bigint,
 coalesce(sum(p.cents) filter(where c.first_seen<=now()-interval '24 hours'),0)::bigint,
 count(*) filter(where c.watched),count(*) filter(where c.watched and p.n>0),
 round(100.0*count(*) filter(where c.watched and p.n>0)/nullif(count(*) filter(where c.watched),0),2)
 from cohort c left join lateral (
 select count(*) as n,sum(a.value_cents) as cents from paid a where a.visitor_id=c.visitor_id and a.webinar_id=c.webinar_id and a.revision=c.revision and a.occurred_at>=c.first_seen
 ) p on true group by c.webinar_id,c.revision
$$;
revoke all on function public.icash_webinar_performance() from public,anon,authenticated;
grant execute on function public.icash_webinar_performance() to service_role;
update public.icash_webinar_settings set config=jsonb_set(config,'{optimizer}',coalesce(config->'optimizer','{}'::jsonb)||'{"enabled":true}'::jsonb) where id=1;
