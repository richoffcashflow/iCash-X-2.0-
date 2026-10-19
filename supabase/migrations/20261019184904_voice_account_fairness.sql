-- Share ordinary voice dispatch slots across funded accounts, without increasing
-- the existing global30-second limit or changing dispatch admission.
-- Current requested callbacks/received call-now requests and validated contract
-- cancellations retain priority. Receipt checks run only for those job sources.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index icash_automation_voice_account_recent
 on public.icash_automation_tickets(account_id,created_at desc) where kind='voice_dispatch';
do $migration$
declare definition text;original_selection text:=$original$ select v.* into j from public.icash_voice_jobs v join public.icash_accounts a on a.id=v.account_id and not a.bot_paused join public.icash_voice_configs c on c.account_id=a.id and c.enabled
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 where v.state='ready' and v.due_at<=now()
 and not (v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
  and v.operational_contact_id is null and v.meta_offer_lead_id is null and v.meta_followup_lead_id is null
  and exists(select 1 from public.icash_meta_leads m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
   where m.account_id=v.account_id and (m.voice_job_id=v.id
    or m.voice_job_id is null and exists(select 1 from public.icash_contact_permissions p
     where p.id=v.permission_id and p.account_id=m.account_id and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id))))
 order by v.due_at for update of v skip locked limit 1$original$;
 replacement_selection text:=$replacement$ select v.* into j from public.icash_voice_jobs v join public.icash_accounts a on a.id=v.account_id and not a.bot_paused join public.icash_voice_configs c on c.account_id=a.id and c.enabled
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 where v.state='ready' and v.due_at<=now()
 and not (v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
  and v.operational_contact_id is null and v.meta_offer_lead_id is null and v.meta_followup_lead_id is null
  and exists(select 1 from public.icash_meta_leads m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
   where m.account_id=v.account_id and (m.voice_job_id=v.id
    or m.voice_job_id is null and exists(select 1 from public.icash_contact_permissions p
     where p.id=v.permission_id and p.account_id=m.account_id and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id))))
 and case
  when v.sms_source_message_id is not null then public.icash_requested_seller_call_current(v.account_id,v.id)
  when v.callback_id is not null then exists(
   select 1 from public.icash_live_callbacks cb
   join public.icash_live_conversations call on call.id=cb.conversation_id and call.account_id=cb.account_id
   join public.icash_voice_contact_targets target on target.id=coalesce(v.permission_id,v.operational_contact_id)
    and target.account_id=v.account_id and target.party='seller'
    and ((v.permission_id is not null and v.operational_contact_id is null and target.eligibility_source='operator_record')
     or (v.permission_id is null and v.operational_contact_id is not null and target.eligibility_source='operational_checks_only'))
   where cb.id=v.callback_id and cb.account_id=v.account_id and cb.screening_id=target.screening_id
    and cb.state='pending_dispatch_review' and cb.due_at=v.due_at and cb.due_at between now()-interval '15 minutes' and now()
    and call.screening_id=cb.screening_id and call.contact_key=target.contact_key and call.party='seller'
    and call.state='complete' and call.completed_at<=now() and public.icash_call_has_seller_response(call.result)
    and case when pg_catalog.pg_input_is_valid(call.result->>'callbackDueAt','timestamp with time zone')
     then (call.result->>'callbackDueAt')::timestamptz=cb.due_at else false end)
  when v.cancellation_notice_id is not null then public.icash_cancellation_voice_current(v.account_id,'voice:'||v.id)
  else false end
 order by v.due_at,v.id for update of v skip locked limit 1;
 if not found then
 select v.* into j from public.icash_voice_jobs v join public.icash_accounts a on a.id=v.account_id and not a.bot_paused join public.icash_voice_configs c on c.account_id=a.id and c.enabled
 join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents
 left join lateral(
  select recent.created_at from public.icash_automation_tickets recent
  where recent.account_id=v.account_id and recent.kind='voice_dispatch'
  order by recent.created_at desc limit 1
 ) last_ticket on true
 where v.state='ready' and v.due_at<=now()
 and not (v.callback_id is null and v.sms_source_message_id is null and v.cancellation_notice_id is null
  and v.operational_contact_id is null and v.meta_offer_lead_id is null and v.meta_followup_lead_id is null
  and exists(select 1 from public.icash_meta_leads m
   join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id and s.state='awaiting_address'
   where m.account_id=v.account_id and (m.voice_job_id=v.id
    or m.voice_job_id is null and exists(select 1 from public.icash_contact_permissions p
     where p.id=v.permission_id and p.account_id=m.account_id and p.screening_id=m.screening_id and p.seller_intake_id=m.lead_id))))
 order by last_ticket.created_at asc nulls first,v.due_at,v.id for update of v skip locked limit 1;
 end if$replacement$;
begin
 definition:=pg_get_functiondef('public.icash_next_before_fulfillment()'::regprocedure);
 if (length(definition)-length(replace(definition,original_selection,'')))<>length(original_selection) then
  raise exception 'Voice account fairness prerequisite changed';
 end if;
 execute replace(definition,original_selection,replacement_selection);
end $migration$;
commit;
