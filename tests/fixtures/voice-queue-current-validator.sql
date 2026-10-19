-- Exact live contact validator captured read-only on 2026-10-19.
CREATE OR REPLACE FUNCTION public.icash_operational_contact_current(p_account uuid, p_contact uuid, p_channel text, p_check_hour boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_operational_contacts;oc public.icash_owner_contacts;d public.icash_dnc_verification_receipts;src public.icash_dnc_verification_sources;stamp timestamptz;h integer;
begin
 if p_channel not in ('voice','sms') or p_check_hour is null then return false;end if;
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account and channel=p_channel;
 if not found then return false;end if;
 -- Same order as dispatch/STOP; locks protect real rows, never a UNION view.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended(c.phone,74));
 perform pg_advisory_xact_lock(hashtextextended(c.contact_key,17));
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=c.owner_user_id for share;if not found then return false;end if;
 select * into c from public.icash_operational_contacts where id=p_contact and account_id=p_account and channel=p_channel for share;
 select * into oc from public.icash_owner_contacts where screening_id=c.screening_id and account_id=c.account_id for share;
 if not public.icash_lock_operational_dnc(p_account,p_contact) then return false;end if;
 select * into d from public.icash_dnc_verification_receipts where id=c.dnc_receipt_id;
 select * into src from public.icash_dnc_verification_sources where id=d.source_id;
 stamp:=clock_timestamp();
 if c.revoked_at is not null or c.eligibility_until<=stamp or oc.screening_id is null
 or c.source_hash is distinct from encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')
 or not public.icash_operational_source_phone(oc.result,c.phone)
 or not exists(select 1 from public.icash_operation_spend o where o.operation_key=oc.operation_key and o.account_id=p_account and o.state in ('dispatched','settled'))
 or not exists(select 1 from public.icash_screening_jobs s where s.id=c.screening_id and s.account_id=p_account and s.state='complete' and s.snapshot->>'propertyId'=oc.result->>'propertyId' and coalesce(s.snapshot->>'practice','false')<>'true')
 or not exists(select 1 from public.icash_customer_identities where account_id=p_account and principal=c.sending_principal)
 or not exists(select 1 from public.icash_discovery_configs where account_id=p_account and contacts_enabled and data_rights_until>stamp)
 or d.id is null or d.phone is distinct from c.phone or d.contact_key is distinct from c.contact_key or d.clear is distinct from true or d.revoked_at is not null
 or d.checked_at>stamp or d.checked_at<stamp-interval '30 days' or d.expires_at<=stamp
 or (c.timezone_basis='source_record' and (d.contact_timezone is distinct from c.timezone or length(trim(coalesce(d.timezone_source_reference,'')))<12))
 or (c.timezone_basis='conservative_nanp_window' and (c.timezone<>'Pacific/Honolulu'
  or (c.channel='voice' and (c.local_start_hour<>9 or c.local_end_hour<>10 or not public.icash_conservative_voice_window_supported(c.phone)))
  or (c.channel='sms' and (c.local_start_hour<>10 or c.local_end_hour<>12 or not public.icash_conservative_nanp_window_supported(c.phone)))))
 or src.id is null or not src.enabled or src.expires_at<=stamp
 or not exists(select 1 from public.icash_timezone_names where name=c.timezone)
 or exists(select 1 from public.icash_text_suppressions where phone=c.phone)
 or exists(select 1 from public.icash_contact_suppressions where contact_key=c.contact_key)
 or exists(select 1 from public.icash_contact_permissions where account_id=p_account and screening_id=c.screening_id and phone=c.phone and revoked_at is not null)
 then return false;end if;
 h:=extract(hour from stamp at time zone c.timezone);
 return not p_check_hour or (h>=greatest(9,c.local_start_hour) and h<least(case when c.channel='voice' then 18 else 20 end,c.local_end_hour));
end $function$

