-- Extend the isolated preflight fixture with the real candidate query's inputs.
alter table public.icash_screening_jobs add column completed_at timestamptz default now(),add column result jsonb default '{"financialCheck":{"status":"eligible"}}';
create table public.icash_discovery_configs(account_id uuid,contact_rate_id uuid,research_version integer default 1,enabled boolean default true,contacts_enabled boolean default true,data_rights_until timestamptz default now()+interval '1 day');
create table public.icash_operation_rates(id uuid,enabled boolean default true,operation text default 'owner_enrichment',expires_at timestamptz default now()+interval '1 day',charge_cents integer default 10);
create table public.icash_wallets(account_id uuid,balance_cents integer default 100,reserved_cents integer default 0);
create table public.icash_property_controls(account_id uuid,property_id text,manual boolean);
create table public.icash_owner_contacts(account_id uuid,screening_id uuid,created_at timestamptz default now());
create table public.icash_operation_spend(operation_key text,state text);
create table public.icash_automation_tickets(screening_id uuid);
create table public.icash_operating_budget(id integer primary key);
insert into public.icash_operating_budget values(1);
create function public.icash_prospecting_available(p_account uuid) returns integer language sql as $$select balance_cents-reserved_cents from public.icash_wallets where account_id=p_account$$;
create function public.icash_prospecting_outreach_floor(uuid) returns integer language sql as $$select 0$$;
create function public.icash_research_state_allowed(text) returns boolean language sql as $$select $1='TX'$$;
create or replace function public.icash_owner_enrichment_unstarted(p_account uuid,p_screening uuid,p_operation text) returns boolean language sql as $$
 select unstarted and not exists(select 1 from public.icash_operation_spend where operation_key=p_operation)
 and not exists(select 1 from public.icash_owner_contacts where screening_id=p_screening) from public.fixture_settings
$$;
