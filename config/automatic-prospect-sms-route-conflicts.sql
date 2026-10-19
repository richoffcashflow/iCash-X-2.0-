-- Re-enable automatic draft preparation only for a usable, unambiguous SMS route.
-- Keep the deployed property/recipient binding trigger unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create function public.icash_prospect_sms_route_available(p_account uuid,p_screening uuid,p_phone text,p_sender text)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_text_senders sender
 where sender.enabled and sender.phone=p_sender
  and not public.icash_text_role_conflict(sender.phone,p_phone)
  and not exists(select 1 from public.icash_sms_routes route
   where route.sender=sender.phone and route.recipient=p_phone and route.account_id<>p_account)
  and not exists(select 1 from public.icash_text_threads th
   join public.icash_deal_files df on df.id=th.deal_id and df.account_id=th.account_id
   where th.sender=sender.phone and th.recipient=p_phone and th.retired_at is null
    and not exists(select 1 from public.icash_owner_buyer_tests test where test.thread_id=th.id)
    and (th.account_id<>p_account or th.party<>'seller' or df.screening_id<>p_screening)));
$$;
revoke all on function public.icash_prospect_sms_route_available(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_prospect_sms_route_available(uuid,uuid,text,text) to service_role;
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 needle:='  -- A source with two live property bindings must be resolved rather than picked.';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  or position('Automatic prospect draft handoff' in definition)>0 then
  raise exception 'Operational SMS draft boundary changed';
 end if;
 execute replace(definition,needle,$body$
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
$body$||needle);
end $patch$;

-- Filter conflicts before the bounded scan, then recheck the selected sender
-- under the existing recipient lock before creating any draft or thread.
do $routing$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_project_operational_sms_contacts(uuid)'::regprocedure);
 needle:='  order by oc.account_id,oc.phone,oc.id limit 100';
 if position(needle in definition)=0 then raise exception 'Operational SMS candidate boundary changed';end if;
 definition:=replace(definition,needle,'   and public.icash_prospect_sms_route_available(oc.account_id,oc.screening_id,oc.phone,public.icash_property_text_sender(oc.account_id,(select existing.id from public.icash_deal_files existing where existing.account_id=oc.account_id and existing.screening_id=oc.screening_id),oc.phone))'||chr(10)||needle);
 needle:='  -- Automatic prospect draft handoff.';
 if position(needle in definition)=0 then raise exception 'Automatic prospect draft boundary changed';end if;
 definition:=replace(definition,needle,$guard$  select id into deal from public.icash_deal_files where account_id=c.account_id and screening_id=c.screening_id;
  v_sender:=public.icash_property_text_sender(c.account_id,deal,c.phone);
  if v_sender is null or not public.icash_prospect_sms_route_available(c.account_id,c.screening_id,c.phone,v_sender) then continue;end if;
$guard$||needle);
 needle:='  v_sender:=public.icash_property_text_sender(c.account_id,deal,c.phone);if v_sender is null then continue;end if;checked:=clock_timestamp();';
 if position(needle in definition)=0 then raise exception 'Operational SMS sender boundary changed';end if;
 execute replace(definition,needle,'  checked:=clock_timestamp();');
end $routing$;
commit;
