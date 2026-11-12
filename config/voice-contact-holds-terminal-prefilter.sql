-- Filter proven terminal recording candidates before contact-hold deduplication.
-- The final evidence predicate remains authoritative and unchanged.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
do $check$
begin
 if md5(pg_get_functiondef('public.icash_voice_contact_holds()'::regprocedure))<>'c02f30febf4d8615de5280a3256dc6fc' then
  raise exception 'Voice contact hold prerequisite changed';
 end if;
end $check$;

CREATE OR REPLACE FUNCTION public.icash_voice_contact_holds()
 RETURNS TABLE(operation_key text, account_id uuid, agent_id text, contact_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with candidates as (
 select 'voice:'||j.id as operation_key,j.account_id,c.agent_id,t.contact_key
 from public.icash_voice_jobs j join public.icash_voice_configs c on c.account_id=j.account_id
 left join lateral (
  select target.contact_key from public.icash_voice_contact_targets target
  where target.id=coalesce(j.permission_id,j.operational_contact_id) and target.account_id=j.account_id
  offset 0
 ) t on true
 where (j.state in ('issued','dispatching') or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')))
 and not coalesce((
  j.state='issued' and j.operation_key is null and j.conversation_id is null and j.provider_call_sid is null
  and j.updated_at<=now()-interval '2 minutes'
  and exists(
   select 1 from public.icash_automation_tickets ticket
   where ticket.voice_job_id=j.id and ticket.account_id=j.account_id and ticket.kind='voice_dispatch'
    and ticket.state='held' and ticket.outcome='held_for_reconciliation'
    and ticket.expires_at<=now() and ticket.completed_at>=ticket.created_at
    and ticket.completed_at<=now()-interval '2 minutes'
    and not exists(select 1 from public.icash_automation_tickets other where other.voice_job_id=j.id and other.id<>ticket.id)
  )
  and not exists(select 1 from public.icash_operation_spend spent where spent.operation_key='voice:'||j.id)
  and not exists(select 1 from public.icash_call_recordings recording where recording.voice_job_id=j.id or recording.operation_key='voice:'||j.id)
  and not exists(select 1 from public.icash_live_conversations live where live.operation_key='voice:'||j.id)
 ),false)
 union all
 select l.operation_key,l.account_id,l.agent_id,l.contact_key from public.icash_live_conversations l where l.state in ('waiting','review')
 union all
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from public.icash_call_recordings r where r.call_ended_at is null
 and not exists(select 1 from public.icash_recorded_gate_terminal_receipts t where r.operation_key is not null and r.account_id is not null and t.recording_id=r.id and t.account_id=r.account_id and t.call_sid=r.call_sid
    and t.receipt->>'status' in ('completed','failed','busy','no-answer','canceled'))
 and not exists(select 1 from icash_recording_private.terminal_cost_receipts t where r.operation_key is not null and r.account_id is not null and t.recording_id=r.id and t.receipt->>'callSid'=r.call_sid
    and t.receipt->>'status' in ('completed','failed','busy','no-answer','canceled'))
 union all
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from icash_recorded_reception_private.sessions r where r.call_ended_at is null
 ) select distinct c.* from candidates c where not exists(
  select 1 from public.icash_call_recordings r where r.operation_key=c.operation_key and r.account_id=c.account_id and (
   r.call_ended_at is not null
   or (r.state='failed' and r.last_error='provider_rejected_call_creation' and r.call_sid is null and r.recording_sid is null
    and r.conversation_id is null and r.start_claimed_at is null and r.consent_at is null and r.recording_authorized_at is null and r.provider_started_at is null
    and r.end_requested_at is null
    and not exists(select 1 from public.icash_live_conversations l where l.operation_key=r.operation_key)
    and not exists(select 1 from public.icash_voice_jobs j where j.id=r.voice_job_id and (j.provider_call_sid is not null or j.conversation_id is not null))
    and exists(select 1 from icash_recording_private.call_creation_rejections rejection
     where rejection.recording_id=r.id and rejection.account_id=r.account_id and rejection.operation_key=r.operation_key))
   or exists(select 1 from public.icash_recorded_gate_terminal_receipts t where t.recording_id=r.id and t.account_id=r.account_id and t.call_sid=r.call_sid
    and t.receipt->>'status' in ('completed','failed','busy','no-answer','canceled'))
   or exists(select 1 from icash_recording_private.terminal_cost_receipts t where t.recording_id=r.id and t.receipt->>'callSid'=r.call_sid
    and t.receipt->>'status' in ('completed','failed','busy','no-answer','canceled'))
  )
 )

$function$
;
commit;
