-- Exact live queue function captured read-only on 2026-10-19.
CREATE OR REPLACE FUNCTION public.icash_queue_voice_jobs()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_operational_contacts;b record;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform public.icash_prepare_operational_contacts();
 perform public.icash_queue_voice_jobs_before_operational();
 for c in select op.* from public.icash_operational_contacts op
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
 loop
  if public.icash_operational_contact_current(c.account_id,c.id,'voice',false)
   and not exists(select 1 from public.icash_voice_jobs j join public.icash_voice_contact_targets target on target.id=coalesce(j.permission_id,j.operational_contact_id)
    where j.account_id=c.account_id and target.account_id=c.account_id and target.screening_id=c.screening_id and target.contact_key=c.contact_key and j.callback_id is null)
  then insert into public.icash_voice_jobs(account_id,operational_contact_id) values(c.account_id,c.id) on conflict do nothing;end if;
 end loop;
 for b in select cb.id,cb.account_id,cb.due_at,op.id as target_id from public.icash_live_callbacks cb
 join public.icash_live_conversations call on call.id=cb.conversation_id and call.account_id=cb.account_id and call.state='complete' and (call.result->>'callbackDueAt')::timestamptz=cb.due_at
 join public.icash_operational_contacts op on op.account_id=cb.account_id and op.screening_id=cb.screening_id and op.contact_key=call.contact_key and op.channel='voice'
 where public.icash_outreach_voice_current(cb.account_id) and call.party='seller' and cb.state='pending_dispatch_review' and cb.due_at>now()-interval '15 minutes'
 and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
  or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))
 and not exists(select 1 from public.icash_voice_jobs job where job.callback_id=cb.id)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=cb.account_id and campaign.mode='sms_inbound')
 order by cb.due_at,op.created_at desc limit 100
 loop
  if public.icash_operational_contact_current(b.account_id,b.target_id,'voice',false) then
   insert into public.icash_voice_jobs(account_id,operational_contact_id,callback_id,due_at) values(b.account_id,b.target_id,b.id,b.due_at) on conflict do nothing;
  end if;
 end loop;
end $function$

