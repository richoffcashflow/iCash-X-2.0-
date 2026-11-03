-- Disposable fixture only; permission/current-policy boundaries are synthetic.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
end$$;
create table public.icash_operating_budget(id integer primary key);insert into public.icash_operating_budget values(1);
create table public.icash_accounts(id uuid primary key,bot_paused boolean default false,voice_current boolean default true);
create table public.icash_voice_configs(account_id uuid primary key,enabled boolean default true);
create table public.icash_screening_jobs(id uuid primary key,account_id uuid,state text default 'complete',result jsonb default '{"financialCheck":{"status":"eligible"}}');
create table public.icash_contact_permissions(id uuid primary key,account_id uuid,screening_id uuid,contact_key text,party text default 'seller',revoked_at timestamptz,permission_until timestamptz default now()+interval '1 day',dnc_clear boolean default false);
create table public.icash_operational_contacts(id uuid primary key,account_id uuid,screening_id uuid,contact_key text);
create table public.icash_voice_jobs(id uuid primary key default gen_random_uuid(),account_id uuid,permission_id uuid,operational_contact_id uuid,callback_id uuid,due_at timestamptz default now(),state text default 'ready',outcome text,updated_at timestamptz default now());
create unique index fixture_first_once on public.icash_voice_jobs(permission_id) where callback_id is null;
create unique index fixture_callback_once on public.icash_voice_jobs(callback_id) where callback_id is not null;
create table public.icash_live_conversations(id uuid primary key,state text,party text,result jsonb,contact_key text);
create table public.icash_live_callbacks(id uuid primary key,account_id uuid,conversation_id uuid,screening_id uuid,state text,due_at timestamptz);
create table public.fixture_evidence(id uuid primary key,allowed boolean default true,explode boolean default false,limited boolean default false);
create sequence public.fixture_evidence_reads;
create function public.fixture_id(n integer) returns uuid language sql immutable as $$select ('10000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid$$;
create function public.icash_outreach_voice_current(a uuid) returns boolean language sql stable as $$select voice_current and not bot_paused from public.icash_accounts where id=a$$;
create function public.icash_seller_voice_permission_current(a uuid,p uuid) returns boolean language plpgsql stable as $$
begin
 perform nextval('public.fixture_evidence_reads');
 if (select explode from public.fixture_evidence where id=p) then raise exception 'Prior route unnecessarily revalidated';end if;
 return (select e.allowed from public.fixture_evidence e join public.icash_contact_permissions c on c.id=e.id where e.id=p and c.account_id=a);
end$$;
create function public.icash_seller_limited_contact(a uuid,s uuid) returns boolean language sql stable as $$select e.limited from public.fixture_evidence e join public.icash_contact_permissions p on p.id=e.id where p.screening_id=s and p.account_id=a$$;
create function public.fixture_seed(n integer,a integer default 1) returns void language plpgsql as $$
declare id uuid:=public.fixture_id(n);acct uuid:=public.fixture_id(a);
begin
 insert into public.icash_accounts(id) values(acct) on conflict do nothing;
 insert into public.icash_voice_configs(account_id) values(acct) on conflict do nothing;
 insert into public.icash_screening_jobs(id,account_id) values(id,acct);
 insert into public.icash_contact_permissions(id,account_id,screening_id,contact_key) values(id,acct,id,n::text);
 insert into public.fixture_evidence(id) values(id);
end$$;
