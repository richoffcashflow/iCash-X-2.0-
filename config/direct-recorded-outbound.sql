-- Owner approved October 7, 2026, 10:44 PM America/Chicago: keep call audio,
-- skip the spoken introduction and recording question on all business calls.
-- No spoken response/consent is manufactured. Existing historical evidence is immutable.
begin;
alter table public.icash_call_recordings add column entry_policy text not null default 'spoken_v1' check(entry_policy in ('spoken_v1','direct_recorded_v1')),
 add column recording_authorized_at timestamptz,
 add constraint direct_recording_authority check(recording_authorized_at is null or (entry_policy='direct_recorded_v1' and isfinite(recording_authorized_at) and consent_at is null and consent_evidence is null and recording_authorized_at>=created_at));
-- Preserve every historical check; extend only the recording authorization operand.
do $constraints$ declare c record; definition text;begin
 for c in select conname,pg_get_constraintdef(oid) d from pg_constraint where conrelid='public.icash_call_recordings'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%consent_at IS NOT NULL%' and (pg_get_constraintdef(oid) like '%start_claimed_at%' or pg_get_constraintdef(oid) like '%recording_sid%' or pg_get_constraintdef(oid) like '%register_claimed_at%') loop
  definition:=replace(c.d,'consent_at IS NOT NULL','COALESCE(consent_at, recording_authorized_at) IS NOT NULL');
  execute format('alter table public.icash_call_recordings drop constraint %I, add constraint %I %s',c.conname,c.conname,definition);
 end loop;
end $constraints$;
CREATE OR REPLACE FUNCTION icash_recording_private.guard()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Recording audit cannot be removed';end if;
 if tg_op='INSERT' then
  if new.state<>'consent_pending' or new.row_version<>1 or new.recording_authorized_at is not null or new.consent_at is not null or new.recording_sid is not null
   or new.start_claimed_at is not null or new.dial_claimed_at is not null then raise exception 'Initial recording state required';end if;
 else
  if row(new.id,new.account_id,new.operation_key,new.voice_job_id,new.permission_id,new.operational_contact_id,new.screening_id,new.party,new.call_context,new.provider_account_sid,new.to_phone,new.from_phone,new.contact_key,
   new.agent_id,new.branch_id,new.version_id,new.rate_id,new.charge_cap_cents,new.max_total_seconds,new.nonce_hash,new.stop_token_hash,
   new.entry_policy,new.disclosure_version,new.pricing_policy,new.created_at,new.consent_deadline_at)
   is distinct from row(old.id,old.account_id,old.operation_key,old.voice_job_id,old.permission_id,old.operational_contact_id,old.screening_id,old.party,old.call_context,old.provider_account_sid,old.to_phone,old.from_phone,old.contact_key,
   old.agent_id,old.branch_id,old.version_id,old.rate_id,old.charge_cap_cents,old.max_total_seconds,old.nonce_hash,old.stop_token_hash,
   old.entry_policy,old.disclosure_version,old.pricing_policy,old.created_at,old.consent_deadline_at) then raise exception 'Recording identity and policy are immutable';end if;
  if (old.recording_authorized_at is not null and new.recording_authorized_at is distinct from old.recording_authorized_at)
   or (old.call_sid is not null and new.call_sid is distinct from old.call_sid)
   or (old.recording_sid is not null and new.recording_sid is distinct from old.recording_sid)
   or (old.conversation_id is not null and new.conversation_id is distinct from old.conversation_id)
   or (old.consent_at is not null and row(new.consent_at,new.consent_evidence) is distinct from row(old.consent_at,old.consent_evidence))
   or (old.dial_claimed_at is not null and new.dial_claimed_at is distinct from old.dial_claimed_at)
   or (old.start_claimed_at is not null and new.start_claimed_at is distinct from old.start_claimed_at)
   or (old.provider_started_at is not null and row(new.provider_started_at,new.audio_expires_at) is distinct from row(old.provider_started_at,old.audio_expires_at))
   or (old.end_requested_at is not null and new.end_requested_at is distinct from old.end_requested_at)
   or (old.call_ended_at is not null and new.call_ended_at is distinct from old.call_ended_at)
   or (old.provider_recording_price_micros is not null and new.provider_recording_price_micros is distinct from old.provider_recording_price_micros)
   then raise exception 'Recording evidence is immutable';end if;
  if old.state='deleted' then raise exception 'Deleted recording is immutable';end if;
  if new.row_version<>old.row_version+1 then raise exception 'Recording CAS version required';end if;
 end if;
 return new;
