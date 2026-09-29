create table public.icash_brand_jobs(
 setup_id uuid primary key references public.icash_bot_setups(id),brand_name text not null,
 state text not null check(state in ('creating','ready','unavailable')),attempts integer not null default 1 check(attempts between 1 and 2),
 designs jsonb,usage jsonb,updated_at timestamptz not null default now()
);
create table public.icash_brand_daily(day date primary key,attempts integer not null check(attempts between 0 and 100));
alter table public.icash_brand_jobs enable row level security;
alter table public.icash_brand_daily enable row level security;
revoke all on public.icash_brand_jobs,public.icash_brand_daily from public,anon,authenticated;
grant all on public.icash_brand_jobs,public.icash_brand_daily to service_role;
create function public.icash_claim_brand_design(p_setup uuid,p_name text) returns boolean language plpgsql set search_path='' as $$
declare j public.icash_brand_jobs;s public.icash_bot_setups;used integer;
begin
 select * into s from public.icash_bot_setups where id=p_setup for update;
 if not found or s.profile->>'displayName' is distinct from p_name then return false;end if;
 select * into j from public.icash_brand_jobs where setup_id=p_setup;
 if found and (j.brand_name=p_name or j.attempts>=2 or j.state='creating') then return false;end if;
 insert into public.icash_brand_daily(day,attempts) values((now() at time zone 'UTC')::date,0) on conflict do nothing;
 update public.icash_brand_daily set attempts=attempts+1 where day=(now() at time zone 'UTC')::date and attempts<100 returning attempts into used;
 if not found then return false;end if;
 insert into public.icash_brand_jobs(setup_id,brand_name,state) values(p_setup,p_name,'creating') on conflict(setup_id) do update set brand_name=excluded.brand_name,state='creating',designs=null,usage=null,attempts=icash_brand_jobs.attempts+1,updated_at=now();
 return true;
end $$;
revoke all on function public.icash_claim_brand_design(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_claim_brand_design(uuid,text) to service_role;
