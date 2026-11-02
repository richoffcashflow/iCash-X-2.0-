-- Disposable database only. Provider transport is never used by this fixture.
create role anon;create role authenticated;create role service_role;
create schema icash_research_private;
create table icash_research_private.owner_exports(id uuid primary key,request jsonb,receipt jsonb,terminal_at timestamptz,completed_at timestamptz,recovery jsonb,csv text,lease_until timestamptz);
create unique index owner_export_one_pending on icash_research_private.owner_exports((true)) where terminal_at is null;
create table icash_research_private.owner_batches(id uuid primary key,account_id uuid,created_at timestamptz default now(),state text default 'claimed',paid_receipt jsonb);
create table icash_research_private.requests(id uuid primary key,kind text,account_id uuid,operation_key text,admitted boolean,created_at timestamptz default now(),finished_at timestamptz,result jsonb);
create table public.icash_operation_spend(operation_key text primary key,state text,charge_cap_cents integer);
create table public.icash_operating_budget(id integer primary key);insert into public.icash_operating_budget values(1);
create table fixture_settings(quota boolean,enabled boolean);insert into fixture_settings values(true,true);
create function public.icash_owner_active_export_enabled() returns boolean language sql stable as $$select enabled from public.fixture_settings$$;
create function public.icash_dealmachine_capacity_available(integer default 2) returns boolean language sql stable as $$select quota from public.fixture_settings$$;
create function public.icash_take_dealmachine_request(text,uuid,text,uuid) returns boolean language plpgsql as $$
declare ok boolean;begin select quota into ok from public.fixture_settings;
insert into icash_research_private.requests(id,kind,account_id,operation_key,admitted) values($4,$1,$2,$3,ok);return ok;end $$;
create function public.icash_owner_active_export_capacity() returns text language sql stable as $$
select case when exists(select 1 from icash_research_private.owner_exports where terminal_at is null) then 'export_busy' else 'ready' end $$;
create function public.icash_admit_owner_active_export(uuid,uuid,uuid,jsonb,jsonb,jsonb,jsonb) returns text language plpgsql as $$begin
perform pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
if exists(select 1 from icash_research_private.owner_exports where terminal_at is null) then return 'export_busy';end if;
insert into icash_research_private.owner_exports(id,request) values($3,$7);return 'claimed';end $$;
create function public.icash_claim_owner_batch(p_account uuid,p_primary uuid,p_batch uuid,p_items jsonb,p_preview jsonb,p_config jsonb) returns boolean language plpgsql as $$begin
perform 1 from public.icash_operating_budget where id=1 for update;return true;end $$;
