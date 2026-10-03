-- Versioned final-action evidence and durable explicit contact opt-out only.
-- Existing account/call/nonce/CAS/deadline and lifecycle/settlement branches are preserved.
begin;
create or replace function public.icash_transition_call_recording(p_id uuid,p_account uuid,p_operation text,p_expected_state text,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_call_recordings;t timestamptz;ns text;started timestamptz;finished timestamptz;dur integer;price bigint;utterance text;
begin
 select * into r from public.icash_call_recordings where id=p_id and account_id=p_account and operation_key=p_operation and state=p_expected_state for update;
 if not found or r.state='deleted' then return null;end if;
 t:=icash_recording_private.clock_now();ns:=r.state;
 -- New provider work honors current stop/permission state. Reconciliation and
 -- deletion intentionally do not use this admission gate.
 if p_action in ('claim_dial','claim_start') and not exists(
  select 1 from public.icash_accounts a join public.icash_voice_configs c on c.account_id=a.id
  join public.icash_voice_contact_targets cp on cp.id=coalesce(r.permission_id,r.operational_contact_id) and cp.account_id=a.id
  join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=a.id
  where a.id=r.account_id and not a.bot_paused and c.enabled and c.reviewed_until>t
   and cp.revoked_at is null and cp.permission_until>t and cp.dnc_clear and o.state='dispatched' and o.permission_until>t
   and (r.operational_contact_id is null or public.icash_operational_contact_current(r.account_id,r.operational_contact_id,'voice',true))
 ) then return null;end if;
 if p_action='claim_dial' then
  if not icash_recording_private.keys(p_payload,'{}') then raise exception 'Invalid dial claim';end if;
  if r.state<>'consent_pending' or r.call_sid is not null or r.dial_claimed_at is not null or r.consent_deadline_at<=t then return null;end if;
  r.dial_claimed_at:=t;
 elsif p_action='dial_unknown' then
  if not icash_recording_private.keys(p_payload,'{}') then raise exception 'Invalid dial outcome';end if;
  if r.state<>'consent_pending' or r.dial_claimed_at is null or r.call_sid is not null then return null;end if;
  r.last_error:='dial_outcome_unknown_no_redial';r.next_reconcile_at:=t;
 elsif p_action='bind_call' then
  if not icash_recording_private.keys(p_payload,array['callSid','providerAccountSid','fromPhone','toPhone'])
   or coalesce(p_payload->>'callSid','') !~ '^CA[0-9a-fA-F]{32}$' then raise exception 'Invalid canonical call binding';end if;
  if r.state<>'consent_pending' or r.call_sid is not null or r.dial_claimed_at is null
   or row(r.provider_account_sid,r.from_phone,r.to_phone) is distinct from row(p_payload->>'providerAccountSid',p_payload->>'fromPhone',p_payload->>'toPhone') then return null;end if;
  r.call_sid:=p_payload->>'callSid';
 elsif p_action='consent' then
  if p_payload ? 'evidenceVersion' then
   if not icash_recording_private.keys(p_payload,array['nonceHash','source','utterance','confidence','disclosureVersion','evidenceVersion','resultKind','confidenceBasis','confidenceReported','confidencePolicy']) then raise exception 'Invalid spoken consent evidence';end if;
   if not icash_voice_consent_private.valid_final_evidence_v4(p_payload) then return null;end if;
  else
   if not icash_recording_private.keys(p_payload,array['nonceHash','source','utterance','confidence','disclosureVersion']) or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or jsonb_typeof(p_payload->'confidence') is distinct from 'number' then raise exception 'Invalid spoken consent evidence';end if;
   utterance:=lower(regexp_replace(btrim(p_payload->>'utterance'),'[.!]+$',''));
   if (p_payload->>'confidence')::numeric not between 0.9 and 1 or utterance not in ('yes','yeah','yep','sure','yes please','yes that''s okay','yes you can record','yes i agree','i agree','i consent','yes you may record') then return null;end if;
  end if;
  if r.state<>'consent_pending' or r.consent_at is not null or r.call_sid is null or r.consent_deadline_at<=t
   or r.nonce_hash is distinct from p_payload->>'nonceHash' or r.disclosure_version is distinct from p_payload->>'disclosureVersion'
   or p_payload->>'source' is distinct from 'twilio_gather_speech' then return null;end if;
  r.consent_at:=t;r.consent_evidence:=jsonb_build_object('method','speech','source','twilio_gather_speech','utterance',case when p_payload ? 'evidenceVersion' then p_payload->>'utterance' else btrim(p_payload->>'utterance') end,'confidence',p_payload->'confidence','accountSid',r.provider_account_sid,'callSid',r.call_sid,'disclosureVersion',r.disclosure_version);
  if p_payload ? 'evidenceVersion' then r.consent_evidence:=r.consent_evidence||jsonb_build_object('evidenceVersion',p_payload->>'evidenceVersion','resultKind','gather_action_final','confidenceBasis',p_payload->>'confidenceBasis','confidenceReported',p_payload->'confidenceReported','confidencePolicy','advisory');end if;
 elsif p_action='contact_opt_out' then
  if not icash_recording_private.keys(p_payload,array['nonceHash','utterance']) or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or length(p_payload->>'utterance') not between 1 and 16384 then raise exception 'Invalid contact opt-out';end if;
  if r.state<>'consent_pending' or r.start_claimed_at is not null or r.nonce_hash is distinct from p_payload->>'nonceHash' or not icash_voice_consent_private.contact_opt_out_v3(p_payload->>'utterance') then return null;end if;
  if r.to_phone ~ '^\+[1-9][0-9]{7,14}$' then
   insert into public.icash_text_suppressions(phone,reason) values(r.to_phone,'voice_recording_gate_opt_out:'||r.id::text) on conflict(phone) do nothing;
  end if;
  ns:='declined';r.last_error:='contact_opt_out';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='decline' then
  if not icash_recording_private.keys(p_payload,array['reason']) or p_payload->>'reason' is null or p_payload->>'reason' not in ('declined','timeout','ambiguous') then raise exception 'Invalid decline';end if;
  if r.state<>'consent_pending' or r.start_claimed_at is not null then return null;end if;
  ns:='declined';r.last_error:=p_payload->>'reason';r.next_reconcile_at:=t;
 elsif p_action='claim_start' then
  if not icash_recording_private.keys(p_payload,'{}') then raise exception 'Invalid start claim';end if;
  if r.state<>'consent_pending' or r.consent_at is null or r.start_claimed_at is not null or r.consent_deadline_at<=t then return null;end if;
  ns:='starting';r.start_claimed_at:=t;r.next_reconcile_at:=t+interval '30 seconds';
 elsif p_action='start_unknown' then
  if not icash_recording_private.keys(p_payload,'{}') then raise exception 'Invalid uncertain start';end if;
  if r.state<>'starting' or r.start_claimed_at is null then return null;end if;
  r.last_error:='start_outcome_unknown_no_retry';r.next_reconcile_at:=t;
 elsif p_action in ('started','processing','available') then
  if not icash_recording_private.keys(p_payload,case when p_action='available' then array['recordingSid','providerStartedAt','endedAt','durationSeconds'] else array['recordingSid','providerStartedAt'] end,
    case when p_action='available' then array['providerRecordingPriceMicros'] else '{}'::text[] end)
   or coalesce(p_payload->>'recordingSid','') !~ '^RE[0-9a-fA-F]{32}$'
   or jsonb_typeof(p_payload->'providerStartedAt') is distinct from 'string' then raise exception 'Invalid provider recording evidence';end if;
  if r.state not in ('starting','recording','stopping','processing','failed') or r.start_claimed_at is null or r.consent_at is null then return null;end if;
  started:=(p_payload->>'providerStartedAt')::timestamptz;
  if not isfinite(started) or started>t+interval '1 minute' or started<r.consent_at-interval '1 second'
   or (r.recording_sid is not null and r.recording_sid is distinct from p_payload->>'recordingSid')
   or (r.provider_started_at is not null and r.provider_started_at is distinct from started) then return null;end if;
  r.recording_sid:=p_payload->>'recordingSid';r.provider_started_at:=started;r.audio_expires_at:=started+interval '720 hours';r.next_delete_at:=r.audio_expires_at;
  if p_action='started' then ns:=case when r.state in ('stopping','processing') then r.state else 'recording' end;r.next_reconcile_at:=t+interval '2 minutes';
  elsif p_action='processing' then ns:='processing';r.next_reconcile_at:=t+interval '1 minute';
  else
   if jsonb_typeof(p_payload->'endedAt') is distinct from 'string' or jsonb_typeof(p_payload->'durationSeconds') is distinct from 'number'
    or (p_payload->>'durationSeconds')::numeric<>trunc((p_payload->>'durationSeconds')::numeric)
    or (p_payload->>'durationSeconds')::numeric not between 0 and 600
    or (p_payload ? 'providerRecordingPriceMicros' and (jsonb_typeof(p_payload->'providerRecordingPriceMicros') is distinct from 'number'
      or (p_payload->>'providerRecordingPriceMicros')::numeric<>trunc((p_payload->>'providerRecordingPriceMicros')::numeric)
      or (p_payload->>'providerRecordingPriceMicros')::numeric not between 0 and 9007199254740991)) then raise exception 'Invalid completed recording evidence';end if;
   finished:=(p_payload->>'endedAt')::timestamptz;dur:=(p_payload->>'durationSeconds')::integer;price:=(p_payload->>'providerRecordingPriceMicros')::bigint;
   if not isfinite(finished) or finished<started or finished>t+interval '1 minute' or finished>started+interval '601 seconds'
    or (r.provider_recording_price_micros is not null and price is distinct from r.provider_recording_price_micros) then return null;end if;
   ns:=case when r.audio_expires_at<=t then 'expired' else 'available' end;
   r.ended_at:=finished;r.duration_seconds:=dur;r.provider_recording_price_micros:=price;r.price_is_estimate:=(price is null);r.next_reconcile_at:=case when r.conversation_id is null or r.end_requested_at is not null and r.call_ended_at is null then t+interval '1 minute' else null end;
  end if;
 elsif p_action='stop' then
  if not icash_recording_private.keys(p_payload,array['stopTokenHash']) then raise exception 'Invalid stop token';end if;
  if r.state not in ('starting','recording','stopping','processing','available','absent','failed') or r.stop_token_hash is distinct from p_payload->>'stopTokenHash' then return null;end if;
  ns:='stopping';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='call_ended' then
  if not icash_recording_private.keys(p_payload,array['callSid','providerAccountSid','status']) then raise exception 'Invalid ended call receipt';end if;
  if r.end_requested_at is null or r.call_sid is distinct from p_payload->>'callSid' or r.provider_account_sid is distinct from p_payload->>'providerAccountSid' or coalesce(p_payload->>'status','') not in ('completed','failed','busy','no-answer','canceled') then return null;end if;
  r.call_ended_at:=coalesce(r.call_ended_at,t);r.next_reconcile_at:=t;
 elsif p_action='bind_conversation' then
  if not icash_recording_private.keys(p_payload,array['conversationId','toolTokenHash'])
   or coalesce(p_payload->>'conversationId','') !~ '^conv_[A-Za-z0-9]{1,160}$'
   or coalesce(p_payload->>'toolTokenHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Invalid conversation binding';end if;
  if r.state not in ('recording','processing','available','expired','deletion_pending','absent','failed') or r.conversation_id is not null or r.recording_sid is null or r.consent_at is null or r.call_context is null then return null;end if;
  perform 1 from public.icash_voice_jobs j where j.id=r.voice_job_id and j.account_id=r.account_id and j.operation_key=r.operation_key
   and j.state in ('dispatching','dispatched') and (j.conversation_id is null or j.conversation_id=p_payload->>'conversationId')
   and (j.provider_call_sid is null or j.provider_call_sid=r.call_sid) for update;
  if not found then return null;end if;
  insert into public.icash_live_conversations(account_id,screening_id,party,agent_id,conversation_id,operation_key,contact_key,strategy_key,tool_token_hash,tool_expires_at)
   values(r.account_id,r.screening_id,r.party,r.agent_id,p_payload->>'conversationId',r.operation_key,r.contact_key,
    case when r.party='buyer' then 'buyer_followup' else r.call_context->>'strategyKey' end,p_payload->>'toolTokenHash',coalesce(r.dial_claimed_at,r.created_at)+interval '600 seconds')
   on conflict do nothing;
  if not exists(select 1 from public.icash_live_conversations c where c.account_id=r.account_id and c.operation_key=r.operation_key
   and c.screening_id=r.screening_id and c.party=r.party and c.agent_id=r.agent_id and c.contact_key=r.contact_key
   and c.conversation_id=p_payload->>'conversationId' and c.tool_token_hash=p_payload->>'toolTokenHash'
   and c.strategy_key=case when r.party='buyer' then 'buyer_followup' else r.call_context->>'strategyKey' end
   and c.tool_expires_at=coalesce(r.dial_claimed_at,r.created_at)+interval '600 seconds') then raise exception 'Live recording binding conflict';end if;
  update public.icash_voice_jobs set conversation_id=p_payload->>'conversationId',provider_call_sid=r.call_sid,state='dispatched',updated_at=t where id=r.voice_job_id;
  r.conversation_id:=p_payload->>'conversationId';
  if r.state in ('available','expired','absent') then r.next_reconcile_at:=case when r.end_requested_at is not null and r.call_ended_at is null then t else null end;end if;
 elsif p_action='absent' then
  if not icash_recording_private.keys(p_payload,'{}') then raise exception 'Invalid absent outcome';end if;
  if r.state not in ('starting','recording','stopping','processing','absent','failed') then return null;end if;
  ns:='absent';r.next_reconcile_at:=case when r.end_requested_at is not null and r.call_ended_at is null or r.recording_sid is not null and r.conversation_id is null then t else null end;
 elsif p_action='fail' then
  if not icash_recording_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') !~ '^[a-z0-9_:-]{1,160}$' then raise exception 'Invalid failure reason';end if;
  if r.state not in ('consent_pending','starting','recording','stopping','processing') then return null;end if;
  ns:='failed';r.last_error:=p_payload->>'reason';r.next_reconcile_at:=case when r.start_claimed_at is not null or r.dial_claimed_at is not null then t else null end;
 elsif p_action='expire' then
  if not icash_recording_private.keys(p_payload,'{}') then raise exception 'Invalid expiry';end if;
  if r.recording_sid is null or r.audio_expires_at>t or r.state='deletion_pending' then return null;end if;
  ns:='expired';r.next_delete_at:=t;
 else raise exception 'Unknown recording action';end if;
 update public.icash_call_recordings set state=ns,call_sid=r.call_sid,recording_sid=r.recording_sid,conversation_id=r.conversation_id,
  consent_at=r.consent_at,consent_evidence=r.consent_evidence,dial_claimed_at=r.dial_claimed_at,start_claimed_at=r.start_claimed_at,
  provider_started_at=r.provider_started_at,ended_at=r.ended_at,duration_seconds=r.duration_seconds,audio_expires_at=r.audio_expires_at,
  provider_recording_price_micros=r.provider_recording_price_micros,price_is_estimate=r.price_is_estimate,
  next_reconcile_at=r.next_reconcile_at,next_delete_at=r.next_delete_at,last_error=r.last_error,
  end_requested_at=r.end_requested_at,call_ended_at=r.call_ended_at,last_action=p_action,row_version=row_version+1,updated_at=t where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
revoke all on function public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb) to service_role;
commit;
