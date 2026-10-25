CREATE OR REPLACE FUNCTION public.icash_active_voice_slots()
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
 union
 select l.operation_key,l.account_id,l.agent_id,l.contact_key from public.icash_live_conversations l where l.state in ('waiting','review')
 union
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from public.icash_call_recordings r where r.call_ended_at is null
 union
 select r.operation_key,r.account_id,r.agent_id,r.contact_key from icash_recorded_reception_private.sessions r where r.call_ended_at is null
 ) select c.* from candidates c where not exists(
  select 1 from public.icash_call_recordings r where r.operation_key=c.operation_key and r.account_id=c.account_id and (
   r.call_ended_at is not null
   or exists(select 1 from public.icash_recorded_gate_terminal_receipts t where t.recording_id=r.id and t.account_id=r.account_id and t.call_sid=r.call_sid
    and t.receipt->>'status' in ('completed','failed','busy','no-answer','canceled'))
   or exists(select 1 from icash_recording_private.terminal_cost_receipts t where t.recording_id=r.id and t.receipt->>'callSid'=r.call_sid
    and t.receipt->>'status' in ('completed','failed','busy','no-answer','canceled'))
  )
 )
$function$;
