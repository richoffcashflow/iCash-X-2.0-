-- A completed failed handler with no admitted operation cannot have dialed.
-- Keep its ticket held. This changes only active-capacity accounting, never
-- authorizes a retry, releases a reservation, or changes a provider outcome.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create index icash_automation_voice_job_history on public.icash_automation_tickets(voice_job_id,created_at desc) where voice_job_id is not null;
do $patch$
declare d text;
 old_filter text:=$old$ where j.state in ('issued','dispatching') or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))$old$;
begin
 d:=pg_get_functiondef('public.icash_active_voice_slots()'::regprocedure);
 if md5(d)<>'698728a39964c2baa865273e6d05b56f' or position(old_filter in d)=0 then raise exception 'Voice capacity prerequisite changed';end if;
 execute replace(d,old_filter,$new$ where (j.state in ('issued','dispatching') or (j.state='held' and j.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')))
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
 ),false)$new$);
end $patch$;
commit;
