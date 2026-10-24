-- Apply expensive SMS contact admission only after historical ticket and
-- provider-evidence exclusions. Preserve fair order, row locks and all guards.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;replacement text;
 original text:=$original$ select th.account_id,msg.id as message_id,history.attempt+1 as attempt into candidate
 from public.icash_seller_opener_assignments assignment
 join public.icash_text_messages msg on msg.id=assignment.message_id and msg.thread_id=assignment.thread_id and msg.account_id=assignment.account_id and msg.body=assignment.body
 join public.icash_text_threads th on th.id=msg.thread_id and th.account_id=msg.account_id
 join public.icash_accounts a on a.id=th.account_id and not a.bot_paused
 join public.icash_operation_rates rate on rate.id=th.sms_rate_id
 join public.icash_wallets wallet on wallet.account_id=a.id and wallet.balance_cents>0
 join public.icash_deal_files deal on deal.id=th.deal_id and deal.account_id=th.account_id and deal.stage='draft' and coalesce(deal.terms->>'practice','false')<>'true'
 join public.icash_screening_jobs sc on sc.id=deal.screening_id and sc.account_id=deal.account_id and sc.state='complete' and sc.result->'financialCheck'->>'status'='eligible' and sc.completed_at between now()-interval '24 hours' and now()
 join public.icash_timezone_names zone on zone.name=th.timezone
 cross join lateral(select count(*) as total,max(issue_attempts) as attempt from public.icash_automation_tickets where opener_message_id=msg.id) history
 cross join lateral(select * from public.icash_automation_tickets where opener_message_id=msg.id order by created_at desc,id desc limit 1) previous
 where msg.direction='outgoing' and msg.state='ready' and msg.provider_id is null and msg.last_delivery_at is null and msg.request_key=th.id and cardinality(msg.asset_ids)=0
 and assignment.delivered_at is null and assignment.first_reply_at is null and not assignment.opted_out
 and th.party='seller' and not th.paused and th.ai_mode='auto' and not th.sms_intake_pending
 and public.icash_outreach_sms_current(th.account_id) and public.icash_sms_thread_review_current(th.account_id,th.id,true)
 and public.icash_sms_outreach_window_current(th.account_id,th.id)
 and history.total between 1 and 2 and history.attempt between 1 and 2
 and previous.account_id=th.account_id and previous.kind='seller_opener'
 and ((previous.state='issued' and previous.expires_at<=now()) or (previous.state='held' and previous.outcome in ('expired','message_held','messaging_configuration_required','business_number_mismatch','business_number_verification_required')))
 and not exists(select 1 from public.icash_automation_tickets active where active.opener_message_id=msg.id and (active.state='consumed' or (active.state='issued' and active.expires_at>now()) or active.account_id<>th.account_id or active.kind<>'seller_opener'))
 and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||msg.id)
 and not exists(select 1 from public.icash_text_messages other where other.thread_id=th.id and other.id<>msg.id)
 and not exists(select 1 from public.icash_sms_inbound_invitations where message_id=msg.id or thread_id=th.id)
 and not exists(select 1 from public.icash_text_ai_jobs where outgoing_id=msg.id)
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=th.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual)
 order by previous.created_at,th.id for update of th,msg skip locked limit 1;$original$;
 gates text:=E' and public.icash_outreach_sms_current(th.account_id) and public.icash_sms_thread_review_current(th.account_id,th.id,true)\n and public.icash_sms_outreach_window_current(th.account_id,th.id)';
begin
 definition:=pg_get_functiondef('public.icash_recover_unstarted_seller_opener()'::regprocedure);
 if (length(definition)-length(replace(definition,original,'')))<>length(original)
  or (length(original)-length(replace(original,gates,'')))<>length(gates) then
  raise exception 'Unstarted opener selection prerequisite changed';
 end if;
 replacement:=' select ordered.account_id,ordered.message_id,ordered.attempt into candidate from ('||E'\n'||
  replace(replace(replace(original,
   'select th.account_id,msg.id as message_id,history.attempt+1 as attempt into candidate',
   'select th.account_id,th.id as thread_id,msg.id as message_id,history.attempt+1 as attempt'),gates,''),
   'for update of th,msg skip locked limit 1;',
   E'for update of th,msg skip locked offset 0\n ) ordered\n where public.icash_outreach_sms_current(ordered.account_id)\n and public.icash_sms_thread_review_current(ordered.account_id,ordered.thread_id,true)\n and public.icash_sms_outreach_window_current(ordered.account_id,ordered.thread_id)\n limit 1;');
 execute replace(definition,original,replacement);
end $migration$;
commit;

