create table public.icash_buyer_search_configs (
 account_id uuid primary key references public.icash_accounts(id),enabled boolean not null default false,
 rate_id uuid not null references public.icash_operation_rates(id),unit_cost_micros bigint not null check(unit_cost_micros>0),
 rights_until timestamptz not null,revision uuid not null default gen_random_uuid(),
 zip text not null check(zip ~ '^[0-9]{5}$'),since date not null,
 per_page integer not null default 10 check(per_page between 1 and 10),max_pages integer not null default 5 check(max_pages between 1 and 5)
);
create table public.icash_buyer_search_receipts (
 deal_id uuid not null references public.icash_deal_files(id),revision uuid not null,page integer not null check(page between 1 and 5),
 operation_key text not null unique references public.icash_operation_spend(operation_key),has_next_page boolean not null,
 receipt jsonb not null,created_at timestamptz not null default now(),primary key(deal_id,revision,page)
);
alter table public.icash_buyer_profiles add column discovery jsonb;
create table public.icash_buyer_candidates (
 deal_id uuid not null references public.icash_deal_files(id),buyer_id uuid not null references public.icash_buyer_profiles(id),rights_until timestamptz not null,
 discovered_at timestamptz not null default now(),primary key(deal_id,buyer_id)
);
alter table public.icash_buyer_search_configs enable row level security;
alter table public.icash_buyer_search_receipts enable row level security;
alter table public.icash_buyer_candidates enable row level security;
revoke all on public.icash_buyer_search_configs,public.icash_buyer_search_receipts,public.icash_buyer_candidates from public,anon,authenticated;
grant all on public.icash_buyer_search_configs,public.icash_buyer_search_receipts,public.icash_buyer_candidates to service_role;
create function public.icash_claim_buyer_search(p_account uuid,p_deal uuid,p_revision uuid,p_operation text) returns boolean language plpgsql set search_path='' as $$
declare d public.icash_deal_files;c public.icash_buyer_search_configs;prop text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return false;end if;
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for share;
 select * into c from public.icash_buyer_search_configs where account_id=p_account and revision=p_revision and enabled and rights_until>now() for share;
 if d.id is null or c.account_id is null or d.stage not in ('under_contract','buyer_selected') then return false;end if;
 if not exists(select 1 from public.icash_signing_envelopes where deal_id=d.id and account_id=p_account and kind='purchase' and state='completed' and not test_mode) then return false;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=d.screening_id and account_id=p_account;
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=prop and manual) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key=p_operation and o.account_id=p_account and o.rate_id=c.rate_id and r.operation='buyer_discovery') then return false;end if;
 return public.icash_claim_operation(p_operation);
end $$;
create function public.icash_save_buyer_search(p_account uuid,p_deal uuid,p_revision uuid,p_page integer,p_operation text,p_receipt jsonb) returns void language plpgsql set search_path='' as $$
declare c public.icash_buyer_search_configs;item jsonb;buyer uuid;prior public.icash_buyer_search_receipts;
begin
 select * into strict c from public.icash_buyer_search_configs where account_id=p_account and revision=p_revision for share;
 if not exists(select 1 from public.icash_deal_files where id=p_deal and account_id=p_account) or p_page<1 or p_page>c.max_pages or p_operation<>'buyers:'||p_deal||':'||p_revision||':'||p_page then raise exception 'Search binding mismatch';end if;
 perform 1 from public.icash_operation_spend where operation_key=p_operation and account_id=p_account and state='dispatched' for update;
 if not found then raise exception 'Dispatched buyer search required';end if;
 select * into prior from public.icash_buyer_search_receipts where deal_id=p_deal and revision=p_revision and page=p_page;
 if found then
  if prior.operation_key<>p_operation or prior.receipt<>p_receipt-'candidates' then raise exception 'Conflicting buyer receipt';end if;return;
 end if;
 if jsonb_typeof(p_receipt->'candidates') is distinct from 'array' or jsonb_array_length(p_receipt->'candidates')>c.per_page then raise exception 'Invalid buyer receipt';end if;
 for item in select value from jsonb_array_elements(p_receipt->'candidates') loop
  if item->>'personId' !~ '^per_[A-Za-z0-9]+$' or item->>'propertyId' !~ '^prop_[A-Za-z0-9]+$' then raise exception 'Invalid candidate';end if;
  -- Never infer confirmed buying criteria, funds, consent or signatory authority from ownership data.
  insert into public.icash_buyer_profiles(account_id,entity_key,display_name,criteria,source_ref,discovery)
  values(p_account,'dealmachine:'||(item->>'personId'),item->>'name','{}',p_operation,item)
  on conflict(account_id,entity_key) do update set discovery=excluded.discovery,source_ref=excluded.source_ref,updated_at=now() returning id into buyer;
  insert into public.icash_buyer_candidates(deal_id,buyer_id,rights_until) values(p_deal,buyer,c.rights_until) on conflict(deal_id,buyer_id) do update set rights_until=excluded.rights_until,discovered_at=now();
 end loop;
 insert into public.icash_buyer_search_receipts(deal_id,revision,page,operation_key,has_next_page,receipt) values(p_deal,p_revision,p_page,p_operation,(p_receipt->>'hasNextPage')::boolean,p_receipt-'candidates');
 perform public.icash_record_cost_observation('dealmachine',p_operation,p_operation,(p_receipt->>'creditsUsed')::numeric,'provider_credits');
 if (p_receipt->>'creditsUsed')::numeric>(p_receipt->>'estimatedCredits')::numeric or (p_receipt->>'propertyCredits')::numeric>0 then update public.icash_buyer_search_configs set enabled=false where account_id=p_account;end if;
end $$;
revoke all on function public.icash_claim_buyer_search(uuid,uuid,uuid,text),public.icash_save_buyer_search(uuid,uuid,uuid,integer,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_buyer_search(uuid,uuid,uuid,text),public.icash_save_buyer_search(uuid,uuid,uuid,integer,text,jsonb) to service_role;
-- Continue bounded next pages through the existing preparation worker, never replaying a paid request.
create or replace function public.icash_queue_fulfillment() returns void language plpgsql set search_path='' as $$
begin
 insert into public.icash_fulfillment_jobs(account_id,deal_id,purchase_envelope_id)
 select d.account_id,d.id,e.id from public.icash_deal_files d join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id and e.kind='purchase' and e.state='completed' and not e.test_mode
 where d.stage in ('under_contract','buyer_selected','title_open','closing') and not exists(select 1 from public.icash_fulfillment_jobs j where j.deal_id=d.id) order by d.updated_at limit 100 on conflict do nothing;
 update public.icash_fulfillment_jobs j set state='ready',updated_at=now() from public.icash_deal_files d where d.id=j.deal_id and d.stage in ('under_contract','buyer_selected','title_open','closing') and j.state='complete' and (j.updated_at<now()-interval '1 day' or j.result->'buyerDiscovery'->>'canContinue'='true');
 update public.icash_fulfillment_jobs set state='ready',updated_at=now() where state='issued' and updated_at<now()-interval '5 minutes';
end $$;
