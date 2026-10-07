-- Display countdowns are independent of checkout terms and conversion events.
-- A timer ID keeps its first deadline across tabs, returns and edited revisions.
create table public.icash_webinar_timer_deadlines (
  visitor_id uuid not null references public.icash_webinar_visitors(id) on delete cascade,
  webinar_id uuid not null references public.icash_webinars(id) on delete cascade,
  recording_version text not null check (recording_version in ('day', 'night')),
  timer_id text not null check (timer_id ~ '^[a-zA-Z0-9_-]{1,80}$'),
  started_at timestamptz not null,
  ends_at timestamptz not null check (ends_at > started_at),
  primary key (visitor_id, webinar_id, recording_version, timer_id)
);
create index icash_webinar_timer_deadlines_webinar on public.icash_webinar_timer_deadlines(webinar_id);
alter table public.icash_webinar_timer_deadlines enable row level security;
revoke all on public.icash_webinar_timer_deadlines from public, anon, authenticated;
grant select, insert on public.icash_webinar_timer_deadlines to service_role;

create function public.icash_webinar_timers(p_visitor uuid, p_session uuid, p_seconds integer)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  s public.icash_webinar_sessions;
  timer jsonb;
  version text;
  seconds integer;
  clock timestamptz := clock_timestamp();
  deadlines jsonb;
begin
  select * into s from public.icash_webinar_sessions where id = p_session and visitor_id = p_visitor;
  if not found then raise exception 'session not found'; end if;
  if p_seconds is null or p_seconds < 0 or p_seconds > 14400 then raise exception 'invalid progress'; end if;
  if s.is_preview or s.superseded_at is not null then
    return jsonb_build_object('deadlines', '{}'::jsonb, 'serverNow', extract(epoch from clock) * 1000);
  end if;
  version := coalesce(s.config->>'recordingVersion', 'day');
  seconds := least(p_seconds, (s.config->>'durationSeconds')::integer);
  for timer in select value from jsonb_array_elements(coalesce(s.config->'timers', '[]'::jsonb)) loop
    if timer->>'mode' = 'duration' and (timer->>'at')::integer <= seconds
      and (timer->>'durationSeconds')::integer between 1 and 604800 then
      insert into public.icash_webinar_timer_deadlines(visitor_id, webinar_id, recording_version, timer_id, started_at, ends_at)
      values (p_visitor, s.webinar_id, version, timer->>'id', clock, clock + make_interval(secs => (timer->>'durationSeconds')::integer))
      on conflict do nothing;
    end if;
  end loop;
  select coalesce(jsonb_object_agg(d.timer_id, d.ends_at), '{}'::jsonb) into deadlines
    from public.icash_webinar_timer_deadlines d
    where d.visitor_id = p_visitor and d.webinar_id = s.webinar_id and d.recording_version = version
      and exists (select 1 from jsonb_array_elements(coalesce(s.config->'timers', '[]'::jsonb)) t where t->>'id' = d.timer_id);
  return jsonb_build_object('deadlines', deadlines, 'serverNow', extract(epoch from clock_timestamp()) * 1000);
end $$;
revoke all on function public.icash_webinar_timers(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.icash_webinar_timers(uuid, uuid, integer) to service_role;
