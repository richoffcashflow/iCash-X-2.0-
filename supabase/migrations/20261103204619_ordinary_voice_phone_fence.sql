-- Avoid capacity scans for ordinary calls already blocked by phone spacing.
-- Both original guards, fairness ordering, row locks and final LIMIT remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
select 1 from public.icash_operating_budget where id=1 for update;
do $patch$
declare d text;old_query text:=$old$ select candidate.* into j from (
 select v.* from public.icash_voice_jobs v join public.icash_accounts a on a.id=v.account_id and not a.bot_paused join public.icash_voice_configs c on c.account_id=a.id and c.enabled
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 left join lateral(
  select recent.created_at from public.icash_automation_tickets recent
  where recent.account_id=v.account_id and recent.kind='voice_dispatch'
  order by recent.created_at desc limit 1
 ) last_ticket on true
 where v.state='ready' and v.due_at<=now()
 and exists(select 1 from public.icash_voice_contact_targets current_target
  where current_target.id=coalesce(v.permission_id,v.operational_contact_id) and current_target.account_id=v.account_id
   and ((v.permission_id is not null and v.operational_contact_id is null and current_target.eligibility_source='operator_record')
    or (v.permission_id is null and v.operational_contact_id is not null and current_target.eligibility_source='operational_checks_only'))
   and current_target.revoked_at is null and current_target.permission_until>now()
   and (public.icash_outreach_window_open(current_target.timezone,
    case when v.operational_contact_id is not null then (select timezone_basis from public.icash_operational_contacts
     where id=v.operational_contact_id and account_id=v.account_id and channel='voice') end,clock_timestamp()) or public.icash_owner_demo_call_current(v.account_id,v.id)))
 and not (v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
  and v.operational_contact_id is null and v.meta_offer_lead_id is null and v.meta_followup_lead_id is null
  and exists(select 1 from public.icash_meta_leads m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
   where m.account_id=v.account_id and (m.voice_job_id=v.id
    or m.voice_job_id is null and exists(select 1 from public.icash_contact_permissions p
     where p.id=v.permission_id and p.account_id=m.account_id and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id))))
 order by last_ticket.created_at asc nulls first,v.due_at,v.id for update of v skip locked offset 0
 ) candidate
 where icash_recording_private.voice_queue_slot_from_snapshot(candidate.account_id,candidate.id,capacity_snapshot)
 and public.icash_seller_phone_call_current(candidate.account_id,candidate.id)
 limit 1;$old$;
new_query text:=$new$ select permitted.* into j from (
 select candidate.* from (
 select v.* from public.icash_voice_jobs v join public.icash_accounts a on a.id=v.account_id and not a.bot_paused join public.icash_voice_configs c on c.account_id=a.id and c.enabled
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 left join lateral(
  select recent.created_at from public.icash_automation_tickets recent
  where recent.account_id=v.account_id and recent.kind='voice_dispatch'
  order by recent.created_at desc limit 1
 ) last_ticket on true
 where v.state='ready' and v.due_at<=now()
 and exists(select 1 from public.icash_voice_contact_targets current_target
  where current_target.id=coalesce(v.permission_id,v.operational_contact_id) and current_target.account_id=v.account_id
   and ((v.permission_id is not null and v.operational_contact_id is null and current_target.eligibility_source='operator_record')
    or (v.permission_id is null and v.operational_contact_id is not null and current_target.eligibility_source='operational_checks_only'))
   and current_target.revoked_at is null and current_target.permission_until>now()
   and (public.icash_outreach_window_open(current_target.timezone,
    case when v.operational_contact_id is not null then (select timezone_basis from public.icash_operational_contacts
     where id=v.operational_contact_id and account_id=v.account_id and channel='voice') end,clock_timestamp()) or public.icash_owner_demo_call_current(v.account_id,v.id)))
 and not (v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
  and v.operational_contact_id is null and v.meta_offer_lead_id is null and v.meta_followup_lead_id is null
  and exists(select 1 from public.icash_meta_leads m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
   where m.account_id=v.account_id and (m.voice_job_id=v.id
    or m.voice_job_id is null and exists(select 1 from public.icash_contact_permissions p
     where p.id=v.permission_id and p.account_id=m.account_id and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id))))
 order by last_ticket.created_at asc nulls first,v.due_at,v.id for update of v skip locked offset 0
 ) candidate
 where public.icash_seller_phone_call_current(candidate.account_id,candidate.id) offset 0
 ) permitted
 where icash_recording_private.voice_queue_slot_from_snapshot(permitted.account_id,permitted.id,capacity_snapshot)
 limit 1;$new$;
begin
 d:=pg_get_functiondef('public.icash_issue_ready_voice_ticket()'::regprocedure);
 if md5(d)<>'c74e1cd9d71c715923d185189e26b4c2'
  or (length(d)-length(replace(d,old_query,'')))<>length(old_query) then
  raise exception 'Ordinary voice phone fence prerequisite changed';
 end if;
 execute replace(d,old_query,new_query);
end $patch$;
commit;
