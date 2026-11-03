-- ISOLATED PROPOSAL ONLY. No production migration or activation.
-- National observations first bind their exact source. The unchanged full source
-- phone proof implies membership in the old JSON expansion before final LIMIT.
-- Legacy receipts retain the original phone-expansion selector unchanged.
-- Installation still requires separate review: these nonconcurrent indexes can
-- briefly block receipt writes. Do not apply during the overlapping repair.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;old_query text:=$old$with candidates as materialized (
  select oc.account_id,oc.screening_id,a.owner_user_id,i.principal,public.icash_operational_phone(ph->>'number') phone,
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
  and receipt.observation_provenance->>'savedResultHash'=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')))
 and receipt.contact_key=encode(sha256(convert_to(receipt.phone,'UTF8')),'hex') and receipt.clear and receipt.revoked_at is null and receipt.checked_at between now()-interval '30 days' and now() and receipt.expires_at>now()
 join public.icash_dnc_verification_sources src on src.id=receipt.source_id and src.enabled and src.expires_at>now()
 left join public.icash_timezone_names zone on zone.name=receipt.contact_timezone
 where (p_account is null or oc.account_id=p_account)
 and (public.icash_conservative_nanp_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12))

 and not exists(select 1 from public.icash_text_suppressions where phone=receipt.phone)
 and not exists(select 1 from public.icash_contact_suppressions where contact_key=receipt.contact_key)
 and not exists(select 1 from public.icash_operational_contacts old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and not exists(select 1 from public.icash_contact_permissions old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and ((not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='voice')
   and (public.icash_conservative_voice_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12)))
  or not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='sms'))
 )
 select distinct candidate.* from candidates candidate
 join public.icash_owner_contacts oc on oc.account_id=candidate.account_id and oc.screening_id=candidate.screening_id
 join public.icash_accounts a on a.id=candidate.account_id
 join public.icash_operation_spend spend on spend.operation_key=oc.operation_key and spend.account_id=oc.account_id
 join public.icash_dnc_verification_receipts receipt on receipt.id=candidate.dnc_id
 where (receipt.evidence_kind='legacy_record' or (
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
    and public.icash_dealmachine_saved_owner_result_valid(oc.result))))
 and public.icash_operational_source_phone(oc.result,receipt.phone)
 order by candidate.account_id,candidate.screening_id,candidate.dnc_id limit 100$old$;
