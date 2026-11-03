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
insert into public.icash_accounts select md5('account-'||n)::uuid,false from generate_series(1,160) n;
insert into public.icash_wallets select id,100000,100 from public.icash_accounts;
insert into public.icash_screening_jobs
 select md5('screening-'||n)::uuid,md5('account-'||((n-1)/40+1))::uuid,'complete','{"financialCheck":{"status":"eligible"}}',jsonb_build_object('propertyId','property-'||n),
 case when n%12=0 then now()-interval '1 hour' else now()-interval '2 days' end from generate_series(1,6400) n;
insert into public.icash_deal_files select md5('deal-'||n)::uuid,md5('account-'||((n-1)/40+1))::uuid,md5('screening-'||n)::uuid,'draft','{}' from generate_series(1,6400) n;
insert into public.icash_text_threads
 select md5('thread-'||n)::uuid,md5('account-'||((n-1)/80+1))::uuid,md5('deal-'||((n-1)/2+1))::uuid,'UTC','+1555'||lpad(n::text,7,'0'),'seller',false,'auto',now()+interval '1 day',null,null from generate_series(1,12800) n;
insert into public.icash_text_messages
 select md5('message-'||n)::uuid,md5('account-'||((n-1)/80+1))::uuid,md5('thread-'||n)::uuid,now()-interval '1 hour',
 (array['ready','dispatching','accepted','delivered','needs_review','received'])[n%6+1],case when n%2=0 then 'incoming' else 'outgoing' end,'immutable saved history' from generate_series(1,12800) n where n%4<>0 or n%240=0;
insert into public.icash_text_messages
 select md5('extra-message-'||n)::uuid,md5('account-'||(((n%3200)*4)/80+1))::uuid,md5('thread-'||((n%3200)*4+1))::uuid,now()-interval '1 day','accepted','outgoing','immutable extra history' from generate_series(1,6200) n;
insert into public.icash_text_messages values(md5('orphan-message')::uuid,null,null,now()-interval '1 day','needs_review','incoming','immutable unbound history');
analyze public.icash_accounts;analyze public.icash_wallets;analyze public.icash_screening_jobs;analyze public.icash_deal_files;analyze public.icash_text_threads;analyze public.icash_text_messages;
