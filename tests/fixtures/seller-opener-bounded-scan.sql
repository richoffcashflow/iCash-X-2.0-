-- Offline-only scheduler fixture. All helper observations are local rows.
do $$begin
 if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
 if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
 if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role bypassrls;end if;
end$$;
-- Isolated synthetic scheduler data. The captured production SELECT is tested
-- unchanged; eligibility helpers are deterministic fixtures, never providers.
create table public.icash_accounts(id uuid primary key,bot_paused boolean not null default false);
create table public.icash_wallets(account_id uuid primary key references public.icash_accounts,balance_cents bigint not null,reserved_cents bigint not null);
create table public.icash_screening_jobs(id uuid primary key,account_id uuid not null references public.icash_accounts,state text not null,result jsonb not null,snapshot jsonb not null,completed_at timestamptz);
create table public.icash_deal_files(id uuid primary key,account_id uuid not null references public.icash_accounts,screening_id uuid references public.icash_screening_jobs,stage text not null,terms jsonb not null);
create index icash_deal_files_account on public.icash_deal_files(account_id);
create table public.icash_timezone_names(name text primary key);
insert into public.icash_timezone_names values('UTC');
create table public.icash_text_threads(id uuid primary key,account_id uuid not null references public.icash_accounts,deal_id uuid references public.icash_deal_files,timezone text,recipient text,party text,paused boolean,ai_mode text,permission_until timestamptz,operational_contact_id uuid,eligibility_until timestamptz);
create index icash_text_threads_deal on public.icash_text_threads(account_id,deal_id);
-- Production uses separate account and thread FKs: an inconsistent historical
-- account must still block the global thread exclusion, exactly as before.
create table public.icash_text_messages(id uuid primary key,account_id uuid references public.icash_accounts,thread_id uuid references public.icash_text_threads,created_at timestamptz not null,state text not null,direction text not null,body text not null);
create index icash_text_messages_thread on public.icash_text_messages(account_id,thread_id,created_at desc);
create index icash_text_messages_account_thread_cursor on public.icash_text_messages(account_id,thread_id,created_at desc,id desc);
create table public.icash_text_suppressions(phone text primary key);
create table public.icash_property_controls(account_id uuid references public.icash_accounts,property_id text,manual boolean,primary key(account_id,property_id));
create table public.icash_operating_budget(id integer primary key,enabled boolean);
create table public.icash_automation_tickets(id uuid,account_id uuid,kind text,opener_message_id uuid,created_at timestamptz,token text);
create function public.icash_sms_thread_dispatch_until(p_account uuid,p_thread uuid) returns timestamptz language sql stable as $$
 select case when operational_contact_id is not null then eligibility_until else permission_until end
 from public.icash_text_threads where id=p_thread and account_id=p_account
$$;
create function public.icash_sms_outreach_window_current(p_account uuid,p_thread uuid) returns boolean language sql stable set search_path='' as $$select true$$;
create function public.icash_seller_opener_candidate_body(p_account uuid,p_thread uuid) returns text language plpgsql stable set search_path='' as $$begin return 'fixture-only'::text;end$$;

create index icash_text_messages_thread_lookup on public.icash_text_messages(thread_id);
alter table public.icash_text_threads add hours_allowed boolean not null default false,add review_allowed boolean not null default true,add queue_allowed boolean not null default true;
alter table public.icash_automation_tickets alter id set default gen_random_uuid(),alter token set default gen_random_uuid()::text,alter created_at set default now();
create table public.fixture_checks(thread_id uuid,phase text,backend_pid integer not null default pg_backend_pid());
create table public.fixture_prior(token text);
create function public.icash_next_before_seller_openers() returns jsonb language sql as $$select jsonb_build_object('token',token) from public.fixture_prior limit 1$$;
create or replace function public.icash_sms_outreach_window_current(p_account uuid,p_thread uuid) returns boolean language plpgsql volatile set search_path='' as $$begin
 insert into public.fixture_checks(thread_id,phase) values(p_thread,'hours');
 return (select hours_allowed from public.icash_text_threads where id=p_thread and account_id=p_account);
end$$;
create or replace function public.icash_seller_opener_candidate_body(p_account uuid,p_thread uuid) returns text language plpgsql volatile set search_path='' as $$begin
 insert into public.fixture_checks(thread_id,phase) values(p_thread,'source');
 return (select case when review_allowed then 'fixture-only' end from public.icash_text_threads where id=p_thread and account_id=p_account);
end$$;
create function public.icash_queue_seller_opener(p_account uuid,p_thread uuid) returns uuid language plpgsql set search_path='' as $$declare result uuid;begin
 insert into public.fixture_checks(thread_id,phase) values(p_thread,'queue');
 if not exists(select 1 from public.icash_text_threads t join public.icash_accounts a on a.id=t.account_id and not a.bot_paused join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents where t.id=p_thread and t.account_id=p_account and t.queue_allowed and not t.paused and t.hours_allowed and t.review_allowed) then return null;end if;
 if exists(select 1 from public.icash_text_messages where thread_id=p_thread) then return null;end if;
 result:=gen_random_uuid();
 insert into public.icash_text_messages values(result,p_account,p_thread,now(),'ready','outgoing','fixture-only');return result;
end$$;
insert into public.icash_operating_budget values(1,true);
create function public.fixture_seed(n integer,account_number integer default 1,allow_hours boolean default false) returns uuid language plpgsql set search_path='' as $$declare a uuid;item uuid;begin
 a:=('10000000-0000-4000-8000-'||lpad(account_number::text,12,'0'))::uuid;
 item:=('20000000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid;
 insert into public.icash_accounts values(a,false) on conflict do nothing;
 insert into public.icash_wallets values(a,10000,100) on conflict do nothing;
 insert into public.icash_screening_jobs values(item,a,'complete','{"financialCheck":{"status":"eligible"}}',jsonb_build_object('propertyId',item::text),now());
 insert into public.icash_deal_files values(item,a,item,'draft','{}');
 insert into public.icash_text_threads(id,account_id,deal_id,timezone,recipient,party,paused,ai_mode,permission_until,hours_allowed)
 values(item,a,item,'UTC','+1555'||lpad(n::text,7,'0'),'seller',false,'auto',now()+interval '1 day',allow_hours);
 return item;
end$$;
