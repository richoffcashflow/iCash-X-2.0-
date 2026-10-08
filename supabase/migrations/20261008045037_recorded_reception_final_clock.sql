-- A canonical completed receipt for the same recording can advance the initial
-- whole-second start by one second. Preserve both observations and the original
-- retention deadline; never rewrite initial authorization or identity evidence.
begin;
alter table icash_recorded_reception_private.sessions add column final_provider_started_at timestamptz,
 add constraint recorded_reception_final_clock check(final_provider_started_at is null or
  (isfinite(final_provider_started_at) and provider_started_at is not null and ended_at is not null and duration_seconds is not null
   and final_provider_started_at>=provider_started_at and final_provider_started_at<=provider_started_at+interval '1 second'
   and ended_at=final_provider_started_at+make_interval(secs=>duration_seconds)));
CREATE OR REPLACE FUNCTION icash_recorded_reception_private.guard_session()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Recorded reception sessions cannot be removed';end if;
 if tg_op='INSERT' then
  if new.state<>'reserved' or new.row_version<>1 or new.setup_claimed_at is not null or new.call_started_at is not null or new.recording_authorized_at is not null or new.consent_at is not null or new.recording_sid is not null or new.conversation_id is not null then raise exception 'Initial reserved session required';end if;
 else
  if (to_jsonb(new)-array['state','row_version','call_started_at','call_deadline_at','consent_deadline_at','setup_claimed_at','setup_confirmed_at','consent_at','consent_evidence','recording_authorized_at','start_claimed_at','register_claimed_at','provider_started_at','final_provider_started_at','recording_sid','conversation_id','ended_at','duration_seconds','audio_expires_at','deleted_at','end_requested_at','call_ended_at','call_terminal_status','provider_recording_price_micros','price_is_estimate','updated_at','next_reconcile_at','reconcile_attempts','reconcile_lease_token','reconcile_lease_expires_at','next_delete_at','deletion_attempts','deletion_lease_token','deletion_lease_expires_at','billing_state','settled_at','last_error','last_action']) is distinct from
   (to_jsonb(old)-array['state','row_version','call_started_at','call_deadline_at','consent_deadline_at','setup_claimed_at','setup_confirmed_at','consent_at','consent_evidence','recording_authorized_at','start_claimed_at','register_claimed_at','provider_started_at','final_provider_started_at','recording_sid','conversation_id','ended_at','duration_seconds','audio_expires_at','deleted_at','end_requested_at','call_ended_at','call_terminal_status','provider_recording_price_micros','price_is_estimate','updated_at','next_reconcile_at','reconcile_attempts','reconcile_lease_token','reconcile_lease_expires_at','next_delete_at','deletion_attempts','deletion_lease_token','deletion_lease_expires_at','billing_state','settled_at','last_error','last_action']) then raise exception 'Recorded reception identity and policy are immutable';end if;
  if (old.final_provider_started_at is not null and new.final_provider_started_at is distinct from old.final_provider_started_at)
   or (old.recording_authorized_at is not null and new.recording_authorized_at is distinct from old.recording_authorized_at)
   or (old.call_started_at is not null and row(new.call_started_at,new.call_deadline_at,new.consent_deadline_at) is distinct from row(old.call_started_at,old.call_deadline_at,old.consent_deadline_at))
   or (old.setup_claimed_at is not null and new.setup_claimed_at is distinct from old.setup_claimed_at)
   or (old.setup_confirmed_at is not null and new.setup_confirmed_at is distinct from old.setup_confirmed_at)
   or (old.consent_at is not null and row(new.consent_at,new.consent_evidence) is distinct from row(old.consent_at,old.consent_evidence))
   or (old.start_claimed_at is not null and new.start_claimed_at is distinct from old.start_claimed_at)
   or (old.register_claimed_at is not null and new.register_claimed_at is distinct from old.register_claimed_at)
   or (old.recording_sid is not null and new.recording_sid is distinct from old.recording_sid)
   or (old.conversation_id is not null and new.conversation_id is distinct from old.conversation_id)
   or (old.provider_started_at is not null and row(new.provider_started_at,new.audio_expires_at) is distinct from row(old.provider_started_at,old.audio_expires_at))
   or (old.ended_at is not null and row(new.ended_at,new.duration_seconds) is distinct from row(old.ended_at,old.duration_seconds))
   or (old.end_requested_at is not null and new.end_requested_at is distinct from old.end_requested_at)
   or (old.call_ended_at is not null and row(new.call_ended_at,new.call_terminal_status) is distinct from row(old.call_ended_at,old.call_terminal_status))
   or (old.provider_recording_price_micros is not null and new.provider_recording_price_micros is distinct from old.provider_recording_price_micros)
   or (old.deleted_at is not null and new.deleted_at is distinct from old.deleted_at)
   or (old.settled_at is not null and row(new.settled_at,new.billing_state) is distinct from row(old.settled_at,old.billing_state)) then raise exception 'Recorded reception evidence is immutable';end if;
  if new.row_version<>old.row_version+1 then raise exception 'Recorded reception CAS required';end if;
  if old.state='deleted' and new.state<>'deleted' then raise exception 'Deleted audio cannot reopen';end if;
 end if;
 return new;
