set local lock_timeout='1s';
do $migration$
begin
 if md5(pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure)) <> 'aee7da632d686fdb081289328ed1b03c' then raise exception 'Outreach wait function changed'; end if;
end
$migration$;
CREATE OR REPLACE FUNCTION public.icash_research_waiting_on_outreach(p_account uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select (case when exists(
  select 1 from public.icash_voice_jobs possible
  where possible.account_id=p_account
   and (possible.state in ('ready','issued') or (possible.state='held' and possible.outcome='prospecting_budget_held'))
   and possible.callback_id is null and possible.sms_source_message_id is null and possible.cancellation_notice_id is null
   and possible.provider_call_sid is null and possible.conversation_id is null and possible.operation_key is null
   and possible.due_at<=now()
 ) then case when public.icash_outreach_voice_current(p_account) and exists(
  select 1 from (
  select j.account_id,j.id as job_id,p.screening_id,p.phone from public.icash_voice_jobs j
  join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
  join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id
  where j.account_id=p_account and p.party='seller' and s.state='complete'
   and s.snapshot->'sellerRequest' is null and s.result->'financialCheck'->>'status'='eligible'
   and (j.state in ('ready','issued') or (j.state='held' and j.outcome='prospecting_budget_held'))
   and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null
   and j.provider_call_sid is null and j.conversation_id is null and j.operation_key is null
   and p.revoked_at is null and p.permission_until>now() and p.dnc_clear
   and j.due_at<=now()
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=p.phone)
   and not exists(select 1 from public.icash_contact_suppressions x where x.contact_key=p.contact_key)
   and not exists(select 1 from public.icash_property_controls x where x.account_id=s.account_id and x.property_id=s.snapshot->>'propertyId' and x.manual)
   and not exists(select j.account_id,j.id as job_id,p.screening_id,p.phone from public.icash_voice_jobs prior join public.icash_voice_contact_targets pp
    on pp.id=coalesce(prior.permission_id,prior.operational_contact_id) and pp.account_id=prior.account_id
    where prior.account_id=j.account_id and pp.screening_id=p.screening_id and pp.party='seller'
     and (prior.provider_call_sid is not null or prior.conversation_id is not null))
   offset 0
  ) candidate where public.icash_voice_outreach_hours_current(candidate.account_id,candidate.job_id)
   and public.icash_seller_phone_call_current(candidate.account_id,candidate.job_id)
   and public.icash_cold_inventory_available(candidate.account_id,candidate.screening_id,candidate.phone)
 ) then public.icash_outgoing_voice_capacity_open() else false end else false end) or (public.icash_outreach_sms_current(p_account) and exists(
  select 1 from (
  select t.account_id,t.id as thread_id,s.id as screening_id,t.recipient from public.icash_text_threads t
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
   and not exists(select 1 from public.icash_text_suppressions x where x.phone=t.recipient)
   and not exists(select 1 from public.icash_property_controls x where x.account_id=s.account_id and x.property_id=s.snapshot->>'propertyId' and x.manual)
   and not exists(select 1 from public.icash_text_messages prior where prior.account_id=t.account_id and prior.thread_id=t.id and prior.provider_id is not null)
   offset 0
  ) candidate where public.icash_sms_outreach_window_current(candidate.account_id,candidate.thread_id)
   and public.icash_cold_inventory_available(candidate.account_id,candidate.screening_id,candidate.recipient)
 ));
$function$
;
