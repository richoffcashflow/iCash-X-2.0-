do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end$$;
create schema icash_reliability_private;
grant usage on schema public,icash_reliability_private to service_role;
create table public.icash_accounts(id uuid primary key,owner_user_id uuid);
create table public.fixture_monitor(report jsonb);
create function public.icash_reliability_status() returns jsonb language sql as $$select report from public.fixture_monitor limit 1$$;
create table icash_reliability_private.account_work_states(account_id uuid primary key,reason text,since timestamptz);
grant select on icash_reliability_private.account_work_states to service_role;
grant select,update on public.fixture_monitor to service_role;
