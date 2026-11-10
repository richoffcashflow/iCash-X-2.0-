-- Synthetic boundary dependencies; both runners execute the exact production
-- selector and estimate lease, not a rewritten model of their behavior.
create schema icash_work_private;
create schema icash_research_private;
create table public.icash_operating_budget(id int primary key,enabled boolean default true);
insert into public.icash_operating_budget values(1,true);
create table public.icash_accounts(id uuid primary key,bot_paused boolean default false);
create table public.icash_wallets(account_id uuid primary key,balance_cents bigint default 1000,reserved_cents bigint default 0);
create table public.icash_operation_rates(id uuid primary key,charge_cents bigint default 10);
create table public.icash_discovery_configs(account_id uuid primary key,enabled boolean default true,auto_enabled boolean default true,
 next_run_at timestamptz default now()-interval '1 minute',data_rights_until timestamptz default now()+interval '1 day',
 contacts_enabled boolean default true,contact_rate_id uuid,rate_id uuid,exhausted boolean default false,max_open_prospects int default 25);
create table public.icash_automation_tickets(id uuid primary key default gen_random_uuid(),account_id uuid,kind text,screening_id uuid unique,
 token text default gen_random_uuid()::text,state text default 'issued',outcome text,created_at timestamptz default now(),
 expires_at timestamptz default now()+interval '2 minutes',completed_at timestamptz,
 owner_preview_deferrals int default 0,owner_preview_retry_until timestamptz,issue_attempts int default 1);
create table icash_work_private.dispatch_policy(id int,enabled boolean);insert into icash_work_private.dispatch_policy values(1,true);
create table icash_work_private.acquisition_export_waits(account_id uuid,waiting_since timestamptz);
create table public.fixture_acquisition(account_id uuid primary key,contact uuid,quota boolean default true,allowance bigint default 1000,
 warm boolean default false,export_wait boolean default false,backlog int default 0,search_due boolean default true,query_ready boolean default true);
create function public.icash_settle_pending_dealmachine() returns void language sql as $$select null::void$$;
create function public.icash_owner_enrichment_unstarted(uuid,uuid,text) returns boolean language sql as $$select false$$;
create function public.icash_dealmachine_capacity_available(int,uuid) returns boolean language sql as $$select quota from public.fixture_acquisition where account_id=$2$$;
create function public.icash_new_user_request_reserve_eligible(uuid) returns boolean language sql as $$select false$$;
create function public.icash_owner_active_export_capacity(uuid) returns text language sql as $$select 'ready'::text$$;
create function public.icash_owner_preflight_due_at(uuid,uuid) returns timestamptz language sql as $$select null::timestamptz$$;
create function public.icash_owner_retry_due_at(uuid) returns timestamptz language sql as $$select null::timestamptz$$;
create function public.icash_daily_work_target(uuid) returns jsonb language sql as $$select '{"priorityRatio":1}'::jsonb$$;
create function icash_work_private.warm_seller_due(uuid) returns boolean language sql as $$select warm from public.fixture_acquisition where account_id=$1$$;
create function public.icash_prepare_research_efficiency(uuid) returns void language sql as $$select null::void$$;
create function public.icash_refresh_opportunity_outcomes(uuid) returns void language sql as $$select null::void$$;
create function icash_work_private.record_export_wait(uuid,timestamptz) returns boolean language sql as $$select export_wait from public.fixture_acquisition where account_id=$1$$;
create function public.icash_prospecting_available(uuid) returns bigint language sql as $$select allowance from public.fixture_acquisition where account_id=$1$$;
create function public.icash_research_admission_quote(uuid,text,bigint) returns bigint language sql as $$select $3$$;
create function public.icash_enrichment_candidate(uuid) returns uuid language sql as $$select contact from public.fixture_acquisition where account_id=$1$$;
create function public.icash_pending_opportunity_count(uuid) returns int language sql as $$select backlog from public.fixture_acquisition where account_id=$1$$;
create function public.icash_outbound_search_due(uuid) returns boolean language sql as $$select search_due from public.fixture_acquisition where account_id=$1$$;
create function public.icash_research_query_ready(uuid,jsonb,jsonb,jsonb) returns boolean language sql as $$select f.query_ready and not a.bot_paused and w.balance_cents>w.reserved_cents from public.fixture_acquisition f join public.icash_accounts a on a.id=f.account_id join public.icash_wallets w using(account_id) where f.account_id=$1$$;
create table icash_research_private.estimates(operation_key text primary key,account_id uuid,query jsonb,exclusion_synced_at timestamptz,
 token uuid,lease_until timestamptz,retry_at timestamptz,response jsonb,saved_at timestamptz,updated_at timestamptz default now(),shared_hits int default 0);
create table icash_research_private.exclusions(id int,list_id text,last_synced_at timestamptz);
create function public.fixture_discovery_seed(n int) returns uuid language plpgsql as $$
declare a uuid:=md5('synthetic-discovery-account-'||n)::uuid;r uuid:=md5('synthetic-discovery-rate-'||n)::uuid;
begin
 insert into public.icash_accounts(id) values(a);
 insert into public.icash_wallets(account_id) values(a);
 insert into public.icash_operation_rates(id) values(r);
 insert into public.icash_discovery_configs(account_id,contact_rate_id,rate_id) values(a,r,r);
 insert into public.fixture_acquisition(account_id) values(a);
 return a;
end$$;
