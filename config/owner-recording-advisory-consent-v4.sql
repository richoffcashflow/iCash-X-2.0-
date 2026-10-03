-- Future owner calls use advisory confidence only with complete bound final affirmative evidence.
-- Previous evidence versions, allowance, history, lock order and recovery remain unchanged.
begin;
create or replace function public.icash_transition_owner_recording_test(p_id uuid,p_version bigint,p_action text,p_payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_owner_recording_test_runs;t timestamptz:=icash_owner_recording_private.clock_now();s text;started timestamptz;amount bigint;
begin
 -- One lock order for admission, attestations and every transition: config, then runs.
 perform 1 from public.icash_owner_recording_test_config where id=(select config_id from public.icash_owner_recording_test_runs where id=p_id) for update;
 if not found then return null;end if;
 select * into r from public.icash_owner_recording_test_runs where id=p_id and row_version=p_version for update;if not found then return null;end if;t:=icash_owner_recording_private.clock_now();
 if p_payload is null or jsonb_typeof(p_payload)<>'object' then raise exception 'Owner test payload required';end if;
 if p_action in ('consent','claim_start','claim_register') and (r.end_requested_at is not null or not exists(select 1 from public.icash_owner_recording_test_config c join public.icash_accounts a on a.id=c.account_id where c.id=r.config_id and c.enabled and c.expires_at>t and a.owner_user_id=r.owner_user_id)) then return null;end if;
 if p_action='bind_call' then
  if r.call_sid is not null or coalesce(p_payload->>'callSid','')!~'^CA[0-9a-fA-F]{32}$' or p_payload->>'accountSid' is distinct from r.configuration->'review'->>'providerAccountSid' or p_payload->>'from' is distinct from r.configuration->>'from_phone' or p_payload->>'to' is distinct from r.configuration->>'phone' then return null;end if;
  r.call_sid:=p_payload->>'callSid';r.call_started_at:=(p_payload->>'startedAt')::timestamptz;if r.call_started_at is not null and (not isfinite(r.call_started_at) or r.call_started_at<r.created_at-interval '5 seconds' or r.call_started_at>t+interval '1 minute') then return null;end if;
 elsif p_action='answered' then
  started:=(p_payload->>'startedAt')::timestamptz;if r.call_sid is null or r.call_started_at is not null or started is null or not isfinite(started) or started<r.created_at-interval '5 seconds' or started>t+interval '1 minute' then return null;end if;r.call_started_at:=started;
 elsif p_action='consent' then
  s:=lower(trim(regexp_replace(trim(p_payload->>'utterance'),'[.!]+$','','g')));
  if r.state<>'consent_pending' or r.consent_at is not null or r.call_sid is null or r.call_started_at is null or t>r.call_started_at+interval '45 seconds' or p_payload->>'nonceHash' is distinct from r.nonce_hash or p_payload->>'source' is distinct from 'twilio_gather_speech' or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or length(p_payload->>'utterance')>120 then return null;end if;
  if p_payload->>'evidenceVersion'='owner-final-natural-affirmative-advisory-v4' then
   if not icash_voice_consent_private.keys(p_payload,array['nonceHash','source','utterance','confidence','confidenceReported','confidenceBasis','evidenceVersion','resultKind','confidencePolicy'])
    or not icash_voice_consent_private.valid_final_evidence_v4(p_payload,'owner-final-natural-affirmative-advisory-v4') then return null;end if;
   r.consent_evidence:=jsonb_build_object('utterance',p_payload->>'utterance','confidence',p_payload->'confidence','confidenceReported',p_payload->'confidenceReported','confidenceBasis',p_payload->>'confidenceBasis','confidencePolicy','advisory','source','twilio_gather_speech','resultKind','gather_action_final','evidenceVersion','owner-final-natural-affirmative-advisory-v4','disclosureVersion','owner-recorded-60s-v1');
  else
  if p_payload->>'evidenceVersion'='owner-final-natural-affirmative-v3' then
   if not icash_owner_recording_private.natural_affirmative_v3(p_payload->>'utterance') then return null;end if;
  elsif s not in ('yes','yeah','yep','sure','yes please','yes that''s okay','yes you can record','yes i agree','i agree','i consent','yes you may record') then return null;end if;
  if p_payload ? 'evidenceVersion' then
   if coalesce(p_payload->>'evidenceVersion','') not in ('owner-final-affirmative-optional-confidence-v2','owner-final-natural-affirmative-v3') or p_payload->>'resultKind' is distinct from 'gather_action_final' or not (p_payload ? 'confidence') or not (p_payload ? 'confidenceReported') then return null;end if;
   if jsonb_typeof(p_payload->'confidence')='null' then
    if p_payload->>'confidenceBasis' is distinct from 'not_provided' or jsonb_typeof(p_payload->'confidenceReported') is distinct from 'null' then return null;end if;
   elsif jsonb_typeof(p_payload->'confidence')='number' then
    if (p_payload->>'confidence')::numeric not between 0.9 and 1 or p_payload->>'confidenceBasis' is distinct from 'provider_reported' then return null;end if;
    if jsonb_typeof(p_payload->'confidenceReported') is distinct from 'string' or (p_payload->>'confidenceReported') !~ '^(0|1|0?\.[0-9]{1,30}|1\.[0-9]{1,30})$' then return null;end if;
    if (p_payload->>'confidenceReported')::numeric not between 0.9 and 1 or (p_payload->>'confidenceReported')::double precision is distinct from (p_payload->>'confidence')::double precision then return null;end if;
   else return null;end if;
   r.consent_evidence:=jsonb_build_object('utterance',p_payload->>'utterance','confidence',p_payload->'confidence','confidenceReported',p_payload->'confidenceReported','confidenceBasis',p_payload->>'confidenceBasis','source','twilio_gather_speech','resultKind','gather_action_final','evidenceVersion',p_payload->>'evidenceVersion','disclosureVersion','owner-recorded-60s-v1');
  else
   -- Backward compatible SQL-first deployment: v1 still requires its original reported score.
   if jsonb_typeof(p_payload->'confidence') is distinct from 'number' or (p_payload->>'confidence')::numeric not between 0.9 and 1 then return null;end if;
   r.consent_evidence:=jsonb_build_object('utterance',p_payload->>'utterance','confidence',p_payload->'confidence','source','twilio_gather_speech','disclosureVersion','owner-recorded-60s-v1');
  end if;
  end if;
  r.consent_at:=t;
 elsif p_action='claim_start' then
  if r.state<>'consent_pending' or r.consent_at is null or r.start_claimed_at is not null or r.end_requested_at is not null or t>r.call_started_at+interval '50 seconds' then return null;end if;r.start_claimed_at:=t;r.state:='starting';
 elsif p_action='started' then
  if r.start_claimed_at is null or r.consent_at is null or coalesce(p_payload->>'recordingSid','')!~'^RE[0-9a-fA-F]{32}$' or r.recording_sid is not null and r.recording_sid is distinct from p_payload->>'recordingSid' then return null;end if;
  started:=(p_payload->>'startedAt')::timestamptz;if not isfinite(started) or started<r.consent_at-interval '1 second' or started>t+interval '1 minute' then return null;end if;
  r.recording_sid:=p_payload->>'recordingSid';r.provider_started_at:=started;r.audio_expires_at:=started+interval '720 hours';if r.end_requested_at is null then r.state:='recording';end if;
 elsif p_action='claim_register' then
  if r.state<>'recording' or r.recording_sid is null or r.registration_claimed_at is not null or r.end_requested_at is not null then return null;end if;r.registration_claimed_at:=t;
 elsif p_action='end_request' then r.end_requested_at:=coalesce(r.end_requested_at,t);if r.state not in ('available','deleted','declined','failed','absent') then r.state:='stopping';end if;
 elsif p_action='ended' then
  if r.call_sid is null or r.end_requested_at is null or r.call_sid is distinct from p_payload->>'callSid' or p_payload->>'accountSid' is distinct from r.configuration->'review'->>'providerAccountSid' or p_payload->>'status' not in ('completed','failed','busy','no-answer','canceled') then return null;end if;r.call_ended_at:=coalesce(r.call_ended_at,t);
 elsif p_action='contact_opt_out' then
  if r.start_claimed_at is not null then return null;end if;r.contact_opted_out:=true;r.state:='declined';
 elsif p_action in ('decline','fail') then
  if r.start_claimed_at is not null then return null;end if;r.state:=case when p_action='decline' then 'declined' else 'failed' end;r.last_error:=left(p_payload->>'reason',160);
 elsif p_action='conversation' then
  if r.registration_claimed_at is null or r.recording_sid is null or coalesce(p_payload->>'conversationId','')!~'^conv_[A-Za-z0-9]+$' or r.conversation_id is not null and r.conversation_id is distinct from p_payload->>'conversationId' then return null;end if;r.conversation_id:=p_payload->>'conversationId';
 elsif p_action='absent_audio' then
  if r.recording_sid is null or r.recording_sid is distinct from p_payload->>'recordingSid' or r.deleted_at is not null or r.end_requested_at is null then return null;end if;r.state:='absent';
 elsif p_action='completed_audio' then
  if r.recording_sid is null or p_payload->>'recordingSid' is distinct from r.recording_sid or jsonb_typeof(p_payload->'durationSeconds') is distinct from 'number' or (p_payload->>'durationSeconds')::numeric<>trunc((p_payload->>'durationSeconds')::numeric) or (p_payload->>'durationSeconds')::integer not between 0 and 60 then return null;end if;
  r.duration_seconds:=(p_payload->>'durationSeconds')::integer;r.recording_price_micros:=(p_payload->>'priceMicros')::bigint;r.state:='available';
 elsif p_action='settle' then
  amount:=(p_payload->>'totalMicros')::bigint;
  if r.call_ended_at is null or amount is null or amount<0 or jsonb_typeof(p_payload->'items') is distinct from 'array' or r.registration_claimed_at is not null and r.conversation_id is null then return null;end if;
  if jsonb_array_length(p_payload->'items') not between 2 and 6 or exists(select 1 from jsonb_array_elements(p_payload->'items') x where jsonb_typeof(x->'micros') is distinct from 'number' or (x->>'micros')::numeric<0 or (x->>'micros')::numeric<>trunc((x->>'micros')::numeric) or coalesce(x->>'provider','') not in ('twilio','elevenlabs') or coalesce(x->>'basis','') not in ('observed','estimated','not_applicable')) then return null;end if;
  if (select sum((x->>'micros')::bigint) from jsonb_array_elements(p_payload->'items') x) is distinct from amount then return null;end if;
  if p_payload->'carrier'->>'callSid' is distinct from r.call_sid or p_payload->'carrier'->>'accountSid' is distinct from r.configuration->'review'->>'providerAccountSid' or p_payload->'carrier'->>'from' is distinct from r.configuration->>'from_phone' or p_payload->'carrier'->>'to' is distinct from r.configuration->>'phone' or p_payload->'carrier'->>'currency' is distinct from 'USD' or coalesce(p_payload->'carrier'->>'status','') not in ('completed','failed','busy','no-answer','canceled') then return null;end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items') x where x->>'provider'='twilio' and x->>'label'='Call' and x->>'basis'='observed' and x->>'receipt'=r.call_sid and x->'micros'=p_payload->'carrier'->'priceMicros')<>1 then return null;end if;
  if (select count(*) from jsonb_array_elements(p_payload->'items') x where x->>'provider'='elevenlabs' and case when r.registration_claimed_at is null then x->>'basis'='not_applicable' and (x->>'micros')::bigint=0 else x->>'basis'='observed' and x->>'receipt'=r.conversation_id end)<>1 then return null;end if;
  if r.settlement is not null then if r.settlement is distinct from p_payload then raise exception 'Owner cost receipt conflict';end if;return to_jsonb(r);end if;
  r.settled_micros:=amount;r.settlement:=p_payload;r.settled_at:=t;
  if amount>r.reserved_micros then
   r.last_error:='cost_exceeded_reviewed_allowance';
   -- Preserve the observed overrun and require termination of any later active attempt.
   update public.icash_owner_recording_test_runs set end_requested_at=coalesce(end_requested_at,t),state=case when state in ('available','deleted','declined','failed','absent') then state else 'stopping' end,row_version=row_version+1,updated_at=t,next_work_at=t
   where config_id=r.config_id and id<>r.id and call_ended_at is null;
  end if;
 elsif p_action='deleted' then
  if r.recording_sid is null or r.audio_expires_at>t then return null;end if;r.deleted_at:=coalesce(r.deleted_at,t);r.state:='deleted';
 elsif p_action='retry' then r.last_error:=left(p_payload->>'reason',160);
 else raise exception 'Invalid owner recording transition';end if;
 update public.icash_owner_recording_test_runs set state=r.state,call_sid=r.call_sid,call_started_at=r.call_started_at,recording_sid=r.recording_sid,conversation_id=r.conversation_id,consent_at=r.consent_at,consent_evidence=r.consent_evidence,start_claimed_at=r.start_claimed_at,registration_claimed_at=r.registration_claimed_at,end_requested_at=r.end_requested_at,call_ended_at=r.call_ended_at,provider_started_at=r.provider_started_at,audio_expires_at=r.audio_expires_at,duration_seconds=r.duration_seconds,recording_price_micros=r.recording_price_micros,settled_micros=r.settled_micros,settlement=r.settlement,settled_at=r.settled_at,deleted_at=r.deleted_at,last_error=r.last_error,contact_opted_out=r.contact_opted_out,row_version=row_version+1,updated_at=t,next_work_at=case when p_action='retry' then t+interval '1 minute' else t end where id=r.id returning * into r;return to_jsonb(r);
end $$;
revoke all on function public.icash_transition_owner_recording_test(uuid,bigint,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_transition_owner_recording_test(uuid,bigint,text,jsonb) to service_role;
commit;
