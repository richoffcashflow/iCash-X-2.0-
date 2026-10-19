begin;
set local lock_timeout='5s';

-- A paid, recorded inbound match already allocates this seller to its buyer.
-- Keep cold inventory exclusions separate: sharing never transfers that claim
-- or exposes another buyer's conversation, permission, usage or receipts.
alter function public.icash_claim_inventory(uuid,uuid,text) rename to icash_claim_cold_inventory;

-- Normalize the legacy E.164 expression without backslash/string ambiguity.
do $patch$
declare d text;pattern text:=$rx$if p_phone !~ '[^']*' then return false;end if;$rx$;
begin
 d:=pg_get_functiondef('public.icash_claim_cold_inventory(uuid,uuid,text)'::regprocedure);
 if d!~pattern then raise exception 'Inventory phone validation prerequisite changed';end if;
 execute regexp_replace(d,pattern,$replacement$if p_phone !~ '^[+][1-9][0-9]{7,14}$' then return false;end if;$replacement$);
end $patch$;

create function public.icash_claim_inventory(p_account uuid,p_screening uuid,p_phone text default null)
returns boolean language plpgsql security invoker set search_path='' as $$
declare l public.icash_seller_intakes;s public.icash_screening_jobs;
begin
 select lead.* into l from public.icash_seller_intakes lead
 join public.icash_seller_matches m on m.lead_id=lead.id
 where m.account_id=p_account and m.screening_id=p_screening for share of lead;
 if not found then return public.icash_claim_cold_inventory(p_account,p_screening,p_phone);end if;
 select * into s from public.icash_screening_jobs where id=p_screening and account_id=p_account for share;
 if not found or s.state<>'complete' or l.state<>'assigned'
  or p_phone is null or p_phone !~ '^[+][1-9][0-9]{7,14}$' or p_phone is distinct from l.phone
  or l.property->>'id' is null or s.snapshot->>'propertyId' is distinct from l.property->>'id'
  or s.snapshot->'sellerRequest'->>'id' is distinct from l.id::text
  or s.snapshot->'sellerRequest'->>'phone' is distinct from l.phone
  or public.icash_seller_contact_evidence(p_account,p_screening,l.id,p_phone) is null then return false;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=p_phone)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex'))
  or exists(select 1 from public.icash_outbound_property_owners where property_id=s.snapshot->>'propertyId' and account_id<>p_account)
  or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p_screening and state<>'resolved') then return false;end if;
 -- A different buyer's completed purchase ends this buyer's outreach. The
 -- winning buyer may continue its own permitted contract/closing conversation.
 if exists(select 1 from public.icash_seller_matches m
  join public.icash_deal_files d on d.account_id=m.account_id and d.screening_id=m.screening_id
  join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id
  where m.lead_id=l.id and m.account_id<>p_account and e.kind='purchase' and not e.test_mode and e.state='completed') then return false;end if;
 return true;
end $$;

revoke all on function public.icash_claim_inventory(uuid,uuid,text),public.icash_claim_cold_inventory(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_claim_inventory(uuid,uuid,text),public.icash_claim_cold_inventory(uuid,uuid,text) to service_role;
commit;
