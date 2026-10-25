-- Release only an exact original carrier rejection. No call, retry or customer charge.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table icash_recording_private.call_creation_rejections (
 recording_id uuid primary key references public.icash_call_recordings(id),
 account_id uuid not null,
 operation_key text not null unique,
 alert_sid text not null unique check(alert_sid ~ '^NO[0-9a-fA-F]{32}$'),
 receipt jsonb not null,
 created_at timestamptz not null default clock_timestamp(),
 foreign key(operation_key,account_id) references public.icash_operation_spend(operation_key,account_id)
);
alter table icash_recording_private.call_creation_rejections enable row level security;
revoke all on icash_recording_private.call_creation_rejections from public,anon,authenticated,service_role;
create trigger call_creation_rejections_immutable before update or delete on icash_recording_private.call_creation_rejections
 for each row execute function icash_recording_private.audit_immutable();
create trigger call_creation_rejections_no_truncate before truncate on icash_recording_private.call_creation_rejections
 for each statement execute function icash_recording_private.audit_immutable();

create function public.icash_note_call_creation_rejection(p_id uuid,p_account uuid,p_operation text,p_receipt jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_call_recordings;j public.icash_voice_jobs;o public.icash_operation_spend;
 prior jsonb;generated timestamptz;t timestamptz:=clock_timestamp();
begin
 if p_id is null or p_account is null or p_operation is null
  or not icash_recording_private.keys(p_receipt,array['recordingId','providerAccountSid','alertSid','errorCode','responseStatus','resourceSid','requestMethod','requestUrl','fromPhone','toPhone','nonceHash','generatedAt','requestHash','evidenceHash'])
  or p_receipt->'responseStatus' is distinct from '400'::jsonb
  or coalesce(p_receipt->'errorCode','null'::jsonb) not in ('21210'::jsonb,'21211'::jsonb,'21212'::jsonb,'21215'::jsonb)
  or p_receipt->'resourceSid' is distinct from 'null'::jsonb
  or p_receipt->>'requestMethod' is distinct from 'POST'
  or coalesce(p_receipt->>'alertSid','') !~ '^NO[0-9a-fA-F]{32}$'
  or coalesce(p_receipt->>'requestHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_receipt->>'evidenceHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(p_receipt->>'generatedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$'
  then raise exception 'Original call rejection proof required';end if;
 generated:=(p_receipt->>'generatedAt')::timestamptz;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation and account_id=p_account for update;
 if not found then raise exception 'Call rejection operation missing';end if;
 select * into r from public.icash_call_recordings where id=p_id and account_id=p_account and operation_key=p_operation for update;
 if not found then raise exception 'Call rejection binding missing';end if;
 select * into j from public.icash_voice_jobs where id=r.voice_job_id and account_id=p_account for update;
 if not found or p_operation is distinct from 'voice:'||j.id
  or j.operation_key is distinct from p_operation or j.provider_call_sid is not null or j.conversation_id is not null
  or r.entry_policy is distinct from 'direct_recorded_v1' or r.call_sid is not null or r.recording_sid is not null
  or r.conversation_id is not null or r.start_claimed_at is not null or r.consent_at is not null or r.recording_authorized_at is not null
  or r.provider_started_at is not null or r.call_ended_at is not null or r.end_requested_at is not null
  or r.dial_claimed_at is null or r.dial_claimed_at<r.created_at or r.dial_claimed_at>t-interval '1 minute'
  or not isfinite(generated) or generated<r.dial_claimed_at-interval '2 seconds' or generated>r.dial_claimed_at+interval '60 seconds' or generated>t
  or p_receipt->>'recordingId' is distinct from r.id::text
  or p_receipt->>'providerAccountSid' is distinct from r.provider_account_sid
  or p_receipt->>'requestUrl' is distinct from 'https://api.twilio.com/2010-04-01/Accounts/'||r.provider_account_sid||'/Calls.json'
  or p_receipt->>'nonceHash' is distinct from r.nonce_hash
  or p_receipt->>'fromPhone' is distinct from r.from_phone or p_receipt->>'toPhone' is distinct from r.to_phone
  or exists(select 1 from public.icash_live_conversations where operation_key=p_operation)
  or exists(select 1 from public.icash_recorded_gate_terminal_receipts where recording_id=r.id)
  or exists(select 1 from icash_recording_private.terminal_cost_receipts where recording_id=r.id)
  then raise exception 'Call rejection evidence conflict';end if;
 select receipt into prior from icash_recording_private.call_creation_rejections where recording_id=r.id;
 if found then
  if prior is distinct from p_receipt or r.state is distinct from 'failed' or j.state is distinct from 'held'
   or j.outcome is distinct from 'provider_rejected_call_creation' or o.state not in ('settled','cancelled')
   or o.actual_micros is distinct from 0 or o.charged_cents is distinct from 0
   or o.settlement_evidence is distinct from 'twilio-call-creation-rejected:'||(p_receipt->>'alertSid')||':'||(p_receipt->>'evidenceHash')
   then raise exception 'Call rejection receipt conflict';end if;
  return jsonb_build_object('settled',true,'alreadySettled',true);
 end if;
 if r.state is distinct from 'consent_pending' or j.state not in ('issued','dispatching','held') or o.state not in ('reserved','dispatched')
  then raise exception 'Call rejection state conflict';end if;
 insert into icash_recording_private.call_creation_rejections(recording_id,account_id,operation_key,alert_sid,receipt)
 values(r.id,r.account_id,r.operation_key,p_receipt->>'alertSid',p_receipt);
 perform public.icash_settle_operation(p_operation,0,0,'twilio-call-creation-rejected:'||(p_receipt->>'alertSid')||':'||(p_receipt->>'evidenceHash'));
 update public.icash_call_recordings set state='failed',last_error='provider_rejected_call_creation',last_action='verified_creation_rejection',
  next_reconcile_at=null,reconcile_lease_token=null,reconcile_lease_expires_at=null,row_version=row_version+1,updated_at=t where id=r.id;
 update public.icash_voice_jobs set state='held',outcome='provider_rejected_call_creation',updated_at=t where id=j.id;
 return jsonb_build_object('settled',true,'alreadySettled',false);
end $$;
revoke all on function public.icash_note_call_creation_rejection(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_note_call_creation_rejection(uuid,uuid,text,jsonb) to service_role;

do $patch$
declare d text;
 needle text:=$old$   r.call_ended_at is not null
   or exists(select 1 from public.icash_recorded_gate_terminal_receipts$old$;
begin
 d:=pg_get_functiondef('public.icash_active_voice_slots()'::regprocedure);
 if md5(d)<>'6f9ae238bfdde1d7cb61f038571a160d' or position(needle in d)=0 then raise exception 'Call rejection capacity prerequisite changed';end if;
 execute replace(d,needle,$new$   r.call_ended_at is not null
   or (r.state='failed' and r.last_error='provider_rejected_call_creation' and r.call_sid is null and r.recording_sid is null
    and r.conversation_id is null and r.start_claimed_at is null and r.consent_at is null and r.recording_authorized_at is null and r.provider_started_at is null
    and r.end_requested_at is null
    and not exists(select 1 from public.icash_live_conversations l where l.operation_key=r.operation_key)
    and not exists(select 1 from public.icash_voice_jobs j where j.id=r.voice_job_id and (j.provider_call_sid is not null or j.conversation_id is not null))
    and exists(select 1 from icash_recording_private.call_creation_rejections rejection
     where rejection.recording_id=r.id and rejection.account_id=r.account_id and rejection.operation_key=r.operation_key))
   or exists(select 1 from public.icash_recorded_gate_terminal_receipts$new$);
end $patch$;
commit;
