create role anon;create role authenticated;create role service_role bypassrls;
create table public.icash_operating_budget(id integer primary key);insert into public.icash_operating_budget values(1);
create table public.icash_text_senders(phone text primary key,enabled boolean not null default false);
create table public.icash_text_threads(id uuid primary key,account_id uuid not null,sender text not null,recipient text not null,paused boolean default false);
create table public.icash_text_messages(id uuid primary key,thread_id uuid,account_id uuid,direction text not null,body text not null default '',attachments jsonb not null default '[]',state text not null,provider_id text unique,last_delivery_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.icash_operation_rates(id uuid primary key,operation text not null);
create table public.icash_operation_spend(operation_key text primary key,account_id uuid not null,rate_id uuid not null,state text not null,dispatched_at timestamptz,settled_at timestamptz,charged_cents integer);
create table public.icash_text_events(id text primary key,type text not null,payload jsonb not null,received_at timestamptz not null default now());
grant select,insert,update on all tables in schema public to service_role;