end $function$;
CREATE OR REPLACE FUNCTION public.icash_create_direct_recorded_call(p_account uuid, p_operation text, p_provider_account_sid text, p_call_sid text, p_nonce_hash text, p_stop_token_hash text, p_disclosure_version text, p_pricing_policy jsonb, p_context jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r public.icash_call_recordings; b record;t timestamptz:=icash_recording_private.clock_now();
begin
 if p_account is null or p_operation is null or length(p_operation) not between 1 and 160
  or coalesce(p_provider_account_sid,'') !~ '^AC[0-9a-fA-F]{32}$'
  or (p_call_sid is not null and p_call_sid !~ '^CA[0-9a-fA-F]{32}$')
  or coalesce(p_nonce_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_stop_token_hash,'') !~ '^[a-f0-9]{64}$'
  or p_disclosure_version is null or length(btrim(p_disclosure_version)) not between 1 and 100
  or not icash_recording_private.keys(p_context,array['fromPhone','branchId','versionId','maxTotalSeconds'],array['callContext'])
  or coalesce(p_context->>'fromPhone','') !~ '^\+[1-9][0-9]{7,14}$'
  or coalesce(p_context->>'branchId','') !~ '^agtbrch_[A-Za-z0-9]{1,160}$'
  or coalesce(p_context->>'versionId','') !~ '^agtvrsn_[A-Za-z0-9]{1,160}$'
  or coalesce(p_context->>'maxTotalSeconds','') !~ '^(120|180|240|300|360|420|480|540|600)$'
  or p_pricing_policy is distinct from '{"version":"required-audio-30d-speech-v1","retentionDays":30,"recordingMicrosPerMinute":2500,"storageMicrosPerMinuteMonth":500,"recordingAllowanceMicros":31000,"speechGatherMicros":20000,"estimate":true}'::jsonb
  then raise exception 'Invalid recording session input';end if;
 if p_context ? 'callContext' then
  if not icash_recording_private.keys(p_context->'callContext',array['principal','assistantName','firstMessage','prompt','strategyKey'],array['voiceId'])
   or jsonb_typeof(p_context->'callContext'->'principal') is distinct from 'string' or length(p_context->'callContext'->>'principal') not between 1 and 160
   or jsonb_typeof(p_context->'callContext'->'assistantName') is distinct from 'string' or length(p_context->'callContext'->>'assistantName') not between 1 and 160
   or jsonb_typeof(p_context->'callContext'->'firstMessage') is distinct from 'string' or length(p_context->'callContext'->>'firstMessage') not between 1 and 2000
   or jsonb_typeof(p_context->'callContext'->'prompt') is distinct from 'string' or length(p_context->'callContext'->>'prompt') not between 1 and 24000
   or (p_context->'callContext' ? 'voiceId' and (jsonb_typeof(p_context->'callContext'->'voiceId') is distinct from 'string' or p_context->'callContext'->>'voiceId' !~ '^[A-Za-z0-9_-]{1,100}$'))
   or coalesce(p_context->'callContext'->>'strategyKey','') not in ('cash_interest','flexible_timing') then raise exception 'Invalid bound call context';end if;
 end if;
 select * into r from public.icash_call_recordings where operation_key=p_operation;
 if found then
  if r.entry_policy<>'direct_recorded_v1' then return null;end if;
  if row(r.account_id,r.provider_account_sid,r.nonce_hash,r.stop_token_hash,r.disclosure_version,r.pricing_policy,r.from_phone,r.branch_id,r.version_id,r.call_context)
   is distinct from row(p_account,p_provider_account_sid,p_nonce_hash,p_stop_token_hash,p_disclosure_version,p_pricing_policy,p_context->>'fromPhone',p_context->>'branchId',p_context->>'versionId',p_context->'callContext')
   or (p_call_sid is not null and r.call_sid is distinct from p_call_sid) then return null;end if;
  return to_jsonb(r);
 end if;
 select j.id as job_id,j.permission_id,j.operational_contact_id,p.screening_id,p.party,p.phone,p.contact_key,c.agent_id,o.rate_id,o.charge_cap_cents into b
 from public.icash_operation_spend o
 join public.icash_voice_jobs j on j.account_id=o.account_id and j.operation_key=o.operation_key and o.operation_key='voice:'||j.id
 join public.icash_voice_contact_targets p on p.id=coalesce(j.permission_id,j.operational_contact_id) and p.account_id=j.account_id
 join public.icash_voice_configs c on c.account_id=j.account_id
 join public.icash_operation_rates rate on rate.id=o.rate_id and rate.operation=case p.party when 'seller' then 'seller_call' when 'buyer' then 'buyer_call' end
 where o.operation_key=p_operation and o.account_id=p_account and o.state='dispatched'
  and o.permission_until>t and o.customer_price_micros is null and rate.charge_cents=977 and o.charge_cap_cents=coalesce((public.icash_voice_credit_bound(p_account,p_operation,o.rate_id)->>'charge_cents')::bigint,977)
 and (p_context->>'maxTotalSeconds')::integer=coalesce((public.icash_voice_credit_bound(p_account,p_operation,o.rate_id)->>'max_seconds')::integer,600) and rate.voice_max_duration_seconds=600
  and j.state in ('dispatching','dispatched') and (j.provider_call_sid is null or j.provider_call_sid=p_call_sid)
  and j.conversation_id is null and p.revoked_at is null and p.permission_until>t and (p.dnc_clear or public.icash_seller_voice_permission_current(j.account_id,p.id))
  and c.enabled and c.reviewed_until>t and c.agent_id is not null and c.max_duration_seconds=600
  and exists(select 1 from public.icash_accounts a where a.id=o.account_id and not a.bot_paused)
  and o.rate_id=case p.party when 'seller' then c.seller_rate_id when 'buyer' then c.buyer_rate_id end
  and not exists(select 1 from public.icash_live_conversations lc where lc.operation_key=o.operation_key)
 for share of o,j,p,c,rate;
 if not found then return null;end if;
 insert into public.icash_call_recordings(entry_policy,account_id,operation_key,voice_job_id,permission_id,operational_contact_id,screening_id,party,call_context,provider_account_sid,call_sid,
  to_phone,from_phone,contact_key,agent_id,branch_id,version_id,rate_id,charge_cap_cents,max_total_seconds,
  nonce_hash,stop_token_hash,disclosure_version,pricing_policy,created_at,consent_deadline_at,updated_at,next_reconcile_at)
 values('direct_recorded_v1',p_account,p_operation,b.job_id,b.permission_id,b.operational_contact_id,b.screening_id,b.party,p_context->'callContext',p_provider_account_sid,p_call_sid,b.phone,p_context->>'fromPhone',b.contact_key,b.agent_id,
  p_context->>'branchId',p_context->>'versionId',b.rate_id,b.charge_cap_cents,(p_context->>'maxTotalSeconds')::integer,p_nonce_hash,p_stop_token_hash,p_disclosure_version,p_pricing_policy,
  t,t+interval '2 minutes',t,t+interval '2 minutes') on conflict do nothing returning * into r;
 if not found then return null;end if;
 return to_jsonb(r);
end $function$;
CREATE OR REPLACE FUNCTION public.icash_transition_call_recording(p_id uuid, p_account uuid, p_operation text, p_expected_state text, p_action text, p_payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$

declare r public.icash_call_recordings;t timestamptz;ns text;started timestamptz;finished timestamptz;dur integer;price bigint;utterance text;
begin
 select * into r from public.icash_call_recordings where id=p_id and account_id=p_account and operation_key=p_operation and state=p_expected_state for update;
 if not found or r.state='deleted' then return null;end if;
 t:=icash_recording_private.clock_now();ns:=r.state;
 -- New provider work honors current stop/permission state. Reconciliation and
 -- deletion intentionally do not use this admission gate.
 if p_action in ('claim_dial','authorize_recording','claim_start') and not exists(
  select 1 from public.icash_accounts a join public.icash_voice_configs c on c.account_id=a.id
  join public.icash_voice_contact_targets cp on cp.id=coalesce(r.permission_id,r.operational_contact_id) and cp.account_id=a.id
  join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=a.id
  where a.id=r.account_id and not a.bot_paused and c.enabled and c.reviewed_until>t
   and cp.revoked_at is null and cp.permission_until>t and (cp.dnc_clear or public.icash_seller_voice_permission_current(r.account_id,cp.id)) and o.state='dispatched' and o.permission_until>t
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
 elsif p_action='notice_continue' then
  if r.entry_policy='direct_recorded_v1' then return null;end if;
  if not icash_recording_private.keys(p_payload,array['nonceHash','source','utterance','disclosureVersion','noticeVersion','resultKind','confidenceReported']) then raise exception 'Exact seller notice continuation required';end if;
  if r.party<>'seller' or p_payload->>'noticeVersion' is distinct from 'seller-notice-continued-speech-20261007'
   or p_payload->>'resultKind' is distinct from 'gather_action_final'
   or jsonb_typeof(p_payload->'utterance') is distinct from 'string'
   or not icash_recording_private.valid_seller_notice_continuation(p_payload->>'utterance') then return null;end if;
  if p_payload->'confidenceReported'<>'null'::jsonb then
   if jsonb_typeof(p_payload->'confidenceReported') is distinct from 'string' or p_payload->>'confidenceReported' !~ '^(0|1|0?\.[0-9]{1,30}|1\.0{1,30})$' then return null;end if;
   if (p_payload->>'confidenceReported')::numeric not between 0 and 1 then return null;end if;
  end if;
  if r.state<>'consent_pending' or r.consent_at is not null or r.call_sid is null or r.consent_deadline_at<=t
   or r.nonce_hash is distinct from p_payload->>'nonceHash' or r.disclosure_version is distinct from p_payload->>'disclosureVersion'
   or p_payload->>'source' is distinct from 'twilio_gather_speech' then return null;end if;
  r.consent_at:=t;r.consent_evidence:=jsonb_build_object('method','continued_speech_after_notice','source','twilio_gather_speech','utterance',p_payload->>'utterance','confidenceReported',p_payload->'confidenceReported','resultKind','gather_action_final','accountSid',r.provider_account_sid,'callSid',r.call_sid,'disclosureVersion',r.disclosure_version,'noticeVersion',p_payload->>'noticeVersion','noticeText','Hi, I''m an AI property assistant calling about a cash offer. This call will be recorded.');
 elsif p_action='consent' then
  if r.entry_policy='direct_recorded_v1' then return null;end if;
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
 elsif p_action='authorize_recording' then
  -- Operator-authorized recording. This is NOT a caller's spoken yes; consent evidence remains null.
  if not icash_recording_private.keys(p_payload,array['nonceHash','policy']) then raise exception 'Invalid recording authority';end if;
  if r.entry_policy<>'direct_recorded_v1' or p_payload->>'policy'<>'direct_recorded_v1' or r.nonce_hash is distinct from p_payload->>'nonceHash'
   or r.state<>'consent_pending' or r.consent_at is not null or r.recording_authorized_at is not null or r.start_claimed_at is not null
   or r.consent_deadline_at<=t or r.call_sid is null or r.dial_claimed_at is null then return null;end if;
  r.recording_authorized_at:=t;
 elsif p_action='claim_start' then
  if not icash_recording_private.keys(p_payload,'{}') then raise exception 'Invalid start claim';end if;
  if r.state<>'consent_pending' or coalesce(r.consent_at,r.recording_authorized_at) is null or r.start_claimed_at is not null or r.consent_deadline_at<=t then return null;end if;
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
  if r.state not in ('starting','recording','stopping','processing','failed') or r.start_claimed_at is null or coalesce(r.consent_at,r.recording_authorized_at) is null then return null;end if;
  started:=(p_payload->>'providerStartedAt')::timestamptz;
  if not isfinite(started) or started>t+interval '1 minute' or started<coalesce(r.consent_at,r.recording_authorized_at)-interval '1 second'
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
  if r.state not in ('recording','processing','available','expired','deletion_pending','absent','failed') or r.conversation_id is not null or r.recording_sid is null or coalesce(r.consent_at,r.recording_authorized_at) is null or r.call_context is null then return null;end if;
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
  consent_at=r.consent_at,consent_evidence=r.consent_evidence,recording_authorized_at=r.recording_authorized_at,dial_claimed_at=r.dial_claimed_at,start_claimed_at=r.start_claimed_at,
  provider_started_at=r.provider_started_at,ended_at=r.ended_at,duration_seconds=r.duration_seconds,audio_expires_at=r.audio_expires_at,
  provider_recording_price_micros=r.provider_recording_price_micros,price_is_estimate=r.price_is_estimate,
  next_reconcile_at=r.next_reconcile_at,next_delete_at=r.next_delete_at,last_error=r.last_error,
  end_requested_at=r.end_requested_at,call_ended_at=r.call_ended_at,last_action=p_action,row_version=row_version+1,updated_at=t where id=r.id returning * into r;
 return to_jsonb(r);
end
$function$;
revoke all on function public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_create_direct_recorded_call(uuid,text,text,text,text,text,text,jsonb,jsonb) to service_role;
commit;
