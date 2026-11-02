-- Synthetic boundary dependencies only. The runner loads production schemas,
-- retry/unstarted/hash functions, preflight evidence guards and renewal policy.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end $$;
grant usage on schema public to anon,authenticated,service_role;
create schema icash_private;
create schema icash_research_private;
create schema icash_owner_review_private;
create table icash_private.provider_costs(operation_key text);
create table public.icash_operational_contacts(account_id uuid,screening_id uuid);
create table public.icash_contact_permissions(account_id uuid,screening_id uuid);
create table icash_research_private.owner_export_settings(id integer primary key,enabled boolean not null);
insert into icash_research_private.owner_export_settings values(1,true);
create table icash_research_private.owner_exports(request jsonb,completed_at timestamptz);
create table icash_owner_review_private.changes(kind text,after_row jsonb,recorded_at timestamptz);
create table public.fixture_cleanup_policy(member boolean not null,mobile boolean not null);
insert into public.fixture_cleanup_policy values(true,false);
create function public.icash_membership_work_allowed(uuid) returns boolean language sql stable
 set search_path='' as $$select member from public.fixture_cleanup_policy$$;
create function public.icash_research_state_allowed(text) returns boolean language sql stable
 set search_path='' as $$select $1='TX'$$;
create function public.icash_owner_targeting_pool(uuid,uuid) returns text language sql stable
 set search_path='' as $$select case when mobile then 'mobile' else 'active' end from public.fixture_cleanup_policy$$;
create function public.icash_prospecting_available(uuid) returns bigint language sql stable
 set search_path='' as $$select balance_cents-reserved_cents from public.icash_wallets where account_id=$1$$;
insert into public.icash_operating_budget(id,enabled) values(1,true);
