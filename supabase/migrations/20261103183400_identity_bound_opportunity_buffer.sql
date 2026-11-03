-- Count usable pending work without relabeling contacts from an old identity.
-- Only a settled result with exact old-principal provenance can leave this
-- projection. Original contacts, purchases, permission and money stay unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_pending_opportunity_count(uuid)'::regprocedure);
 if md5(d)<>'773e9a966f406d08e33ce1f23b516560' then
  raise exception 'Identity-bound buffer prerequisite changed';
 end if;
 needle:='  and not exists(select 1 from public.icash_deal_files d where d.account_id=s.account_id and d.screening_id=s.id and d.stage in';
 replacement:=$new$  -- Changed sending identity is not fresh outreach inventory. Keep an
  -- unknown purchase, an alternative permission or any current-identity record
  -- in the buffer; absence of prepared operational evidence is not a failure.
  and not exists(
   select 1 from public.icash_owner_contacts owned
   join public.icash_operation_spend spend on spend.account_id=owned.account_id and spend.operation_key=owned.operation_key
    and spend.operation_key='owners:'||owned.account_id||':'||owned.screening_id
    and spend.state='settled' and spend.settled_at is not null
   join public.icash_customer_identities identity on identity.account_id=owned.account_id and length(trim(identity.principal))>0
   where owned.account_id=s.account_id and owned.screening_id=s.id and owned.result->>'propertyId'=s.snapshot->>'propertyId'
    and exists(select 1 from public.icash_operational_contacts old_contact
     where old_contact.account_id=s.account_id and old_contact.screening_id=s.id
      and old_contact.source_hash=encode(sha256(convert_to(owned.result::text,'UTF8')),'hex')
      and length(trim(old_contact.sending_principal))>0 and old_contact.sending_principal is distinct from identity.principal)
    and not exists(select 1 from public.icash_operational_contacts current_contact
     where current_contact.account_id=s.account_id and current_contact.screening_id=s.id
      and current_contact.source_hash=encode(sha256(convert_to(owned.result::text,'UTF8')),'hex')
      and current_contact.sending_principal=identity.principal)
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
  raise exception 'Identity-bound buffer insertion point changed';
 end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
