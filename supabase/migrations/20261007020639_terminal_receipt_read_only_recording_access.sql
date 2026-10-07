-- Terminal failed/declined/absent rows cannot start AI. Keep recording access read-only.
create or replace function public.icash_note_recorded_gate_terminal(p_id uuid,p_account uuid,p_operation text,p_receipt jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
declare r public.icash_call_recordings;j public.icash_voice_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into r from public.icash_call_recordings where id=p_id and account_id=p_account and operation_key=p_operation;
 if not found or r.state not in ('declined','failed','absent') or r.call_sid is null or r.start_claimed_at is not null or r.recording_sid is not null or r.conversation_id is not null then return false;end if;
 if jsonb_typeof(p_receipt) is distinct from 'object'
 or row(p_receipt->>'sid',p_receipt->>'account_sid',p_receipt->>'from',p_receipt->>'to',p_receipt->>'direction') is distinct from row(r.call_sid,r.provider_account_sid,r.from_phone,r.to_phone,'outbound-api'::text)
 or coalesce(p_receipt->>'status','') not in ('completed','failed','busy','no-answer','canceled')
 or p_receipt->>'date_created' is null or (p_receipt->>'date_created')::timestamptz not between r.created_at-interval '5 seconds' and r.created_at+interval '2 minutes'
 or p_receipt->>'duration' is null or p_receipt->>'duration' !~ '^[0-9]{1,4}$' or (p_receipt->>'duration')::integer not between 0 and 600 then return false;end if;
 select * into j from public.icash_voice_jobs where id=r.voice_job_id and account_id=p_account and operation_key=p_operation for update;
 if not found or j.conversation_id is not null or j.state not in ('dispatching','dispatched','held') or (j.provider_call_sid is not null and j.provider_call_sid<>r.call_sid)
 or exists(select 1 from public.icash_live_conversations where operation_key=p_operation) then return false;end if;
 insert into public.icash_recorded_gate_terminal_receipts(recording_id,account_id,call_sid,receipt) values(r.id,p_account,r.call_sid,p_receipt) on conflict(recording_id) do nothing;
 update public.icash_voice_jobs set state='held',provider_call_sid=r.call_sid,outcome='ended_before_recording',updated_at=now() where id=j.id and state in ('dispatching','dispatched');
 return true;
end $$;
