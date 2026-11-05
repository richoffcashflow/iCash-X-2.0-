-- A settled contact whose every original phone belongs to another account's
-- current inventory cannot fill this account's new-work buffer. Projection only.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;replacement text;patched text;
begin
 d:=pg_get_functiondef('public.icash_pending_opportunity_count(uuid)'::regprocedure);
 if md5(d)<>'ff6c4426d808dfa8ee785e6068f28339'
  or md5(pg_get_functiondef('public.icash_operational_phone(text)'::regprocedure))<>'2b62a1db7f708fb6ed2b178cf98d6bbb' then
  raise exception 'Phone inventory buffer prerequisite changed';
 end if;
 needle:='  and not exists(select 1 from public.icash_deal_files d where d.account_id=s.account_id and d.screening_id=s.id and d.stage in';
 replacement:=$new$  -- Keep any uncertain purchase, unprepared original number or legacy route.
  -- Only explicit current cross-account phone claims remove a settled slot.
  and not exists(
   select 1 from public.icash_owner_contacts owned
   join public.icash_operation_spend spend on spend.account_id=owned.account_id and spend.operation_key=owned.operation_key
    and spend.operation_key='owners:'||owned.account_id||':'||owned.screening_id
    and spend.state='settled' and spend.settled_at is not null
   join public.icash_customer_identities identity on identity.account_id=owned.account_id and length(trim(identity.principal))>0
   cross join lateral (
    select count(*) phone_count,bool_and(
     public.icash_operational_phone(source_phone.value->>'number') is not null
     and coalesce(owned.result->'requestedPersonIds' ? (source_person.value->>'personId'),false)
     and exists(select 1 from public.icash_operational_contacts contact
      where contact.account_id=owned.account_id and contact.screening_id=owned.screening_id
       and contact.source_hash=encode(sha256(convert_to(owned.result::text,'UTF8')),'hex')
       and contact.sending_principal=identity.principal and contact.channel in ('voice','sms')
       and contact.phone=public.icash_operational_phone(source_phone.value->>'number')
       and contact.revoked_at is null and contact.eligibility_until>now())
     and exists(select 1 from public.icash_inventory_claims claim
      where claim.resource_key='phone:'||encode(sha256(convert_to(public.icash_operational_phone(source_phone.value->>'number'),'UTF8')),'hex')
       and claim.account_id<>owned.account_id and claim.cooldown_until>now())
    ) all_blocked
    from jsonb_array_elements(case when jsonb_typeof(owned.result->'contacts')='array' then owned.result->'contacts' else '[]'::jsonb end) source_person
    cross join lateral jsonb_array_elements(case when jsonb_typeof(source_person.value->'phones')='array' then source_person.value->'phones' else '[]'::jsonb end) source_phone
    where source_person.value->'likelyOwner'='true'::jsonb and source_phone.value->'doNotCall' is distinct from 'true'::jsonb
   ) phones
   where owned.account_id=s.account_id and owned.screening_id=s.id and s.snapshot->'sellerRequest' is null
    and owned.result->>'propertyId'=s.snapshot->>'propertyId'
    and phones.phone_count>0 and phones.all_blocked is true
    and not exists(select 1 from jsonb_array_elements(case when jsonb_typeof(owned.result->'contacts')='array' then owned.result->'contacts' else '[]'::jsonb end) source_person
     where source_person.value->'likelyOwner'='true'::jsonb and (jsonb_typeof(source_person.value->'phones') is distinct from 'array' or source_person.value->'phones'='[]'::jsonb))
    and not exists(select 1 from public.icash_operational_contacts alternative
     where alternative.account_id=s.account_id and alternative.screening_id=s.id
      and alternative.sending_principal=identity.principal and alternative.channel in ('voice','sms')
      and alternative.revoked_at is null and alternative.eligibility_until>now()
      and not exists(select 1 from public.icash_inventory_claims claim
       where claim.resource_key='phone:'||encode(sha256(convert_to(alternative.phone,'UTF8')),'hex')
        and claim.account_id<>s.account_id and claim.cooldown_until>now()))
    and not exists(select 1 from public.icash_contact_permissions permission
     where permission.account_id=s.account_id and permission.screening_id=s.id
      and permission.revoked_at is null and permission.permission_until>now())
    and not exists(select 1 from public.icash_operation_spend held
     join public.icash_screening_jobs prior on held.operation_key='owners:'||s.account_id||':'||prior.id
      and prior.account_id=s.account_id and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId'
     where held.account_id=s.account_id and held.state in ('reserved','dispatched'))
  )
  and not exists(select 1 from public.icash_deal_files d where d.account_id=s.account_id and d.screening_id=s.id and d.stage in$new$;
 if length(d)-length(replace(d,needle,''))<>length(needle) then
  raise exception 'Phone inventory buffer insertion point changed';
 end if;
 patched:=replace(d,needle,replacement);
 execute patched;
 if pg_get_functiondef('public.icash_pending_opportunity_count(uuid)'::regprocedure)<>patched then
  raise exception 'Phone inventory buffer verification failed';
 end if;
end $patch$;
commit;
