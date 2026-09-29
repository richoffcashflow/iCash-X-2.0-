create table public.icash_title_contacts (
 deal_id uuid primary key references public.icash_deal_files(id),account_id uuid not null references public.icash_accounts(id),
 email text not null check(email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 verified_until timestamptz not null,evidence_ref text not null check(length(evidence_ref)>10),
 rate_id uuid not null references public.icash_operation_rates(id),enabled boolean not null default false
);
create table public.icash_title_requests (
 id uuid primary key default gen_random_uuid(),deal_id uuid not null unique references public.icash_deal_files(id),account_id uuid not null references public.icash_accounts(id),
 purchase_envelope_id uuid not null references public.icash_signing_envelopes(id),recipient text not null,property_address text not null,
 rate_id uuid not null references public.icash_operation_rates(id),verified_until timestamptz not null,
 state text not null default 'ready' check(state in ('ready','dispatching','sent','needs_review')),provider_id text,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.icash_title_contacts enable row level security;
alter table public.icash_title_requests enable row level security;
revoke all on public.icash_title_contacts,public.icash_title_requests from public,anon,authenticated;
grant all on public.icash_title_contacts,public.icash_title_requests to service_role;
create function public.icash_prepare_title_request(p_account uuid,p_deal uuid) returns jsonb language plpgsql set search_path='' as $$
declare d public.icash_deal_files;c public.icash_title_contacts;e public.icash_signing_envelopes;j public.icash_title_requests;
begin
 select * into d from public.icash_deal_files where id=p_deal and account_id=p_account for share;
 select * into c from public.icash_title_contacts where deal_id=p_deal and account_id=p_account and enabled and verified_until>now() for share;
 select * into e from public.icash_signing_envelopes where deal_id=p_deal and account_id=p_account and kind='purchase' and state='completed' and not test_mode limit 1;
 if d.id is null or d.stage not in ('under_contract','buyer_selected','title_open','closing') or c.deal_id is null or e.id is null or lower(c.email) is distinct from lower(d.terms->>'titleEmail') then raise exception 'Verified title contact and signed purchase required';end if;
 if not exists(select 1 from public.icash_operation_rates where id=c.rate_id and operation='title_email' and enabled and expires_at>now()) then raise exception 'Title rate required';end if;
 insert into public.icash_title_requests(deal_id,account_id,purchase_envelope_id,recipient,property_address,rate_id,verified_until) values(d.id,p_account,e.id,c.email,d.terms->>'address',c.rate_id,c.verified_until) on conflict(deal_id) do nothing;
 select * into strict j from public.icash_title_requests where deal_id=d.id and account_id=p_account;
 return jsonb_build_object('id',j.id,'state',j.state);
end $$;
create function public.icash_claim_title_request(p_id uuid) returns boolean language plpgsql set search_path='' as $$
declare j public.icash_title_requests;d public.icash_deal_files;prop text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_title_requests where id=p_id for update;
 if not found or j.state<>'ready' or j.verified_until<=now() then return false;end if;
 perform 1 from public.icash_accounts where id=j.account_id and not bot_paused for update;if not found then return false;end if;
 select * into d from public.icash_deal_files where id=j.deal_id and account_id=j.account_id for share;
 if d.stage not in ('under_contract','buyer_selected','title_open','closing') or lower(d.terms->>'titleEmail') is distinct from lower(j.recipient) then return false;end if;
 if not exists(select 1 from public.icash_title_contacts where deal_id=d.id and account_id=j.account_id and email=j.recipient and rate_id=j.rate_id and enabled and verified_until>now()) then return false;end if;
 if not exists(select 1 from public.icash_signing_envelopes where id=j.purchase_envelope_id and account_id=j.account_id and deal_id=j.deal_id and state='completed' and not test_mode) then return false;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=d.screening_id and account_id=j.account_id;
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=j.account_id and property_id=prop and manual) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key='title:'||j.id and o.account_id=j.account_id and o.rate_id=j.rate_id and r.operation='title_email') then return false;end if;
 if not public.icash_claim_operation('title:'||j.id) then return false;end if;
 update public.icash_title_requests set state='dispatching',updated_at=now() where id=j.id;
 return true;
end $$;
revoke all on function public.icash_prepare_title_request(uuid,uuid),public.icash_claim_title_request(uuid) from public,anon,authenticated;
grant execute on function public.icash_prepare_title_request(uuid,uuid),public.icash_claim_title_request(uuid) to service_role;
