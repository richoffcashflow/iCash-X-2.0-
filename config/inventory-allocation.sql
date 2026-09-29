-- Opaque cross-account exclusion keys; never share seller conversations or property payloads.
create table public.icash_inventory_claims(
 resource_key text primary key,account_id uuid not null references public.icash_accounts(id),
 screening_id uuid not null references public.icash_screening_jobs(id),
 cooldown_until timestamptz not null,updated_at timestamptz not null default now()
);
create table public.icash_inventory_markets(
 account_id uuid not null references public.icash_accounts(id),zip text not null check(zip ~ '^[0-9]{5}$'),
 priority integer not null default 100,eligible_until timestamptz not null,
 next_scan_at timestamptz not null default now(),primary key(account_id,zip)
);
alter table public.icash_inventory_claims enable row level security;
alter table public.icash_inventory_markets enable row level security;
revoke all on public.icash_inventory_claims,public.icash_inventory_markets from public,anon,authenticated;
grant all on public.icash_inventory_claims,public.icash_inventory_markets to service_role;
alter table public.icash_text_threads add column party text not null default 'seller' check(party in ('seller','buyer'));

create function public.icash_claim_inventory(p_account uuid,p_screening uuid,p_phone text default null) returns boolean language plpgsql set search_path='' as $$
declare prop text;keys text[];k text;held public.icash_inventory_claims;contact text;
begin
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=p_screening and account_id=p_account;
 if prop is null or prop !~ '^prop_[A-Za-z0-9]+$' then return false;end if;
 keys:=array['property:'||prop];
 if p_phone is not null then
 if p_phone !~ '^\+[1-9][0-9]{7,14}$' then return false;end if;
 contact:=encode(extensions.digest(p_phone,'sha256'),'hex');
 if exists(select 1 from public.icash_text_suppressions where phone=p_phone) or exists(select 1 from public.icash_contact_suppressions where contact_key=contact) then return false;end if;
 keys:=array_append(keys,'phone:'||contact);
 end if;
 -- All callers share deterministic lock ordering. No partial claim on a denied pair.
 for k in select x from unnest(keys) x order by x loop perform pg_advisory_xact_lock(hashtextextended(k,219));end loop;
 for k in select x from unnest(keys) x order by x loop
 select * into held from public.icash_inventory_claims where resource_key=k;
 if found and held.account_id<>p_account and (
 held.cooldown_until>now()
 or exists(select 1 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id where d.account_id=held.account_id and d.stage in ('under_contract','buyer_selected','title_open','closing') and s.snapshot->>'propertyId'=(select snapshot->>'propertyId' from public.icash_screening_jobs where id=held.screening_id))
 or exists(select 1 from public.icash_live_callbacks where account_id=held.account_id and screening_id=held.screening_id and state in ('pending_dispatch_review','held_for_human'))
 or exists(select 1 from public.icash_live_conversations where account_id=held.account_id and screening_id=held.screening_id and state in ('waiting','review'))
 ) then return false;end if;
 end loop;
 foreach k in array keys loop
 insert into public.icash_inventory_claims(resource_key,account_id,screening_id,cooldown_until) values(k,p_account,p_screening,now()+interval '30 days')
 on conflict(resource_key) do update set account_id=excluded.account_id,screening_id=excluded.screening_id,cooldown_until=excluded.cooldown_until,updated_at=now();
 end loop;
 return true;
end $$;

-- Reserve before paid enrichment or seller outreach; a rejection rolls back all claims.
alter function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) rename to icash_reserve_before_inventory;
create function public.icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language plpgsql set search_path='' as $$
declare op text;screen uuid;phone text;party text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select operation into op from public.icash_operation_rates where id=p_rate;
 if op='owner_enrichment' then
 select id into screen from public.icash_screening_jobs where account_id=p_account and 'owners:'||p_account||':'||id=p_operation;
 elsif op='seller_call' then
 select p.screening_id,p.phone into screen,phone from public.icash_voice_jobs j join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id where j.account_id=p_account and 'voice:'||j.id=p_operation and p.party='seller';
 elsif op in ('sms_send','mms_send') then
 select d.screening_id,t.recipient,t.party into screen,phone,party from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id where m.account_id=p_account and 'text:'||m.id=p_operation;
 end if;
 if op in ('owner_enrichment','seller_call') or (op in ('sms_send','mms_send') and party='seller') then
 if screen is null or not public.icash_claim_inventory(p_account,screen,phone) then raise exception 'Seller inventory assigned or suppressed';end if;
 end if;
 return public.icash_reserve_before_inventory(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
end $$;

create function public.icash_rotate_inventory_market(p_account uuid) returns boolean language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;m public.icash_inventory_markets;
begin
 select * into c from public.icash_discovery_configs where account_id=p_account for update;
 if not found or not c.exhausted or not c.enabled or not c.auto_enabled or c.data_rights_until<=now() then return false;end if;
 if not exists(select 1 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id where a.id=p_account and not a.bot_paused and w.balance_cents>w.reserved_cents) then return false;end if;
 select * into m from public.icash_inventory_markets where account_id=p_account and eligible_until>now() and next_scan_at<=now() order by priority,zip for update skip locked limit 1;
 if not found then return false;end if;
 update public.icash_discovery_configs set zip=m.zip,next_page=1,revision=gen_random_uuid(),exhausted=false where account_id=p_account;
 update public.icash_inventory_markets set next_scan_at=now()+interval '30 days' where account_id=p_account and zip=m.zip;
 return true;
end $$;
create function public.icash_mark_inventory_empty(p_account uuid,p_revision uuid,p_page integer) returns void language plpgsql set search_path='' as $$
begin
 update public.icash_discovery_configs set exhausted=true where account_id=p_account and revision=p_revision and next_page=p_page;
 if found then
 update public.icash_inventory_markets set next_scan_at=now()+interval '30 days' where account_id=p_account and zip=(select zip from public.icash_discovery_configs where account_id=p_account);
 perform public.icash_rotate_inventory_market(p_account);
 end if;
end $$;
alter function public.icash_next_automation() rename to icash_next_before_inventory;
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare a uuid;
begin
 perform pg_advisory_xact_lock(726341927);
 for a in select c.account_id from public.icash_discovery_configs c where c.exhausted and c.enabled and c.auto_enabled and exists(select 1 from public.icash_inventory_markets m where m.account_id=c.account_id and m.eligible_until>now() and m.next_scan_at<=now()) limit 10 loop
 perform public.icash_rotate_inventory_market(a);
 end loop;
 return public.icash_next_before_inventory();
end $$;
revoke all on function public.icash_claim_inventory(uuid,uuid,text),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_rotate_inventory_market(uuid),public.icash_mark_inventory_empty(uuid,uuid,integer),public.icash_next_automation() from public,anon,authenticated;
grant execute on function public.icash_claim_inventory(uuid,uuid,text),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_rotate_inventory_market(uuid),public.icash_mark_inventory_empty(uuid,uuid,integer),public.icash_next_automation() to service_role;
