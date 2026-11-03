-- Isolated request-reserve prerequisite relations. Provider work is never called.
do $$ begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end $$;
create schema icash_research_private;
create table public.icash_accounts(id uuid primary key,bot_paused boolean not null default false,workspace_ack_version text default 'fixture',membership_allowed boolean not null default true);
create table public.icash_wallets(account_id uuid primary key references public.icash_accounts(id),balance_cents bigint not null default 1000,reserved_cents bigint not null default 0);
create table public.icash_funding_orders(id uuid primary key default gen_random_uuid(),account_id uuid references public.icash_accounts(id),mode text not null default 'live',state text not null default 'paid',credited_at timestamptz,credit_cents bigint not null default 1000);
create table public.icash_billing_reviews(account_id uuid,resolved_at timestamptz);
create table public.icash_support_cancel_requests(account_id uuid,confirmed_at timestamptz);
create table public.icash_control_events(id uuid primary key default gen_random_uuid(),account_id uuid,property_id text,action text,created_at timestamptz not null default now());
create function public.icash_membership_work_allowed(p_account uuid) returns boolean language sql stable set search_path='' as $$select coalesce((select membership_allowed from public.icash_accounts where id=p_account),false)$$;
create function public.fixture_reserve_seed(n integer,age interval default interval '1 hour') returns uuid language plpgsql as $$
declare a uuid:=('00000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
begin
 insert into public.icash_accounts(id) values(a);
 insert into public.icash_wallets(account_id) values(a);
 insert into public.icash_funding_orders(account_id,credited_at) values(a,clock_timestamp()-age);
 return a;
end $$;
grant usage on schema public to anon,authenticated,service_role;