end $function$;
CREATE OR REPLACE FUNCTION public.icash_transition_recorded_reception(p_id uuid, p_account uuid, p_operation text, p_expected_version bigint, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_recorded_reception_private.sessions;t timestamptz;started timestamptz;finished timestamptz;utterance text;ns text;
begin
 select * into r from icash_recorded_reception_private.sessions where id=p_id and account_id=p_account and operation_key=p_operation and row_version=p_expected_version for update;
 if not found then return null;end if;t:=icash_recorded_reception_private.clock_now();ns:=r.state;
 if r.state='deleted' and p_action not in ('call_ended','bind_conversation','request_end') then return null;end if;
 -- Fresh work honors current paused/disabled/review state. Cleanup and receipt
 -- reconciliation deliberately remain possible after these gates close.
 if p_action in ('claim_setup','bounded','consent','authorize_recording','claim_start','claim_register') then
  if r.end_requested_at is not null or r.call_ended_at is not null or r.call_deadline_at<=t or not exists(
   select 1 from icash_recorded_reception_private.configs c join public.icash_accounts a on a.id=c.account_id and a.owner_user_id=c.owner_user_id
   join public.icash_operation_spend o on o.account_id=a.id and o.operation_key=r.operation_key
   join public.icash_operation_rates rate on rate.id=r.rate_id
   where c.id=r.config_id and c.enabled and not a.bot_paused and c.approved_at<=t and c.reviewed_until>t
    and o.state='dispatched' and o.permission_until>t and o.rate_id=r.rate_id and o.charge_cap_cents=r.charge_cap_cents
    and rate.enabled and rate.expires_at>t and icash_recorded_reception_private.rate_binding(rate)=r.rate_snapshot
    and not exists(select 1 from icash_reception_private.config where enabled)
  ) then return null;end if;
 end if;
 if p_action='claim_setup' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid setup claim';end if;
  if r.state<>'reserved' or r.setup_claimed_at is not null then return null;end if;
  r.setup_claimed_at:=t;ns:='setup_pending';r.next_reconcile_at:=t+interval '30 seconds';
 elsif p_action='bounded' then
  if not icash_recorded_reception_private.keys(p_payload,array['callSid','providerAccountSid','fromPhone','toPhone','direction','timeLimitSeconds']) then raise exception 'Invalid bound call evidence';end if;
  if r.state<>'setup_pending' or r.setup_confirmed_at is not null or r.setup_claimed_at is null
   or row(r.call_sid,r.provider_account_sid,r.from_phone,r.to_phone,r.direction) is distinct from row(p_payload->>'callSid',p_payload->>'providerAccountSid',p_payload->>'fromPhone',p_payload->>'toPhone',p_payload->>'direction')
   or p_payload->'timeLimitSeconds' is distinct from to_jsonb(r.max_total_seconds) then return null;end if;
  r.setup_confirmed_at:=t;ns:='consent_pending';r.next_reconcile_at:=r.consent_deadline_at;
 elsif p_action='bind_call_start' then
  -- Receipt binding is recoverable after pause/expiry; it grants no new work.
  -- Only the service's canonical account/Call readback can supply this value.
  if not icash_recorded_reception_private.keys(p_payload,array['callSid','providerAccountSid','fromPhone','toPhone','direction','status','callStartedAt'])
   or jsonb_typeof(p_payload->'callStartedAt') is distinct from 'string' then raise exception 'Invalid answered call evidence';end if;
  if r.setup_confirmed_at is null or r.call_started_at is not null or r.consent_at is not null
   or row(r.call_sid,r.provider_account_sid,r.from_phone,r.to_phone,r.direction) is distinct from row(p_payload->>'callSid',p_payload->>'providerAccountSid',p_payload->>'fromPhone',p_payload->>'toPhone',p_payload->>'direction')
   or coalesce(p_payload->>'status','') not in ('in-progress','completed','failed','canceled') then return null;end if;
  started:=(p_payload->>'callStartedAt')::timestamptz;
  if not isfinite(started) or started<r.created_at-interval '1 second' or started>r.created_at+interval '60 seconds' or started>t+interval '1 second'
   or started+make_interval(secs=>r.max_total_seconds)>least((r.configuration->>'reviewed_until')::timestamptz,(r.rate_snapshot->>'expires_at')::timestamptz,coalesce((r.cost_policy_snapshot->>'reviewed_until')::timestamptz,'infinity'::timestamptz)) then return null;end if;
  r.call_started_at:=started;r.call_deadline_at:=started+make_interval(secs=>r.max_total_seconds);r.consent_deadline_at:=started+interval '45 seconds';
  r.next_reconcile_at:=case when r.end_requested_at is not null or r.call_ended_at is not null then t else least(r.next_reconcile_at,r.consent_deadline_at) end;
 elsif p_action in ('setup_unknown','start_unknown','register_unknown') then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid uncertain outcome';end if;
  if (p_action='setup_unknown' and (r.setup_claimed_at is null or r.setup_confirmed_at is not null))
   or (p_action='start_unknown' and (r.start_claimed_at is null or r.recording_sid is not null))
   or (p_action='register_unknown' and (r.register_claimed_at is null or r.conversation_id is not null)) then return null;end if;
  ns:='failed';r.last_error:=p_action||'_no_retry';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='consent' then
  if r.entry_policy='direct_recorded_v1' then return null;end if;
  if p_payload ? 'evidenceVersion' then
   if not icash_recorded_reception_private.keys(p_payload,array['nonceHash','source','utterance','confidence','disclosureVersion','evidenceVersion','resultKind','confidenceBasis','confidenceReported','confidencePolicy']) then raise exception 'Invalid spoken consent evidence';end if;
   if not icash_voice_consent_private.valid_final_evidence_v4(p_payload) then return null;end if;
  else
   if not icash_recorded_reception_private.keys(p_payload,array['nonceHash','source','utterance','confidence','disclosureVersion']) or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or jsonb_typeof(p_payload->'confidence') is distinct from 'number' then raise exception 'Invalid spoken consent evidence';end if;
   utterance:=lower(btrim(regexp_replace(btrim(p_payload->>'utterance'),'[.!]+$','')));
   if (p_payload->>'confidence')::numeric not between 0.9 and 1 or utterance not in ('yes','yeah','yep','sure','yes please','yes that''s okay','yes you can record','yes i agree','i agree','i consent','yes you may record') then return null;end if;
  end if;
  if length(p_payload->>'utterance') not between 1 and 120 or r.state<>'consent_pending' or r.call_started_at is null or r.consent_at is not null or r.consent_deadline_at<=t or r.nonce_hash is distinct from p_payload->>'nonceHash'
   or r.disclosure_version is distinct from p_payload->>'disclosureVersion' or p_payload->>'source' is distinct from 'twilio_gather_speech' then return null;end if;
  r.consent_at:=t;r.consent_evidence:=jsonb_build_object('method','speech','source','twilio_gather_speech','utterance',case when p_payload ? 'evidenceVersion' then p_payload->>'utterance' else btrim(p_payload->>'utterance') end,'confidence',p_payload->'confidence','accountSid',r.provider_account_sid,'callSid',r.call_sid,'disclosureVersion',r.disclosure_version);
  if p_payload ? 'evidenceVersion' then r.consent_evidence:=r.consent_evidence||jsonb_build_object('evidenceVersion',p_payload->>'evidenceVersion','resultKind','gather_action_final','confidenceBasis',p_payload->>'confidenceBasis','confidenceReported',p_payload->'confidenceReported','confidencePolicy','advisory');end if;
 elsif p_action='contact_opt_out' then
  if not icash_recorded_reception_private.keys(p_payload,array['nonceHash','utterance']) or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or length(p_payload->>'utterance') not between 1 and 16384 then raise exception 'Invalid contact opt-out';end if;
  if r.state<>'consent_pending' or r.start_claimed_at is not null or r.nonce_hash is distinct from p_payload->>'nonceHash' or not icash_voice_consent_private.contact_opt_out_v3(p_payload->>'utterance') then return null;end if;
  if r.from_phone ~ '^\+[1-9][0-9]{7,14}$' then
   insert into public.icash_text_suppressions(phone,reason) values(r.from_phone,'voice_recording_gate_opt_out:'||r.id::text) on conflict(phone) do nothing;
  end if;
  ns:='declined';r.last_error:='contact_opt_out';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='decline' then
  if not icash_recorded_reception_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') not in ('declined','timeout','ambiguous') then raise exception 'Invalid decline';end if;
  if r.state<>'consent_pending' or r.start_claimed_at is not null then return null;end if;
  ns:='declined';r.last_error:=p_payload->>'reason';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='authorize_recording' then
  -- Operator-authorized recording. This is NOT a caller's spoken yes; consent evidence remains null.
  if not icash_recorded_reception_private.keys(p_payload,array['nonceHash','policy']) then raise exception 'Invalid recording authority';end if;
  if r.entry_policy<>'direct_recorded_v1' or p_payload->>'policy'<>'direct_recorded_v1' or r.nonce_hash is distinct from p_payload->>'nonceHash'
   or r.state<>'consent_pending' or r.consent_at is not null or r.recording_authorized_at is not null or r.start_claimed_at is not null
   or r.consent_deadline_at<=t or r.call_started_at is null or r.setup_confirmed_at is null then return null;end if;
  r.recording_authorized_at:=t;
 elsif p_action='claim_start' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid start claim';end if;
  if r.state<>'consent_pending' or coalesce(r.consent_at,r.recording_authorized_at) is null or r.start_claimed_at is not null or r.consent_deadline_at<=t then return null;end if;
  ns:='starting';r.start_claimed_at:=t;r.next_reconcile_at:=t+interval '30 seconds';
 elsif p_action in ('started','processing','available') then
  if not icash_recorded_reception_private.keys(p_payload,case when p_action='available' then array['recordingSid','providerStartedAt','endedAt','durationSeconds'] else array['recordingSid','providerStartedAt'] end,case when p_action='available' then array['providerRecordingPriceMicros'] else '{}'::text[] end)
   or coalesce(p_payload->>'recordingSid','') !~ '^RE[0-9a-fA-F]{32}$' or jsonb_typeof(p_payload->'providerStartedAt') is distinct from 'string' then raise exception 'Invalid recording evidence';end if;
  if r.start_claimed_at is null or coalesce(r.consent_at,r.recording_authorized_at) is null or r.state not in ('starting','recording','stopping','processing','available','failed','absent') then return null;end if;
  started:=(p_payload->>'providerStartedAt')::timestamptz;
  if not isfinite(started) or started<coalesce(r.consent_at,r.recording_authorized_at)-interval '1 second' or started>t+interval '1 minute' or started>r.call_deadline_at
   or (r.recording_sid is not null and r.recording_sid is distinct from p_payload->>'recordingSid')
   or (r.provider_started_at is not null and r.provider_started_at is distinct from started
    and not (p_action='available' and started>r.provider_started_at and started<=r.provider_started_at+interval '1 second'))
   or (p_action='available' and r.final_provider_started_at is not null and r.final_provider_started_at is distinct from started) then return null;end if;
  -- Keep the initial start and earliest retention deadline immutable. Final
  -- whole-second provider metadata may advance by at most one second.
  r.recording_sid:=p_payload->>'recordingSid';r.provider_started_at:=coalesce(r.provider_started_at,started);r.audio_expires_at:=r.provider_started_at+interval '720 hours';r.next_delete_at:=coalesce(r.next_delete_at,r.audio_expires_at);
  if p_action='available' then
   if not icash_recorded_reception_private.micros(p_payload->'durationSeconds') or (p_payload->>'durationSeconds')::numeric>r.max_total_seconds
    or jsonb_typeof(p_payload->'endedAt') is distinct from 'string'
    or (p_payload ? 'providerRecordingPriceMicros' and not icash_recorded_reception_private.micros(p_payload->'providerRecordingPriceMicros')) then raise exception 'Invalid completed recording';end if;
   finished:=(p_payload->>'endedAt')::timestamptz;
   if not isfinite(finished) or finished<>started+make_interval(secs=>(p_payload->>'durationSeconds')::integer) or finished>t+interval '1 minute' or finished>r.call_deadline_at+interval '2 seconds'
    or (r.ended_at is not null and row(r.ended_at,r.duration_seconds) is distinct from row(finished,(p_payload->>'durationSeconds')::integer))
    or (r.provider_recording_price_micros is not null and r.provider_recording_price_micros is distinct from (p_payload->>'providerRecordingPriceMicros')::bigint) then return null;end if;
   r.final_provider_started_at:=started;r.ended_at:=finished;r.duration_seconds:=(p_payload->>'durationSeconds')::integer;r.provider_recording_price_micros:=(p_payload->>'providerRecordingPriceMicros')::bigint;r.price_is_estimate:=r.provider_recording_price_micros is null;
   ns:=case when r.audio_expires_at<=t then 'expired' else 'available' end;
  elsif p_action='processing' then ns:='processing';
  else ns:=case when r.end_requested_at is not null then 'stopping' when r.state in ('processing','available') then r.state else 'recording' end;end if;
  r.next_reconcile_at:=t+interval '1 minute';
 elsif p_action='claim_register' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid registration claim';end if;
  if r.state<>'recording' or r.recording_sid is null or r.register_claimed_at is not null or r.conversation_id is not null then return null;end if;
  r.register_claimed_at:=t;r.next_reconcile_at:=t+interval '30 seconds';
 elsif p_action='bind_conversation' then
  if not icash_recorded_reception_private.keys(p_payload,array['conversationId','agentId','branchId','versionId']) or coalesce(p_payload->>'conversationId','') !~ '^conv_[A-Za-z0-9_-]{1,160}$' then raise exception 'Invalid conversation evidence';end if;
  if r.register_claimed_at is null or r.recording_sid is null or r.conversation_id is not null
   or row(r.agent_id,r.branch_id,r.version_id) is distinct from row(p_payload->>'agentId',p_payload->>'branchId',p_payload->>'versionId') then return null;end if;
  r.conversation_id:=p_payload->>'conversationId';r.next_reconcile_at:=t;
 elsif p_action in ('stop','request_end','fail') then
  if p_action='stop' then
   if not icash_recorded_reception_private.keys(p_payload,array['stopTokenHash']) then raise exception 'Invalid stop request';end if;
   if r.stop_token_hash is distinct from p_payload->>'stopTokenHash' or r.start_claimed_at is null then return null;end if;
   if r.state not in ('available','expired','deletion_pending','deleted','absent') then ns:='stopping';end if;
  else
   if not icash_recorded_reception_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') !~ '^[a-z0-9_:-]{1,160}$' then raise exception 'Invalid end reason';end if;
   r.last_error:=p_payload->>'reason';if p_action='fail' and r.state not in ('available','expired','deletion_pending','deleted','absent') then ns:='failed';end if;
  end if;
  r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='call_ended' then
  if not icash_recorded_reception_private.keys(p_payload,array['callSid','providerAccountSid','fromPhone','toPhone','direction','status']) then raise exception 'Invalid call receipt';end if;
  if row(r.call_sid,r.provider_account_sid,r.from_phone,r.to_phone,r.direction) is distinct from row(p_payload->>'callSid',p_payload->>'providerAccountSid',p_payload->>'fromPhone',p_payload->>'toPhone',p_payload->>'direction') or coalesce(p_payload->>'status','') not in ('completed','failed','busy','no-answer','canceled')
   or (r.call_terminal_status is not null and r.call_terminal_status is distinct from p_payload->>'status') then return null;end if;
  r.call_ended_at:=coalesce(r.call_ended_at,t);r.call_terminal_status:=p_payload->>'status';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
  if r.start_claimed_at is null and r.state not in ('declined','failed') then ns:='failed';r.last_error:=coalesce(r.last_error,'carrier_terminal_before_recording');end if;
 elsif p_action='absent' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid absent evidence';end if;
  if r.start_claimed_at is null or r.state in ('available','expired','deletion_pending','deleted') then return null;end if;
  ns:='absent';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='expire' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid expiry';end if;
  if r.recording_sid is null or r.audio_expires_at>t or r.state in ('deletion_pending','deleted') then return null;end if;
  ns:='expired';r.next_delete_at:=t;
 else raise exception 'Unknown recorded reception action';end if;
 update icash_recorded_reception_private.sessions set state=ns,call_started_at=r.call_started_at,call_deadline_at=r.call_deadline_at,consent_deadline_at=r.consent_deadline_at,setup_claimed_at=r.setup_claimed_at,setup_confirmed_at=r.setup_confirmed_at,consent_at=r.consent_at,consent_evidence=r.consent_evidence,recording_authorized_at=r.recording_authorized_at,start_claimed_at=r.start_claimed_at,register_claimed_at=r.register_claimed_at,
  recording_sid=r.recording_sid,conversation_id=r.conversation_id,provider_started_at=r.provider_started_at,final_provider_started_at=r.final_provider_started_at,ended_at=r.ended_at,duration_seconds=r.duration_seconds,audio_expires_at=r.audio_expires_at,
  provider_recording_price_micros=r.provider_recording_price_micros,price_is_estimate=r.price_is_estimate,end_requested_at=r.end_requested_at,call_ended_at=r.call_ended_at,call_terminal_status=r.call_terminal_status,
  next_reconcile_at=r.next_reconcile_at,next_delete_at=r.next_delete_at,last_error=r.last_error,last_action=p_action,row_version=row_version+1,updated_at=t where id=r.id returning * into r;
 return to_jsonb(r);
end $function$;
commit;
