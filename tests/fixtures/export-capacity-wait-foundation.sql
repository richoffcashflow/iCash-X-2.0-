-- Synthetic dependency boundaries. Both runners execute the exact saved issuer
-- and migration; provider eligibility, financial admission and clocks are fixtures.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end$$;
grant usage on schema public to service_role;
create schema icash_work_private;
grant usage on schema icash_work_private to service_role;
create table icash_work_private.dispatch_policy(id int primary key,enabled boolean);
insert into icash_work_private.dispatch_policy values(1,true);
grant select on icash_work_private.dispatch_policy to service_role;
create table public.icash_accounts(id uuid primary key,bot_paused boolean not null default false);
create table public.icash_wallets(account_id uuid primary key,balance_cents bigint not null default 10000,reserved_cents bigint not null default 0);
create table public.icash_discovery_configs(
 account_id uuid primary key,enabled boolean not null default true,auto_enabled boolean not null default true,
 next_run_at timestamptz not null,data_rights_until timestamptz not null,contacts_enabled boolean not null default true,
 contact_rate_id uuid,rate_id uuid,exhausted boolean not null default false,max_open_prospects int not null default 25
);
create table public.icash_operation_rates(id uuid primary key,charge_cents bigint not null);
create table public.icash_operating_budget(id int primary key,enabled boolean not null);insert into public.icash_operating_budget values(1,true);
create table public.icash_automation_tickets(
 id uuid primary key default gen_random_uuid(),token text not null default gen_random_uuid()::text unique,
 account_id uuid not null,kind text not null,screening_id uuid unique,state text not null default 'issued',outcome text,
 created_at timestamptz not null default now(),completed_at timestamptz,expires_at timestamptz not null default now()+interval '2 minutes',
 owner_preview_deferrals int not null default 0,owner_preview_retry_until timestamptz,issue_attempts int not null default 1
);
create table public.fixture_export_wait_policy(id int primary key,export_capacity text not null default 'ready',quota boolean not null default true);
insert into public.fixture_export_wait_policy(id) values(1);
create table public.fixture_export_wait_accounts(account_id uuid primary key,screening_id uuid,eligible boolean default true,
 search_due boolean default false,backlog int default 0,preflight_due timestamptz,priority numeric default 1);
create table public.fixture_candidate_reads(account_id uuid);
create table public.fixture_scan_reads(account_id uuid);
create table public.icash_operation_spend(operation_key text primary key,state text,receipt jsonb);
create table public.icash_credit_reservations(id uuid primary key,amount bigint);
insert into public.icash_operation_spend values('synthetic-unknown','dispatched','{"unknown":true}');
insert into public.icash_credit_reservations values(md5('synthetic-reserve')::uuid,777);
create function public.icash_settle_pending_dealmachine() returns void language plpgsql as $$begin raise exception 'Unexpected legacy settlement';end$$;
create function public.icash_owner_enrichment_unstarted(uuid,uuid,text) returns boolean language sql as $$select false$$;
create function public.icash_dealmachine_capacity_available(integer,uuid) returns boolean language sql stable as $$select quota from public.fixture_export_wait_policy$$;
create function public.icash_new_user_request_reserve_eligible(uuid) returns boolean language sql stable as $$select false$$;
create function public.icash_owner_active_export_capacity(uuid) returns text language sql stable as $$select export_capacity from public.fixture_export_wait_policy$$;
create function public.icash_owner_preflight_due_at(uuid,uuid) returns timestamptz language sql stable as $$select preflight_due from public.fixture_export_wait_accounts where account_id=$1$$;
create function public.icash_owner_retry_due_at(uuid) returns timestamptz language sql stable as $$select null::timestamptz$$;
create function public.icash_daily_work_target(uuid) returns jsonb language sql stable as $$select jsonb_build_object('priorityRatio',priority) from public.fixture_export_wait_accounts where account_id=$1$$;
create function public.icash_prepare_research_efficiency(uuid) returns void language sql as $$select null::void$$;
create function public.icash_refresh_opportunity_outcomes(uuid) returns void language sql as $$insert into public.fixture_scan_reads values($1)$$;
create function public.icash_prospecting_available(uuid) returns bigint language sql stable as $$select balance_cents-reserved_cents from public.icash_wallets where account_id=$1$$;
create function public.icash_research_admission_quote(uuid,text,bigint) returns bigint language sql stable as $$select $3$$;
create function public.icash_pending_opportunity_count(uuid) returns integer language sql stable as $$select backlog from public.fixture_export_wait_accounts where account_id=$1$$;
create function public.icash_outbound_search_due(uuid) returns boolean language sql stable as $$select search_due from public.fixture_export_wait_accounts where account_id=$1$$;
-- The counter deliberately makes this synthetic dependency volatile. The live
-- helper is STABLE and retains all its original exact-source/funding predicates.
create function public.icash_enrichment_before_provider_quota(uuid) returns uuid language plpgsql as $$
declare result uuid;
begin
 insert into public.fixture_candidate_reads values($1);
 select a.screening_id into result from public.fixture_export_wait_accounts a
 join public.icash_discovery_configs c using(account_id) join public.icash_operation_rates r on r.id=c.contact_rate_id
 where a.account_id=$1 and a.eligible and c.contacts_enabled and public.icash_prospecting_available($1)>=r.charge_cents;
 return result;
end$$;
create function public.icash_enrichment_candidate(uuid) returns uuid language plpgsql as $$
begin
 if public.icash_owner_active_export_capacity($1) in ('ready','disabled') and public.icash_dealmachine_capacity_available(2,$1)
 then return public.icash_enrichment_before_provider_quota($1);end if;return null;
end$$;
create function public.fixture_export_wait_seed(n integer,contacts boolean default true,overdue interval default interval '11 minutes') returns jsonb language plpgsql as $$
declare a uuid:=md5('export-wait-account-'||n)::uuid;s uuid:=md5('export-wait-screening-'||n)::uuid;r uuid:=md5('export-wait-rate-'||n)::uuid;
begin
 insert into public.icash_accounts(id) values(a);
 insert into public.icash_wallets(account_id) values(a);
 insert into public.icash_operation_rates values(r,105);
 insert into public.icash_discovery_configs(account_id,next_run_at,data_rights_until,contacts_enabled,contact_rate_id,rate_id)
 values(a,now()-overdue,now()+interval '1 day',contacts,case when contacts then r end,r);
 insert into public.fixture_export_wait_accounts(account_id,screening_id,search_due) values(a,s,not contacts);
 return jsonb_build_object('account',a,'screening',s,'rate',r);
end$$;
grant select,insert,update,delete on all tables in schema public to service_role;
