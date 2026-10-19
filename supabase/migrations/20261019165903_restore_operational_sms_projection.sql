-- Restore the last working projector while preserving cross-property recipient protection.
begin;
set local lock_timeout='5s';
do $restore$
declare definition text; added text:=$exact_block$
  -- Automatic prospect draft handoff. No user save is needed to prepare the
  -- existing SMS workflow. This does not send, charge, record seller consent,
  -- accept an offer, or replace any existing draft or executed deal.
  if not public.icash_membership_work_allowed(c.account_id)
   or not exists(select 1 from public.icash_wallets w where w.account_id=c.account_id and w.balance_cents>0)
   or exists(select 1 from public.icash_billing_reviews b where b.account_id=c.account_id and b.resolved_at is null)
   then continue;end if;
  insert into public.icash_deal_files(account_id,screening_id,terms)
  select s.account_id,s.id,jsonb_build_object(
   'address',s.result->'property'->>'address','state',s.snapshot->'raw'->'data'->>'state',
   'buyer',i.principal,'seller','','priceCents',null,'priceSource','proposed')
  from public.icash_screening_jobs s
  join public.icash_customer_identities i on i.account_id=s.account_id and nullif(trim(i.principal),'') is not null
  where s.id=c.screening_id and s.account_id=c.account_id and s.state='complete'
   and s.snapshot->>'propertyType'='house' and s.snapshot->'sellerRequest' is null
   and coalesce(s.snapshot->>'practice','false')<>'true'
   and s.snapshot->>'propertyId'=s.result->'property'->>'propertyId'
   and nullif(trim(s.result->'property'->>'address'),'') is not null
   and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state')
   and s.result->'financialCheck'->>'status'='eligible'
   and s.completed_at between now()-interval '24 hours' and now()
   and case when pg_catalog.pg_input_is_valid(s.snapshot->>'fetchedAt','timestamp with time zone')
    then (s.snapshot->>'fetchedAt')::timestamptz between now()-interval '24 hours' and now() else false end
   and not exists(select 1 from public.icash_property_controls pc
    where pc.account_id=s.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   and not exists(select 1 from public.icash_handoffs h
    where h.account_id=s.account_id and h.screening_id=s.id and h.state<>'resolved')
   and not exists(select 1 from public.icash_deal_files existing
    where existing.account_id=s.account_id and existing.screening_id=s.id)
  -- A concurrent manual save wins unchanged. Never use the draft UPSERT here:
  -- it would replace customer terms if a save raced the missing-row check.
  on conflict(account_id,screening_id) do nothing;
$exact_block$;
begin
 definition:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,added,'')))/length(added)<>1 then raise exception 'Automatic SMS handoff restore boundary changed';end if;
 execute replace(definition,added,'');
end $restore$;
commit;
