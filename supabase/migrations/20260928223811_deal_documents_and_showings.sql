create table public.icash_deal_files (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 screening_id uuid not null references public.icash_screening_jobs(id),terms jsonb not null,
 stage text not null default 'draft' check(stage in ('draft','under_contract','buyer_selected','title_open','closing','closed')),
 seller_signed_at timestamptz, assignment_signed_at timestamptz, title_verified_at timestamptz, funded_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(account_id,screening_id)
);
create table public.icash_deal_documents (
 id uuid primary key default gen_random_uuid(),deal_id uuid not null references public.icash_deal_files(id),
 kind text not null check(kind in ('purchase','assignment','buyer_package','title_packet')),
 html text not null check(octet_length(html)<100000),terms jsonb not null,
 created_at timestamptz not null default now()
);
create table public.icash_showing_requests (
 id uuid primary key default gen_random_uuid(),deal_id uuid not null references public.icash_deal_files(id),
 buyer_name text not null check(length(buyer_name) between 1 and 200),
 starts_at timestamptz not null,ends_at timestamptz not null,
 timezone text not null,state text not null default 'proposed' check(state in ('proposed','confirmed','cancelled','completed')),
 seller_confirmed_at timestamptz,buyer_confirmed_at timestamptz,created_at timestamptz not null default now(),
 check(ends_at>starts_at and ends_at<=starts_at+interval '4 hours'),
 check(state<>'confirmed' or (seller_confirmed_at is not null and buyer_confirmed_at is not null))
);
create index icash_deal_files_account on public.icash_deal_files(account_id,updated_at desc);
create index icash_deal_docs_deal on public.icash_deal_documents(deal_id,created_at desc);
create index icash_showing_deal on public.icash_showing_requests(deal_id,starts_at);
alter table public.icash_deal_files enable row level security;
alter table public.icash_deal_documents enable row level security;
alter table public.icash_showing_requests enable row level security;
revoke all on public.icash_deal_files,public.icash_deal_documents,public.icash_showing_requests from public,anon,authenticated;
grant all on public.icash_deal_files,public.icash_deal_documents,public.icash_showing_requests to service_role;
create function public.icash_prepare_deal(p_account uuid,p_screening uuid,p_terms jsonb) returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 if not exists(select 1 from public.icash_screening_jobs where id=p_screening and account_id=p_account and state='complete') then raise exception 'Account property missing';end if;
 insert into public.icash_deal_files(account_id,screening_id,terms) values(p_account,p_screening,p_terms)
 on conflict(account_id,screening_id) do update set terms=excluded.terms,updated_at=now() where icash_deal_files.stage='draft'
 returning id into result;
 if result is null then raise exception 'Executed deal requires amendment';end if;return result;
end $$;
create function public.icash_propose_showing(p_account uuid,p_deal uuid,p_buyer text,p_start timestamptz,p_end timestamptz,p_zone text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare result uuid;
begin
 perform 1 from public.icash_deal_files where id=p_deal and account_id=p_account for update;
 if not found then raise exception 'Deal missing';end if;
 if p_start<=now() or p_end<=p_start or p_end>p_start+interval '4 hours' or not exists(select 1 from pg_timezone_names where name=p_zone) then raise exception 'Invalid showing time';end if;
 if exists(select 1 from public.icash_showing_requests where deal_id=p_deal and state in ('proposed','confirmed') and starts_at<p_end and ends_at>p_start) then raise exception 'Showing time unavailable';end if;
 insert into public.icash_showing_requests(deal_id,buyer_name,starts_at,ends_at,timezone) values(p_deal,p_buyer,p_start,p_end,p_zone) returning id into result;return result;
end $$;
revoke all on function public.icash_prepare_deal(uuid,uuid,jsonb),public.icash_propose_showing(uuid,uuid,text,timestamptz,timestamptz,text) from public,anon,authenticated;
grant execute on function public.icash_prepare_deal(uuid,uuid,jsonb),public.icash_propose_showing(uuid,uuid,text,timestamptz,timestamptz,text) to service_role;
