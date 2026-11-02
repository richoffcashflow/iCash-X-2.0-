-- Isolated synthetic fixture, never a production setup script.
create role anon;
create role authenticated;
create role service_role;
create table public.icash_accounts(id uuid primary key);
create table public.icash_deal_files(id uuid primary key,account_id uuid);
create table public.icash_discovery_configs(account_id uuid primary key,enabled boolean default true,next_run_at timestamptz default now(),updated_at timestamptz default now());
create table public.icash_workspace_revisions(account_id uuid primary key,revision bigint not null default 1,changed_at timestamptz default now());
create table public.icash_learning_queue(account_id uuid primary key,due_at timestamptz not null default now(),last_refreshed_at timestamptz,last_error_at timestamptz);
create table public.icash_learning_conversion_cache(id integer primary key,report jsonb,updated_at timestamptz not null default now());
create table public.fixture_outcomes(account_id uuid primary key,value integer default 0);
create function public.icash_usage_loop_report(uuid,boolean) returns jsonb language sql as $$select '{}'::jsonb$$;
create function public.icash_refresh_learning_account(p_account uuid) returns void language plpgsql as $$
begin
 perform pg_advisory_xact_lock(hashtextextended(p_account::text,81021));
 perform 1 from public.fixture_outcomes where account_id=p_account for update;
 if current_setting('fixture.wake',true)='true' then
  update public.icash_discovery_configs set enabled=not enabled where account_id=p_account;
 end if;
 if current_setting('fixture.fail',true)='true' then raise exception 'Synthetic refresh failure';end if;
 update public.fixture_outcomes set value=value+1 where account_id=p_account;
end $$;
