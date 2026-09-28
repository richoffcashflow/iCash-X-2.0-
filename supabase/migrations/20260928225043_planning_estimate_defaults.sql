-- Hypothetical customer-facing planning prices, NOT provider costs or enabled billing rates.
create table public.icash_planning_estimates (
 id integer primary key check(id=1),lookup_cents integer not null check(lookup_cents>0),
 voice_minute_cents integer not null check(voice_minute_cents>0),lookup_share_percent integer not null check(lookup_share_percent between 0 and 100),
 call_minutes_low integer not null check(call_minutes_low>0),call_minutes_high integer not null,
 check(call_minutes_high>=call_minutes_low)
);
insert into public.icash_planning_estimates values(1,10,100,20,2,5);
alter table public.icash_planning_estimates enable row level security;
revoke all on public.icash_planning_estimates from public,anon,authenticated;
grant all on public.icash_planning_estimates to service_role;
