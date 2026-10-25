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