new_query text:=$new$with candidates as materialized (
  select oc.account_id,oc.screening_id,a.owner_user_id,i.principal,receipt.phone phone,
 encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') source_hash,
 receipt.id dnc_id,case when zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12 then zone.name else 'Pacific/Honolulu' end timezone,
 case when zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12 then 'source_record' else 'conservative_nanp_window' end timezone_basis,least(receipt.expires_at,receipt.checked_at+interval '30 days',src.expires_at,cfg.data_rights_until) until
 from public.icash_owner_contacts oc
 join public.icash_accounts a on a.id=oc.account_id and not a.bot_paused
 join public.icash_customer_identities i on i.account_id=a.id and length(trim(i.principal))>0
 join public.icash_discovery_configs cfg on cfg.account_id=a.id and cfg.contacts_enabled and cfg.data_rights_until>now()
 join public.icash_screening_jobs s on s.id=oc.screening_id and s.account_id=a.id and s.state='complete' and s.snapshot->>'propertyId'=oc.result->>'propertyId' and coalesce(s.snapshot->>'practice','false')<>'true'
 join public.icash_operation_spend spend on spend.operation_key=oc.operation_key and spend.account_id=a.id and spend.state in ('dispatched','settled')
 join public.icash_dealmachine_dnc_ingestions bound on bound.screening_id=oc.screening_id and bound.account_id=oc.account_id and bound.operation_key=oc.operation_key
 join public.icash_dnc_verification_receipts receipt on receipt.evidence_kind='national_provider_observation'
 and receipt.observation_provenance->>'accountId'=oc.account_id::text
 and receipt.observation_provenance->>'screeningId'=oc.screening_id::text
 and receipt.observation_provenance->>'operationKey'=oc.operation_key
 and receipt.observation_provenance->>'savedResultHash'=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')
 and receipt.contact_key=encode(sha256(convert_to(receipt.phone,'UTF8')),'hex') and receipt.clear and receipt.revoked_at is null and receipt.checked_at between now()-interval '30 days' and now() and receipt.expires_at>now()
 join public.icash_dnc_verification_sources src on src.id=receipt.source_id and src.enabled and src.expires_at>now()
 left join public.icash_timezone_names zone on zone.name=receipt.contact_timezone
 where (p_account is null or oc.account_id=p_account)
 and (public.icash_conservative_nanp_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12))

 and not exists(select 1 from public.icash_text_suppressions where phone=receipt.phone)
 and not exists(select 1 from public.icash_contact_suppressions where contact_key=receipt.contact_key)
 and not exists(select 1 from public.icash_operational_contacts old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and not exists(select 1 from public.icash_contact_permissions old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and ((not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='voice')
   and (public.icash_conservative_voice_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12)))
  or not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='sms'))
 union all
  select oc.account_id,oc.screening_id,a.owner_user_id,i.principal,public.icash_operational_phone(ph->>'number') phone,
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
  and receipt.observation_provenance->>'savedResultHash'=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex')))
 and receipt.contact_key=encode(sha256(convert_to(receipt.phone,'UTF8')),'hex') and receipt.clear and receipt.revoked_at is null and receipt.checked_at between now()-interval '30 days' and now() and receipt.expires_at>now()
 join public.icash_dnc_verification_sources src on src.id=receipt.source_id and src.enabled and src.expires_at>now()
 left join public.icash_timezone_names zone on zone.name=receipt.contact_timezone
 where receipt.evidence_kind='legacy_record' and (p_account is null or oc.account_id=p_account)
 and (public.icash_conservative_nanp_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12))

 and not exists(select 1 from public.icash_text_suppressions where phone=receipt.phone)
 and not exists(select 1 from public.icash_contact_suppressions where contact_key=receipt.contact_key)
 and not exists(select 1 from public.icash_operational_contacts old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and not exists(select 1 from public.icash_contact_permissions old where old.account_id=a.id and old.screening_id=s.id and old.phone=receipt.phone and old.revoked_at is not null)
 and ((not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='voice')
   and (public.icash_conservative_voice_window_supported(receipt.phone) or (zone.name is not null and length(trim(coalesce(receipt.timezone_source_reference,'')))>=12)))
  or not exists(select 1 from public.icash_operational_contacts prior where prior.account_id=oc.account_id and prior.screening_id=oc.screening_id and prior.phone=receipt.phone and prior.dnc_receipt_id=receipt.id and prior.source_hash=encode(sha256(convert_to(oc.result::text,'UTF8')),'hex') and prior.channel='sms'))
 )
 select distinct candidate.* from candidates candidate
 join public.icash_owner_contacts oc on oc.account_id=candidate.account_id and oc.screening_id=candidate.screening_id
 join public.icash_accounts a on a.id=candidate.account_id
 join public.icash_operation_spend spend on spend.operation_key=oc.operation_key and spend.account_id=oc.account_id
 join public.icash_dnc_verification_receipts receipt on receipt.id=candidate.dnc_id
 where (receipt.evidence_kind='legacy_record' or (
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
    and public.icash_dealmachine_saved_owner_result_valid(oc.result))))
 and public.icash_operational_source_phone(oc.result,receipt.phone)
 order by candidate.account_id,candidate.screening_id,candidate.dnc_id limit 100$new$;
begin
 definition:=pg_get_functiondef('public.icash_prepare_operational_contacts_before_dm_observations(uuid)'::regprocedure);
 if md5(definition)<>'f5cf10274a2bcc289a5e1d1149acd224'
  or md5(pg_get_functiondef('public.icash_operational_source_phone(jsonb,text)'::regprocedure))<>'8d0ad5753ae14838c26fcdecc58a1932'
  or length(definition)-length(replace(definition,old_query,''))<>length(old_query) then
  raise exception 'Preparation receipt binding prerequisite changed';
 end if;
 execute replace(definition,old_query,new_query);
end $patch$;
create index icash_dnc_clear_phone_expiry
 on public.icash_dnc_verification_receipts(phone,expires_at)
 where clear and revoked_at is null;
create index icash_dnc_clear_national_screening_expiry
 on public.icash_dnc_verification_receipts((observation_provenance->>'screeningId'),expires_at)
 where evidence_kind='national_provider_observation' and clear and revoked_at is null;
commit;
