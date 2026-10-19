CREATE OR REPLACE FUNCTION public.icash_prepare_operational_contacts_before_dm_observations(p_account uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare item record;ch text;n integer:=0;inserted integer;
begin
 for item in
 select distinct oc.account_id,oc.screening_id,a.owner_user_id,i.principal,public.icash_operational_phone(ph->>'number') phone,
 encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') source_hash,
 receipt.id dnc_id,case when zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12 then zone.name else 'Pacific/Honolulu' end timezone,
 case when zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12 then 'source_record' else 'conservative_nanp_window' end timezone_basis,least(receipt.expires_at,receipt.checked_at+interval '30 days',src.expires_at,cfg.data_rights_until) until
 from public.icash_owner_contacts oc
 join public.icash_accounts a on a.id=oc.account_id and not a.bot_paused
 join public.icash_customer_identities i on i.account_id=a.id and length(trim(i.principal))>0
 join public.icash_discovery_configs cfg on cfg.account_id=a.id and cfg.contacts_enabled and cfg.data_rights_until>now()
 join public.icash_screening_jobs s on s.id=oc.screening_id and s.account_id=a.id and s.state='complete' and s.snapshot->>'propertyId'=oc.result->>'propertyId' and coalesce(s.snapshot->>'practice','false')<>'true'
 join public.icash_operation_spend spend on spend.operation_key=oc.operation_key and spend.account_id=a.id and spend.state in ('dispatched','settled')
 cross join lateral jsonb_array_elements(case when jsonb_typeof(oc.result->'contacts')='array' then oc.result->'contacts' else '[]'::jsonb end) person
 cross join lateral jsonb_array_elements(case when jsonb_typeof(person->'phones')='array' then person->'phones' else '[]'::jsonb end) ph
 join public.icash_dnc_verification_receipts receipt on receipt.phone=public.icash_operational_phone(ph->>'number')
 and (receipt.evidence_kind='legacy_record' or (
  receipt.evidence_kind='national_provider_observation'
  and receipt.observation_provenance->>'accountId'=oc.account_id::text
  and receipt.observation_provenance->>'screeningId'=oc.screening_id::text
  and receipt.observation_provenance->>'operationKey'=oc.operation_key
  and receipt.observation_provenance->>'savedResultHash'=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')
  and exists(select 1 from public.icash_dealmachine_dnc_ingestions ingestion
   where ingestion.screening_id=oc.screening_id and ingestion.account_id=oc.account_id
    and ingestion.source_id=receipt.source_id and ingestion.owner_user_id=a.owner_user_id
    and ingestion.source_hash=receipt.receipt_hash and ingestion.operation_key=oc.operation_key
    and ingestion.source_recorded_at=oc.created_at and ingestion.request_started_at=receipt.checked_at
    and ingestion.original_expires_at=receipt.expires_at and ingestion.ingested_at=receipt.observation_recorded_at and ingestion.observations>0
    and ingestion.provider_operation_hash=public.icash_dealmachine_operation_hash(spend,(select r from public.icash_credit_reservations r where r.id=spend.credit_reservation_id))
    and exists(select 1 from public.icash_operation_rates original_rate where original_rate.id=spend.rate_id and original_rate.operation='owner_enrichment')
    and ingestion.provider_cost_hash=public.icash_dealmachine_credit_manifest_hash(oc.operation_key)
    and public.icash_dealmachine_saved_owner_result_valid(oc.result)))) and receipt.contact_key=encode(sha256(convert_to(receipt.phone,'UTF8')),'hex') and receipt.clear and receipt.revoked_at is null and receipt.checked_at between now()-interval '30 days' and now() and receipt.expires_at>now()
 join public.icash_dnc_verification_sources src on src.id=receipt.source_id and src.enabled and src.expires_at>now()
 left join public.icash_timezone_names zone on zone.name=receipt.contact_timezone
 where (p_account is null or oc.account_id=p_account)
 and (public.icash_conservative_nanp_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12))
 and public.icash_operational_source_phone(oc.result,receipt.phone)
 and not exists(select 1 from public.icash_text_suppressions where phone=receipt.phone)
 and not exists(select 1 from public.icash_contact_suppressions where contact_key=receipt.contact_key)
 and not exists(select 1 from public.icash_operational_contacts old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and not exists(select 1 from public.icash_contact_permissions old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and ((not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='voice')
   and (public.icash_conservative_voice_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12)))
  or not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='sms'))
 order by oc.account_id,oc.screening_id,receipt.id limit 100
 loop
  foreach ch in array array['voice','sms'] loop
   if ch='voice' and item.timezone_basis='conservative_nanp_window' and not public.icash_conservative_voice_window_supported(item.phone) then continue;end if;
   insert into public.icash_operational_contacts(account_id,screening_id,channel,phone,contact_key,timezone,timezone_basis,local_start_hour,local_end_hour,owner_user_id,sending_principal,source_hash,dnc_receipt_id,eligibility_until)
   values(item.account_id,item.screening_id,ch,item.phone,encode(sha256(convert_to(item.phone,'UTF8')),'hex'),item.timezone,item.timezone_basis,case when ch='voice' or item.timezone_basis='source_record' then 9 else 10 end,case when item.timezone_basis='source_record' then case when ch='voice' then 18 else 20 end else case when ch='voice' then 10 else 12 end end,item.owner_user_id,item.principal,item.source_hash,item.dnc_id,item.until)
   on conflict do nothing;get diagnostics inserted=row_count;n:=n+inserted;
  end loop;
 end loop;
 return n;
end $function$
