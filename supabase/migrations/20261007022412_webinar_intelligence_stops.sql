-- A stopped revision remains stopped after the 30-day metrics window expires.
-- Day/night and new/returning audiences learn independently. No advertising
-- accounts or budgets are changed by these on-site routing decisions.
create table public.icash_webinar_intelligence_stops (
 context_key text not null check(context_key in ('new:day','new:night','returning:day','returning:night')),
 ad_key text not null check(ad_key in ('*','direct') or ad_key~'^ad:[0-9]{5,30}$'),
 arm_key text not null check(arm_key~'^[a-f0-9-]{36}:[1-9][0-9]*:(day|night)$'),
 winner_key text check(winner_key~'^[a-f0-9-]{36}:[1-9][0-9]*:(day|night)$' and winner_key<>arm_key),
 created_at timestamptz not null default now(),
 primary key(context_key,ad_key,arm_key)
);
alter table public.icash_webinar_intelligence_stops enable row level security;
revoke all on public.icash_webinar_intelligence_stops from public,anon,authenticated;
grant select,insert,update,delete on public.icash_webinar_intelligence_stops to service_role;

create function public.icash_webinar_stop_recordings(p_context text,p_stops jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_context is null or p_context not in ('new:day','new:night','returning:day','returning:night')
 or p_stops is null or jsonb_typeof(p_stops)<>'array' then raise exception 'invalid stop decision';end if;
 if jsonb_array_length(p_stops)>100 then raise exception 'too many stop decisions';end if;
 insert into public.icash_webinar_intelligence_stops(context_key,ad_key,arm_key,winner_key)
 select p_context,s->>'ad_key',s->>'arm_key',s->>'winner_key' from jsonb_array_elements(p_stops) s
 on conflict(context_key,ad_key,arm_key) do nothing;
end $$;
revoke all on function public.icash_webinar_stop_recordings(text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_webinar_stop_recordings(text,jsonb) to service_role;
