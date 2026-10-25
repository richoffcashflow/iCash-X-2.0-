-- Raise bounded aggregate opener capacity while excluding old conversations
-- before expensive admission. The locked read repeats every original guard.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;signature text;
 original text:=$original$ select th.* into t from public.icash_text_threads th join public.icash_accounts a on a.id=th.account_id and not a.bot_paused join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true' join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id and sc.state='complete' and sc.result->'financialCheck'->>'status'='eligible' and sc.completed_at between now()-interval '24 hours' and now() join public.icash_timezone_names tz on tz.name=th.timezone
 where public.icash_outreach_sms_current(th.account_id) and not exists(select 1 from public.icash_property_controls pc where pc.account_id=th.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual) and th.party='seller' and not th.paused and th.ai_mode='auto' and public.icash_sms_thread_dispatch_until(th.account_id,th.id)>now() and public.icash_sms_outreach_window_current(th.account_id,th.id) and not exists(select 1 from public.icash_text_suppressions s where s.phone=th.recipient)
 and (not exists(select 1 from public.icash_text_messages where thread_id=th.id) or exists(select 1 from public.icash_sms_inbound_invitations i join public.icash_text_messages msg on msg.id=i.message_id and msg.state='ready' where i.thread_id=th.id and i.expires_at>now() and not exists(select 1 from public.icash_automation_tickets old where old.opener_message_id=msg.id))) order by th.id for update of th skip locked limit 1$original$;
 replacement text:=$replacement$ with candidates as materialized (
 select th.id,th.account_id from public.icash_text_threads th join public.icash_accounts a on a.id=th.account_id and not a.bot_paused join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true' join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id and sc.state='complete' and sc.result->'financialCheck'->>'status'='eligible' and sc.completed_at between now()-interval '24 hours' and now() join public.icash_timezone_names tz on tz.name=th.timezone
 where not exists(select 1 from public.icash_property_controls pc where pc.account_id=th.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual) and th.party='seller' and not th.paused and th.ai_mode='auto' and not exists(select 1 from public.icash_text_suppressions s where s.phone=th.recipient)
 and (not exists(select 1 from public.icash_text_messages where thread_id=th.id) or exists(select 1 from public.icash_sms_inbound_invitations i join public.icash_text_messages msg on msg.id=i.message_id and msg.state='ready' where i.thread_id=th.id and i.expires_at>now() and not exists(select 1 from public.icash_automation_tickets old where old.opener_message_id=msg.id)))
 )
 select th.* into t from candidates candidate join public.icash_text_threads th on th.id=candidate.id and th.account_id=candidate.account_id join public.icash_accounts a on a.id=th.account_id and not a.bot_paused join public.icash_wallets w on w.account_id=a.id and w.balance_cents>w.reserved_cents join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true' join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id and sc.state='complete' and sc.result->'financialCheck'->>'status'='eligible' and sc.completed_at between now()-interval '24 hours' and now() join public.icash_timezone_names tz on tz.name=th.timezone
 where public.icash_outreach_sms_current(candidate.account_id) and not exists(select 1 from public.icash_property_controls pc where pc.account_id=th.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual) and th.party='seller' and not th.paused and th.ai_mode='auto' and public.icash_sms_thread_dispatch_until(candidate.account_id,candidate.id)>now() and public.icash_sms_outreach_window_current(candidate.account_id,candidate.id) and not exists(select 1 from public.icash_text_suppressions s where s.phone=th.recipient)
 and (not exists(select 1 from public.icash_text_messages where thread_id=th.id) or exists(select 1 from public.icash_sms_inbound_invitations i join public.icash_text_messages msg on msg.id=i.message_id and msg.state='ready' where i.thread_id=th.id and i.expires_at>now() and not exists(select 1 from public.icash_automation_tickets old where old.opener_message_id=msg.id))) order by th.id for update of th skip locked limit 1$replacement$;
 cadence_old text:=$old$kind='seller_opener' and created_at>now()-interval '5 seconds'$old$;
 cadence_new text:=$new$kind='seller_opener' and created_at>now()-interval '1 second'$new$;
begin
 definition:=pg_get_functiondef('public.icash_next_before_unstarted_sms_recovery()'::regprocedure);
 if (length(definition)-length(replace(definition,original,'')))<>length(original) then
  raise exception 'Fresh SMS selection prerequisite changed';
 end if;
 execute replace(definition,original,replacement);
 foreach signature in array array[
  'public.icash_recover_unstarted_seller_opener()',
  'public.icash_next_before_operational_sms()',
  'public.icash_next_before_unstarted_sms_recovery()',
  'public.icash_next_before_sms_inbound_campaign()'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,cadence_old,'')))<>length(cadence_old)
   or position('pg_advisory_xact_lock(726341927)' in definition)=0 then
   raise exception 'Seller volume cadence prerequisite changed: %',signature;
  end if;
  execute replace(definition,cadence_old,cadence_new);
 end loop;
end $migration$;
commit;

-- New outbound calls stay inside the current 9 AM–9 PM window even when
-- there was an earlier conversation or callback. Inbound and already-started
-- calls retain their existing processing; SMS has its independent reply rule.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;
 context_old text:=$context$ active:=public.icash_outreach_active_conversation(p_account,p.screening_id,p.phone,stamp)
  -- Preserve the dedicated, currently permitted contract-cancellation workflow.
  -- A job flag alone is not enough: its existing admission verifies the notice,
  -- agreement, property, recipient, account controls and contact evidence.
  or (j.cancellation_notice_id is not null and public.icash_cancellation_voice_current(p_account,'voice:'||j.id))
  or exists(select 1 from public.icash_live_callbacks cb
   join public.icash_live_conversations call on call.id=cb.conversation_id and call.account_id=cb.account_id
    and call.screening_id=cb.screening_id and call.contact_key=p.contact_key and call.party='seller' and call.state='complete'
   where cb.id=j.callback_id and cb.account_id=p_account and cb.screening_id=p.screening_id
    and cb.state='pending_dispatch_review' and cb.due_at between stamp-interval '15 minutes' and stamp
    and call.completed_at<=stamp and public.icash_call_has_seller_response(call.result)
    and case when pg_catalog.pg_input_is_valid(call.result->>'callbackDueAt','timestamp with time zone')
     then (call.result->>'callbackDueAt')::timestamptz=cb.due_at else false end);
$context$;
 hours_old text:=$hours$ return coalesce((context->>'activeConversation')::boolean,false)
  or public.icash_outreach_window_open(context->>'timezone',null,clock_timestamp());$hours$;
begin
 definition:=pg_get_functiondef('public.icash_voice_outreach_context(uuid,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,context_old,'')))<>length(context_old) then
  raise exception 'Voice context hours prerequisite changed';
 end if;
 execute replace(definition,context_old,E' active:=false; -- A prior response is not an overnight outbound-call permission.\n');
 definition:=pg_get_functiondef('public.icash_voice_outreach_hours_current(uuid,uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,hours_old,'')))<>length(hours_old) then
  raise exception 'Voice final hours prerequisite changed';
 end if;
 execute replace(definition,hours_old,$new$ return public.icash_outreach_window_open(context->>'timezone',null,clock_timestamp());$new$);
end $migration$;
commit;
