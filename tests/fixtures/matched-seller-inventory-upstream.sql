-- Production function definitions only; no customer data or provider calls.
CREATE OR REPLACE FUNCTION public.icash_claim_inventory(p_account uuid, p_screening uuid, p_phone text DEFAULT NULL::text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prop text;keys text[];k text;held public.icash_inventory_claims;contact text;
begin
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=p_screening and account_id=p_account;
 if prop is null or prop !~ '^prop_[A-Za-z0-9]+$' then return false;end if;
 if exists(select 1 from public.icash_outbound_property_owners where property_id=prop and account_id<>p_account) then return false;end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.icash_reserve_before_activation(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
 if screen is null or (not public.icash_meta_contact_only(p_account,screen,phone) and not public.icash_claim_inventory(p_account,screen,phone)) then raise exception 'Seller inventory assigned or suppressed';end if;
 end if;
 return public.icash_reserve_before_inventory(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
end $function$;

