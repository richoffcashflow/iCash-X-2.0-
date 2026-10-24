-- Only eligible, unattempted outreach may delay buying more research.
-- Exclude cheap historical/contact/ownership holds before running the same
-- time-window, repeat-contact and cold-inventory predicates. No admission changes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;replacement text;selection text;i integer;
 originals text[]:=array[
$voice$  select 1 from public.icash_voice_jobs j
  join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
  join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id
  where j.account_id=p_account and p.party='seller' and s.state='complete'
   and s.snapshot->'sellerRequest' is null and s.result->'financialCheck'->>'status'='eligible'
   and (j.state in ('ready','issued') or (j.state='held' and j.outcome='prospecting_budget_held'))
   and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null
   and j.provider_call_sid is null and j.conversation_id is null and j.operation_key is null
   and p.revoked_at is null and p.permission_until>now() and p.dnc_clear
   and j.due_at<=now()
   and public.icash_voice_outreach_hours_current(j.account_id,j.id)
   and public.icash_seller_phone_call_current(j.account_id,j.id)
   and public.icash_cold_inventory_available(j.account_id,p.screening_id,p.phone)
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=p.phone)
   and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=p.contact_key)
   and not exists(select 1 from public.icash_property_controls x where x.account_id=s.account_id and x.property_id=s.snapshot->>'propertyId' and x.manual)
   and not exists(select 1 from public.icash_voice_jobs prior join public.icash_voice_contact_targets pp
    on pp.id=coalesce(prior.permission_id,prior.operational_contact_id) and pp.account_id=prior.account_id
    where prior.account_id=j.account_id and pp.screening_id=p.screening_id and pp.party='seller'
     and (prior.provider_call_sid is not null or prior.conversation_id is not null))$voice$,
$sms$  select 1 from public.icash_text_threads t
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where t.account_id=p_account and t.party='seller' and not t.paused and not t.manual_only and t.retired_at is null
   and s.state='complete' and s.snapshot->'sellerRequest' is null and s.result->'financialCheck'->>'status'='eligible'
   and coalesce(t.eligibility_until,t.permission_until)>now() and m.direction='outgoing' and m.state='ready'
   and m.customer_author_id is null and m.provider_id is null and m.last_delivery_at is null
   and not exists(select 1 from public.icash_automation_tickets held
    where held.account_id=m.account_id and held.opener_message_id=m.id
     and ((held.state='held' and held.outcome='held_for_reconciliation')
      or (held.kind='seller_opener' and held.state='consumed' and held.expires_at<now()-interval '5 minutes')))
   and public.icash_sms_outreach_window_current(t.account_id,t.id)
   and public.icash_cold_inventory_available(t.account_id,s.id,t.recipient)
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
   and not exists(select 1 from public.icash_property_controls x where x.account_id=s.account_id and x.property_id=s.snapshot->>'propertyId' and x.manual)
   and not exists(select 1 from public.icash_text_messages prior where prior.account_id=t.account_id and prior.thread_id=t.id and prior.provider_id is not null)$sms$];
 gates text[]:=array[
E'\n   and public.icash_voice_outreach_hours_current(j.account_id,j.id)\n   and public.icash_seller_phone_call_current(j.account_id,j.id)\n   and public.icash_cold_inventory_available(j.account_id,p.screening_id,p.phone)',
E'\n   and public.icash_sms_outreach_window_current(t.account_id,t.id)\n   and public.icash_cold_inventory_available(t.account_id,s.id,t.recipient)'];
begin
 definition:=pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure);
 for i in 1..2 loop
  selection:=originals[i];
  if (length(definition)-length(replace(definition,selection,'')))<>length(selection)
   or (length(selection)-length(replace(selection,gates[i],'')))<>length(gates[i]) then
   raise exception 'Research waiting selection prerequisite changed';
  end if;
  if i=1 then
   replacement:='  select 1 from ('||E'\n'||
    replace(replace(selection,'select 1 from public.icash_voice_jobs','select j.account_id,j.id as job_id,p.screening_id,p.phone from public.icash_voice_jobs'),gates[i],'')||
    E'\n   offset 0\n  ) candidate where public.icash_voice_outreach_hours_current(candidate.account_id,candidate.job_id)\n   and public.icash_seller_phone_call_current(candidate.account_id,candidate.job_id)\n   and public.icash_cold_inventory_available(candidate.account_id,candidate.screening_id,candidate.phone)';
  else
   replacement:='  select 1 from ('||E'\n'||
    replace(replace(selection,'select 1 from public.icash_text_threads','select t.account_id,t.id as thread_id,s.id as screening_id,t.recipient from public.icash_text_threads'),gates[i],'')||
    E'\n   offset 0\n  ) candidate where public.icash_sms_outreach_window_current(candidate.account_id,candidate.thread_id)\n   and public.icash_cold_inventory_available(candidate.account_id,candidate.screening_id,candidate.recipient)';
  end if;
  definition:=replace(definition,selection,replacement);
 end loop;
 execute definition;
end $migration$;
commit;

