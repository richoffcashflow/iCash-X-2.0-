create table public.icash_title_directory (
 id uuid primary key default gen_random_uuid(),domain text not null unique,name text not null,source_url text not null,
 public_email text,public_phone text,claimed_states text[] not null default '{}',
 contact_checked_until timestamptz not null,status text not null default 'candidate' check(status in ('candidate','qualified','rejected')),
 qualification_evidence text,verified_states text[] not null default '{}',verified_until timestamptz,
 check(status<>'qualified' or (length(qualification_evidence)>10 and verified_until is not null and cardinality(verified_states)>0))
);
create table public.icash_title_qualification_jobs (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 company_id uuid not null references public.icash_title_directory(id),market text not null,state_code text not null,
 state text not null default 'ready' check(state in ('ready','dispatching','sent','needs_review')),provider_id text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(account_id,company_id,market)
);
alter table public.icash_title_directory enable row level security;
alter table public.icash_title_qualification_jobs enable row level security;
revoke all on public.icash_title_directory,public.icash_title_qualification_jobs from public,anon,authenticated;
grant all on public.icash_title_directory,public.icash_title_qualification_jobs to service_role;
create function public.icash_queue_title_qualification(p_account uuid,p_deal uuid) returns void language plpgsql set search_path='' as $$
declare market_name text;st text;
begin
 select a.market,d.terms->>'state' into market_name,st from public.icash_deal_files d join public.icash_disposition_authorities a on a.deal_id=d.id and a.account_id=d.account_id
 where d.id=p_deal and d.account_id=p_account and d.stage in ('under_contract','buyer_selected') and a.expires_at>now()
 and exists(select 1 from public.icash_signing_envelopes e where e.id=a.purchase_envelope_id and e.account_id=p_account and e.state='completed' and not e.test_mode);
 if market_name is null or length(market_name)>120 or st !~ '^[A-Z]{2}$' then return;end if;
 if exists(select 1 from public.icash_title_contacts where deal_id=p_deal and account_id=p_account and enabled and verified_until>now()) then return;end if;
 insert into public.icash_title_qualification_jobs(account_id,company_id,market,state_code)
 select p_account,id,market_name,st from public.icash_title_directory where st=any(claimed_states) and status<>'rejected' and public_email is not null and contact_checked_until>now()
 order by case when status='qualified' and verified_until>now() then 0 else 1 end,id limit 2 on conflict do nothing;
end $$;
create function public.icash_claim_title_qualification(p_id uuid,p_recipient text) returns boolean language plpgsql set search_path='' as $$
declare j public.icash_title_qualification_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_title_qualification_jobs where id=p_id for update;
 if not found or j.state<>'ready' then return false;end if;
 perform 1 from public.icash_accounts where id=j.account_id and not bot_paused for update;if not found then return false;end if;
 perform 1 from public.icash_title_directory where id=j.company_id and status<>'rejected' and contact_checked_until>now() and public_email is not null for share;if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(j.company_id::text,42));
 if exists(select 1 from public.icash_title_qualification_jobs where company_id=j.company_id and market=j.market and id<>j.id and state in ('dispatching','sent','needs_review') and created_at>now()-interval '30 days') then return false;end if;
 if not exists(select 1 from public.icash_title_directory where id=j.company_id and public_email=p_recipient) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key='title-qualify:'||j.id and o.account_id=j.account_id and r.operation='title_qualification') then return false;end if;
 if not public.icash_claim_operation('title-qualify:'||j.id) then return false;end if;
 update public.icash_title_qualification_jobs set state='dispatching',updated_at=now() where id=j.id;return true;
end $$;
revoke all on function public.icash_queue_title_qualification(uuid,uuid),public.icash_claim_title_qualification(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_queue_title_qualification(uuid,uuid),public.icash_claim_title_qualification(uuid,text) to service_role;
