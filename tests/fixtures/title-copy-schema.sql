do $$begin create role anon;exception when duplicate_object then null;end$$;
do $$begin create role authenticated;exception when duplicate_object then null;end$$;
do $$begin create role service_role bypassrls;exception when duplicate_object then null;end$$;
alter role service_role bypassrls;
create table public.icash_accounts(id uuid primary key,owner_user_id uuid,bot_paused boolean not null default false,fixture_spending_allowed boolean not null default true);
create table public.icash_operating_budget(id integer primary key);
insert into public.icash_operating_budget values(1);
create table public.icash_screening_jobs(id uuid primary key,account_id uuid not null,snapshot jsonb not null);
create table public.icash_deal_files(id uuid primary key,account_id uuid not null,screening_id uuid not null,stage text not null,terms jsonb not null,seller_signed_at timestamptz default now()-interval '1 hour',assignment_signed_at timestamptz default now()-interval '1 hour');
create table public.icash_signing_envelopes(id uuid primary key,account_id uuid not null,deal_id uuid not null,kind text not null,state text not null,test_mode boolean not null default false,provider_id text,terms_hash text not null default 'fixture-terms',terms jsonb not null default '{}',recipients jsonb not null default '[]',template_id uuid not null default gen_random_uuid(),created_at timestamptz not null default now()-interval '1 day',updated_at timestamptz not null default now());
create table public.icash_agreement_cancellations(id uuid primary key default gen_random_uuid(),account_id uuid,deal_id uuid,kind text,state text,completed_at timestamptz,late_activity boolean not null default false);
create table public.icash_property_controls(account_id uuid,property_id text,manual boolean not null default false,updated_at timestamptz not null default now(),primary key(account_id,property_id));
create table public.icash_closing_setup(account_id uuid,deal_id uuid primary key,payout jsonb,state text,review_reason text,reply_id uuid,updated_at timestamptz not null default now());
create table public.icash_operation_rates(id uuid primary key,operation text,enabled boolean,expires_at timestamptz);
create table public.icash_operation_spend(operation_key text primary key,account_id uuid not null,rate_id uuid not null,state text not null default 'reserved',dispatched_at timestamptz,permission_until timestamptz not null);
create table public.icash_title_directory(id uuid primary key,public_email text);
create table public.icash_title_qualification_jobs(id uuid primary key,account_id uuid,company_id uuid,state text);
create table public.icash_title_followup_settings(id integer primary key,enabled boolean not null);
insert into public.icash_title_followup_settings values(1,true);
-- Financial/provider sentinels, not a replacement implementation of production
-- budgeting. Actual unchanged title claim invokes these only after admission.
create function public.icash_reserve_operation(a uuid,k text,r uuid,u timestamptz) returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=a and fixture_spending_allowed) then raise exception 'Fixture budget blocked';end if;
 if exists(select 1 from public.icash_operation_spend where operation_key=k) then raise exception 'Original operation retained';end if;
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,permission_until) values(k,a,r,u);
end $$;
create function public.icash_claim_operation(k text) returns boolean language plpgsql set search_path='' as $$
begin
 update public.icash_operation_spend set state='dispatched',dispatched_at=clock_timestamp() where operation_key=k and state='reserved' and permission_until>now();return found;
end $$;
