CREATE OR REPLACE FUNCTION public.icash_active_voice_slots()
 RETURNS TABLE(operation_key text, account_id uuid, agent_id text, contact_key text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with candidates as (
 select 'voice:'||j.id as operation_key,j.account_id,c.agent_id,t.contact_key
 from public.icash_voice_jobs j join public.icash_voice_configs c on c.account_id=j.account_id
 left join public.icash_voice_contact_targets t on t.id=coalesce(j.permission_id,j.operational_contact_id) and t.account_id=j.account_id
 where j.state in ('issued','dispatching') or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))
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

