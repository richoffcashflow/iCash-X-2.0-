-- Avoid revalidating contacts that already have a first-call/callback job.
-- The materialization boundary contains no LIMIT; every original admission
-- predicate still precedes the ordered batch limit and final locked recheck.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $migration$
declare definition text;original_first text:=$first$
select op.* from public.icash_operational_contacts op
 join public.icash_accounts a on a.id=op.account_id and not a.bot_paused
 join public.icash_voice_configs cfg on cfg.account_id=op.account_id and cfg.enabled and cfg.reviewed_until>now()
 join public.icash_screening_jobs s on s.id=op.screening_id and s.account_id=op.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
 where public.icash_outreach_voice_current(op.account_id) and op.channel='voice' and op.revoked_at is null and op.eligibility_until>now()
 and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))
 and not exists(select 1 from public.icash_contact_permissions legacy where legacy.account_id=op.account_id and legacy.screening_id=op.screening_id and legacy.phone=op.phone)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=op.account_id and campaign.mode='sms_inbound')
 and not exists(select 1 from public.icash_voice_jobs prior join public.icash_voice_contact_targets target on target.id=coalesce(prior.permission_id,prior.operational_contact_id)
  where prior.account_id=op.account_id and target.account_id=op.account_id and target.screening_id=op.screening_id and target.contact_key=op.contact_key and prior.callback_id is null)
 order by op.created_at,op.id limit 100
$first$;replacement_first text:=$first_new$
with candidates as materialized (
 select op.* from public.icash_operational_contacts op
 join public.icash_accounts a on a.id=op.account_id and not a.bot_paused
 join public.icash_voice_configs cfg on cfg.account_id=op.account_id and cfg.enabled and cfg.reviewed_until>now()
 join public.icash_screening_jobs s on s.id=op.screening_id and s.account_id=op.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
 where public.icash_outreach_voice_current(op.account_id) and op.channel='voice' and op.revoked_at is null and op.eligibility_until>now()
 and not exists(select 1 from public.icash_contact_permissions legacy where legacy.account_id=op.account_id and legacy.screening_id=op.screening_id and legacy.phone=op.phone)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=op.account_id and campaign.mode='sms_inbound')
 and not exists(select 1 from public.icash_voice_jobs prior join public.icash_voice_contact_targets target on target.id=coalesce(prior.permission_id,prior.operational_contact_id)
  where prior.account_id=op.account_id and target.account_id=op.account_id and target.screening_id=op.screening_id and target.contact_key=op.contact_key and prior.callback_id is null)
 ) select op.* from candidates op
 where (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))
 order by op.created_at,op.id limit 100
$first_new$;original_callback text:=$callback$
select cb.id,cb.account_id,cb.due_at,op.id as target_id from public.icash_live_callbacks cb
 join public.icash_live_conversations call on call.id=cb.conversation_id and call.account_id=cb.account_id and call.state='complete' and (call.result->>'callbackDueAt')::timestamptz=cb.due_at
 join public.icash_operational_contacts op on op.account_id=cb.account_id and op.screening_id=cb.screening_id and op.contact_key=call.contact_key and op.channel='voice'
 where public.icash_outreach_voice_current(cb.account_id) and call.party='seller' and cb.state='pending_dispatch_review' and cb.due_at>now()-interval '15 minutes'
 and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))
 and not exists(select 1 from public.icash_voice_jobs job where job.callback_id=cb.id)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=cb.account_id and campaign.mode='sms_inbound')
 order by cb.due_at,op.created_at desc limit 100
$callback$;replacement_callback text:=$callback_new$
with callback_candidates as materialized (
 select cb.id,cb.account_id,cb.due_at,op.id as target_id,op.dnc_receipt_id,op.created_at as contact_created_at from public.icash_live_callbacks cb
 join public.icash_live_conversations call on call.id=cb.conversation_id and call.account_id=cb.account_id and call.state='complete' and (call.result->>'callbackDueAt')::timestamptz=cb.due_at
 join public.icash_operational_contacts op on op.account_id=cb.account_id and op.screening_id=cb.screening_id and op.contact_key=call.contact_key and op.channel='voice'
 where public.icash_outreach_voice_current(cb.account_id) and call.party='seller' and cb.state='pending_dispatch_review' and cb.due_at>now()-interval '15 minutes'
 and not exists(select 1 from public.icash_voice_jobs job where job.callback_id=cb.id)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=cb.account_id and campaign.mode='sms_inbound')
 ) select candidate.id,candidate.account_id,candidate.due_at,candidate.target_id from callback_candidates candidate
 where (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=candidate.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_operational_contact_current(candidate.account_id,candidate.target_id,'voice',false))
 order by candidate.due_at,candidate.contact_created_at desc limit 100
$callback_new$;
begin
 definition:=pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure);
 -- Strip only the delimiter newlines; the installed query bodies must match.
 original_first:=btrim(original_first,E'\n');replacement_first:=btrim(replacement_first,E'\n');
 original_callback:=btrim(original_callback,E'\n');replacement_callback:=btrim(replacement_callback,E'\n');
 if (length(definition)-length(replace(definition,original_first,'')))<>length(original_first)
  or (length(definition)-length(replace(definition,original_callback,'')))<>length(original_callback) then
  raise exception 'Voice queue candidate prerequisite changed';
 end if;
 execute replace(replace(definition,original_first,replacement_first),original_callback,replacement_callback);
end $migration$;
commit;

