begin;
set local lock_timeout='5s';
-- A bound no-answer/busy/finished gate receipt proves an attempt, not a
-- conversation. Never reset the job, replay the call, or settle its billing.
create or replace function public.icash_voice_attempt_recorded(p_job uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(
  select 1 from public.icash_voice_jobs v where v.id=p_job and v.provider_call_sid is not null
   and (v.state='dispatched' or (v.state='held' and v.outcome='ended_before_recording' and exists(
    select 1 from public.icash_call_recordings r
    join public.icash_recorded_gate_terminal_receipts t on t.recording_id=r.id and t.account_id=r.account_id and t.call_sid=r.call_sid
    where r.voice_job_id=v.id and r.account_id=v.account_id and r.operation_key=v.operation_key and r.call_sid=v.provider_call_sid
     and r.state in ('declined','failed','absent') and r.start_claimed_at is null and r.recording_sid is null and r.conversation_id is null
     and v.conversation_id is null and t.receipt->>'sid'=v.provider_call_sid
     and t.receipt->>'status' in ('no-answer','busy','completed')
   )))
 );
$$;
revoke all on function public.icash_voice_attempt_recorded(uuid) from public,anon,authenticated;
grant execute on function public.icash_voice_attempt_recorded(uuid) to service_role;

do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_prepare_seller_responses(uuid)'::regprocedure);
 needle:=$old$and v.state='dispatched' and v.provider_call_sid is not null$old$;
 if position(needle in definition)=0 then raise exception 'Seller response receipt predicate changed';end if;
 definition:=replace(definition,needle,'and v.account_id=p.account_id and v.callback_id is null and public.icash_voice_attempt_recorded(v.id)');
 definition:=replace(definition,'''Text accepted and call started''','''Text accepted; call attempt recorded''');
 definition:=replace(definition,'''Call started''','''Call attempt recorded''');
 execute definition;
 definition:=pg_get_functiondef('public.icash_undispatched_outreach_findings()'::regprocedure);
 needle:=$old$(v.state='dispatched' and v.provider_call_sid is not null)$old$;
 if position(needle in definition)=0 then raise exception 'Outreach monitor receipt predicate changed';end if;
 execute replace(definition,needle,'public.icash_voice_attempt_recorded(v.id)');
end $patch$;
commit;
