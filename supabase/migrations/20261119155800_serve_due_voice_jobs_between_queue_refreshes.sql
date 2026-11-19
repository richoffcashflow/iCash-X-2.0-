set local lock_timeout='2s';
do $guard$ begin
 if md5(pg_get_functiondef('public.icash_queue_voice_jobs()'::regprocedure))<>'63b849e981c56294a1fe7e0fa69b9404' then raise exception 'Voice queue changed';end if;
end $guard$;
create table icash_work_private.voice_queue_refresh_pacing(
 id integer primary key check(id=1),refreshed_at timestamptz
);
revoke all on icash_work_private.voice_queue_refresh_pacing from public,anon,authenticated;
grant select,update(refreshed_at) on icash_work_private.voice_queue_refresh_pacing to service_role;
insert into icash_work_private.voice_queue_refresh_pacing(id) values(1);
CREATE OR REPLACE FUNCTION public.icash_queue_voice_jobs()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_operational_contacts;b record;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 -- Dispatch revalidates every selected job. Avoid rebuilding the full candidate
 -- queue for adjacent dispatches while there is already due work to serve.
 if exists(select 1 from public.icash_voice_jobs where state='ready' and due_at<=now())
  and exists(select 1 from icash_work_private.voice_queue_refresh_pacing
   where id=1 and refreshed_at between clock_timestamp()-interval '15 seconds' and clock_timestamp())
  and not exists(select 1 from public.icash_live_callbacks cb
   where cb.state='pending_dispatch_review' and cb.due_at between now()-interval '15 minutes' and now()
   and not exists(select 1 from public.icash_voice_jobs j where j.callback_id=cb.id)) then
  return;
 end if;
 update icash_work_private.voice_queue_refresh_pacing set refreshed_at=clock_timestamp() where id=1;
 perform public.icash_queue_unanswered_seller_calls();
 perform public.icash_prepare_operational_contacts();
 perform public.icash_queue_voice_jobs_before_operational();
 for c in with prior_first_routes as materialized (
 select prior.account_id,target.screening_id,target.contact_key
 from public.icash_voice_jobs prior join public.icash_voice_contact_targets target
  on target.id=coalesce(prior.permission_id,prior.operational_contact_id) and target.account_id=prior.account_id
 where prior.callback_id is null
), candidates as materialized (
 select op.* from public.icash_operational_contacts op
 join public.icash_accounts a on a.id=op.account_id and not a.bot_paused
 join public.icash_voice_configs cfg on cfg.account_id=op.account_id and cfg.enabled and cfg.reviewed_until>now()
 join public.icash_screening_jobs s on s.id=op.screening_id and s.account_id=op.account_id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
 where op.channel='voice' and op.revoked_at is null and op.eligibility_until>now()
 and not exists(select 1 from public.icash_contact_permissions legacy where legacy.account_id=op.account_id and legacy.screening_id=op.screening_id and legacy.phone=op.phone)
 and not exists(select 1 from public.icash_outreach_campaigns campaign where campaign.account_id=op.account_id and campaign.mode='sms_inbound')
 and not exists(select 1 from prior_first_routes prior
  where prior.account_id=op.account_id and prior.screening_id=op.screening_id and prior.contact_key=op.contact_key)
 ) select op.* from candidates op
 where case when public.icash_outreach_voice_current(op.account_id) then
  (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=op.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
   or public.icash_operational_contact_current(op.account_id,op.id,'voice',false))
  else false end
 order by op.created_at,op.id limit 100
 loop
  if public.icash_operational_contact_current(c.account_id,c.id,'voice',false)
   and not exists(select 1 from public.icash_voice_jobs j join public.icash_voice_contact_targets target on target.id=coalesce(j.permission_id,j.operational_contact_id)
    where j.account_id=c.account_id and target.account_id=c.account_id and target.screening_id=c.screening_id and target.contact_key=c.contact_key and j.callback_id is null)
  then insert into public.icash_voice_jobs(account_id,operational_contact_id) values(c.account_id,c.id) on conflict do nothing;end if;
 end loop;
 for b in with callback_candidates as materialized (
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
 loop
  if public.icash_operational_contact_current(b.account_id,b.target_id,'voice',false) then
   insert into public.icash_voice_jobs(account_id,operational_contact_id,callback_id,due_at) values(b.account_id,b.target_id,b.id,b.due_at) on conflict do nothing;
  end if;
 end loop;
end $function$
;