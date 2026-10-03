begin;
-- LOCAL REVIEW CANDIDATE ONLY. Does not enable recording, stage rates, alter
-- dispatch/settlement authorities, invoke providers, or install a scheduled job.
-- Service adapter activation additionally requires a separately reviewed 977c
-- recorded rate, participant spoken consent and a provider-policy review.
create schema icash_recording_private;
revoke all on schema icash_recording_private from public,anon,authenticated,service_role;
-- Private wall clock; only fixture owner may replace it in isolated clock-boundary tests.
create function icash_recording_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$ select pg_catalog.clock_timestamp() $$;
create unique index icash_recording_operation_account_binding on public.icash_operation_spend(operation_key,account_id);
create table public.icash_call_recordings (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id),
 operation_key text not null unique,
 voice_job_id uuid not null unique references public.icash_voice_jobs(id),
 permission_id uuid references public.icash_contact_permissions(id),
 operational_contact_id uuid references public.icash_operational_contacts(id),
 check((permission_id is null)<>(operational_contact_id is null)),
 screening_id uuid not null references public.icash_screening_jobs(id),
 party text not null check(party in ('seller','buyer')),
 call_context jsonb,
 provider_account_sid text not null check(provider_account_sid ~ '^AC[0-9a-fA-F]{32}$'),
 call_sid text check(call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 recording_sid text check(recording_sid ~ '^RE[0-9a-fA-F]{32}$'),
 conversation_id text check(conversation_id ~ '^conv_[A-Za-z0-9_-]{1,160}$'),
 to_phone text not null check(to_phone ~ '^\+[1-9][0-9]{7,14}$'),
 from_phone text not null check(from_phone ~ '^\+[1-9][0-9]{7,14}$'),
 contact_key text not null check(contact_key ~ '^[a-f0-9]{64}$'),
 agent_id text not null check(agent_id ~ '^agent_[A-Za-z0-9]+$'),
 branch_id text not null check(branch_id ~ '^agtbrch_[A-Za-z0-9]{1,160}$'),
 version_id text not null check(version_id ~ '^agtvrsn_[A-Za-z0-9]{1,160}$'),
 rate_id uuid not null references public.icash_operation_rates(id),
 charge_cap_cents bigint not null check(charge_cap_cents=977),
 max_total_seconds integer not null check(max_total_seconds=600),
 state text not null default 'consent_pending' check(state in ('consent_pending','declined','starting','recording','stopping','processing','available','absent','expired','deletion_pending','deleted','failed')),
 nonce_hash text not null check(nonce_hash ~ '^[a-f0-9]{64}$'),
 stop_token_hash text not null check(stop_token_hash ~ '^[a-f0-9]{64}$'),
 disclosure_version text not null check(length(btrim(disclosure_version)) between 1 and 100),
 pricing_policy jsonb not null,
 row_version bigint not null default 1 check(row_version>0),
 consent_at timestamptz check(isfinite(consent_at)), consent_evidence jsonb,
 dial_claimed_at timestamptz check(isfinite(dial_claimed_at)),
 start_claimed_at timestamptz check(isfinite(start_claimed_at)),
 provider_started_at timestamptz check(isfinite(provider_started_at)),
 ended_at timestamptz check(isfinite(ended_at)),
 duration_seconds integer check(duration_seconds between 0 and 600),
 audio_expires_at timestamptz check(isfinite(audio_expires_at)),
 deleted_at timestamptz check(isfinite(deleted_at)),
 end_requested_at timestamptz check(isfinite(end_requested_at)),
 call_ended_at timestamptz check(isfinite(call_ended_at)),
 provider_recording_price_micros bigint check(provider_recording_price_micros between 0 and 9007199254740991),
 price_is_estimate boolean not null default true,
 created_at timestamptz not null default icash_recording_private.clock_now() check(isfinite(created_at)),
 consent_deadline_at timestamptz not null check(isfinite(consent_deadline_at)),
 updated_at timestamptz not null default icash_recording_private.clock_now() check(isfinite(updated_at)),
 next_reconcile_at timestamptz check(isfinite(next_reconcile_at)),
 reconcile_attempts integer not null default 0 check(reconcile_attempts>=0),
 reconcile_lease_token uuid, reconcile_lease_expires_at timestamptz check(isfinite(reconcile_lease_expires_at)),
 next_delete_at timestamptz check(isfinite(next_delete_at)),
 deletion_attempts integer not null default 0 check(deletion_attempts>=0),
 deletion_lease_token uuid, deletion_lease_expires_at timestamptz check(isfinite(deletion_lease_expires_at)),
 last_error text check(length(last_error) between 1 and 160),
 last_action text not null default 'create',
 foreign key(operation_key,account_id) references public.icash_operation_spend(operation_key,account_id),
 unique(provider_account_sid,call_sid), unique(provider_account_sid,recording_sid),
 check((consent_at is null)=(consent_evidence is null)),
 check(start_claimed_at is null or (consent_at is not null and call_sid is not null)),
 check(recording_sid is null or (start_claimed_at is not null and consent_at is not null and provider_started_at is not null)),
 check((provider_started_at is null)=(audio_expires_at is null)),
 check(provider_started_at is null or audio_expires_at=provider_started_at+interval '720 hours'),
 check(ended_at is null or (provider_started_at is not null and ended_at>=provider_started_at)),
 check(state not in ('recording','processing','available','expired','deletion_pending','deleted') or recording_sid is not null),
 check(state<>'available' or (duration_seconds is not null and ended_at is not null)),
 check(call_ended_at is null or end_requested_at is not null),
 check(state<>'deleted' or deleted_at is not null),
 check((provider_recording_price_micros is null)=price_is_estimate),
 check((reconcile_lease_token is null)=(reconcile_lease_expires_at is null)),
 check((deletion_lease_token is null)=(deletion_lease_expires_at is null))
);
create index icash_recording_reconcile_due on public.icash_call_recordings(next_reconcile_at,id) where next_reconcile_at is not null and state<>'deleted';
create index icash_recording_delete_due on public.icash_call_recordings(audio_expires_at,next_delete_at,id) where recording_sid is not null and state<>'deleted';
create index icash_recording_account_created on public.icash_call_recordings(account_id,created_at desc);
alter table public.icash_call_recordings enable row level security;
revoke all on public.icash_call_recordings from public,anon,authenticated,service_role;
grant select on public.icash_call_recordings to service_role;
create table icash_recording_private.events (
 id bigint generated always as identity primary key,
 recording_id uuid not null references public.icash_call_recordings(id),
 account_id uuid not null, operation_key text not null,
 row_version bigint not null, action text not null, old_state text, new_state text not null,
 occurred_at timestamptz not null default icash_recording_private.clock_now(),
 unique(recording_id,row_version)
);
alter table icash_recording_private.events enable row level security;
revoke all on icash_recording_private.events from public,anon,authenticated,service_role;
revoke all on all sequences in schema icash_recording_private from public,anon,authenticated,service_role;

create function icash_recording_private.guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Recording audit cannot be removed';end if;
 if tg_op='INSERT' then
  if new.state<>'consent_pending' or new.row_version<>1 or new.consent_at is not null or new.recording_sid is not null
   or new.start_claimed_at is not null or new.dial_claimed_at is not null then raise exception 'Initial recording state required';end if;
 else
  if row(new.id,new.account_id,new.operation_key,new.voice_job_id,new.permission_id,new.operational_contact_id,new.screening_id,new.party,new.call_context,new.provider_account_sid,new.to_phone,new.from_phone,new.contact_key,
   new.agent_id,new.branch_id,new.version_id,new.rate_id,new.charge_cap_cents,new.max_total_seconds,new.nonce_hash,new.stop_token_hash,
   new.disclosure_version,new.pricing_policy,new.created_at,new.consent_deadline_at)
   is distinct from row(old.id,old.account_id,old.operation_key,old.voice_job_id,old.permission_id,old.operational_contact_id,old.screening_id,old.party,old.call_context,old.provider_account_sid,old.to_phone,old.from_phone,old.contact_key,
   old.agent_id,old.branch_id,old.version_id,old.rate_id,old.charge_cap_cents,old.max_total_seconds,old.nonce_hash,old.stop_token_hash,
   old.disclosure_version,old.pricing_policy,old.created_at,old.consent_deadline_at) then raise exception 'Recording identity and policy are immutable';end if;
  if (old.call_sid is not null and new.call_sid is distinct from old.call_sid)
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
end $$;
create trigger icash_recording_guard before insert or update or delete on public.icash_call_recordings for each row execute function icash_recording_private.guard();
create trigger icash_recording_no_truncate before truncate on public.icash_call_recordings for each statement execute function icash_recording_private.guard();
create function icash_recording_private.audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into icash_recording_private.events(recording_id,account_id,operation_key,row_version,action,old_state,new_state)
 values(new.id,new.account_id,new.operation_key,new.row_version,new.last_action,case when tg_op='UPDATE' then old.state end,new.state);
 return new;
end $$;
create trigger icash_recording_audit after insert or update on public.icash_call_recordings for each row execute function icash_recording_private.audit();
create function icash_recording_private.audit_immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Recording audit is append only';end $$;
create trigger icash_recording_audit_immutable before update or delete on icash_recording_private.events for each row execute function icash_recording_private.audit_immutable();
create trigger icash_recording_audit_no_truncate before truncate on icash_recording_private.events for each statement execute function icash_recording_private.audit_immutable();

-- Exact allowlists prevent storing arbitrary transcripts/URLs/tokens in metadata.
create function icash_recording_private.keys(p_value jsonb,p_required text[],p_optional text[] default '{}') returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(p_value) is distinct from 'object' then false else
  p_value ?& p_required and not exists(select 1 from jsonb_object_keys(p_value) k where not k=any(p_required||p_optional)) end;
$$;
create function public.icash_create_call_recording(
 p_account uuid,p_operation text,p_provider_account_sid text,p_call_sid text,p_nonce_hash text,p_stop_token_hash text,
 p_disclosure_version text,p_pricing_policy jsonb,p_context jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
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
  or p_context->'maxTotalSeconds' is distinct from '600'::jsonb
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
  and o.permission_until>t and o.customer_price_micros is null and o.charge_cap_cents=977 and rate.charge_cents=o.charge_cap_cents and rate.voice_max_duration_seconds=600
  and j.state in ('dispatching','dispatched') and (j.provider_call_sid is null or j.provider_call_sid=p_call_sid)
  and j.conversation_id is null and p.revoked_at is null and p.permission_until>t and p.dnc_clear
  and c.enabled and c.reviewed_until>t and c.agent_id is not null and c.max_duration_seconds=600
  and exists(select 1 from public.icash_accounts a where a.id=o.account_id and not a.bot_paused)
  and o.rate_id=case p.party when 'seller' then c.seller_rate_id when 'buyer' then c.buyer_rate_id end
  and not exists(select 1 from public.icash_live_conversations lc where lc.operation_key=o.operation_key)
 for share of o,j,p,c,rate;
 if not found then return null;end if;
 insert into public.icash_call_recordings(account_id,operation_key,voice_job_id,permission_id,operational_contact_id,screening_id,party,call_context,provider_account_sid,call_sid,
  to_phone,from_phone,contact_key,agent_id,branch_id,version_id,rate_id,charge_cap_cents,max_total_seconds,
  nonce_hash,stop_token_hash,disclosure_version,pricing_policy,created_at,consent_deadline_at,updated_at,next_reconcile_at)
 values(p_account,p_operation,b.job_id,b.permission_id,b.operational_contact_id,b.screening_id,b.party,p_context->'callContext',p_provider_account_sid,p_call_sid,b.phone,p_context->>'fromPhone',b.contact_key,b.agent_id,
  p_context->>'branchId',p_context->>'versionId',b.rate_id,b.charge_cap_cents,600,p_nonce_hash,p_stop_token_hash,p_disclosure_version,p_pricing_policy,
  t,t+interval '2 minutes',t,t+interval '2 minutes') on conflict do nothing returning * into r;
 if not found then return null;end if;
 return to_jsonb(r);
end $$;

create function public.icash_transition_call_recording(p_id uuid,p_account uuid,p_operation text,p_expected_state text,p_action text,p_payload jsonb)
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
  if not icash_recording_private.keys(p_payload,array['nonceHash','source','utterance','confidence','disclosureVersion'])
   or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or jsonb_typeof(p_payload->'confidence') is distinct from 'number'
   then raise exception 'Invalid spoken consent evidence';end if;
  utterance:=lower(regexp_replace(btrim(p_payload->>'utterance'),'[.!]+$',''));
  if r.state<>'consent_pending' or r.consent_at is not null or r.call_sid is null or r.consent_deadline_at<=t
   or r.nonce_hash is distinct from p_payload->>'nonceHash' or r.disclosure_version is distinct from p_payload->>'disclosureVersion'
   or p_payload->>'source' is distinct from 'twilio_gather_speech'
   or (p_payload->>'confidence')::numeric not between 0.9 and 1
   or utterance not in ('yes','yeah','yep','sure','yes please','yes that''s okay','yes you can record','yes i agree','i agree','i consent','yes you may record') then return null;end if;
  r.consent_at:=t;r.consent_evidence:=jsonb_build_object('method','speech','source','twilio_gather_speech','utterance',btrim(p_payload->>'utterance'),
   'confidence',p_payload->'confidence','accountSid',r.provider_account_sid,'callSid',r.call_sid,'disclosureVersion',r.disclosure_version);
 elsif p_action='contact_opt_out' then
  if not icash_recording_private.keys(p_payload,array['nonceHash','utterance']) or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or length(p_payload->>'utterance') not between 1 and 120 then raise exception 'Invalid contact opt-out';end if;
  if r.state<>'consent_pending' or r.start_claimed_at is not null or r.nonce_hash is distinct from p_payload->>'nonceHash' or p_payload->>'utterance' !~* '(stop (calling|texting|contacting)|do not (call|text|contact)|don''t (call|text|contact)|remove (me|my number))' then return null;end if;
  insert into public.icash_text_suppressions(phone,reason) values(r.to_phone,'voice_recording_gate_opt_out:'||r.id::text) on conflict(phone) do nothing;
  ns:='declined';r.last_error:='contact_opt_out';r.next_reconcile_at:=t;
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

create function public.icash_claim_call_recording_work(p_kind text,p_limit integer default 10,p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;t timestamptz:=icash_recording_private.clock_now();
begin
 if p_kind is null or p_kind not in ('reconcile','delete') or p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is distinct from 120 then raise exception 'Invalid recording work claim';end if;
 if p_kind='delete' then
  with candidate as (select id from public.icash_call_recordings where recording_sid is not null and state<>'deleted'
   and audio_expires_at<=t and (next_delete_at is null or next_delete_at<=t)
   and (deletion_lease_expires_at is null or deletion_lease_expires_at<=t)
   order by audio_expires_at,id for update skip locked limit p_limit), changed as (
   update public.icash_call_recordings r set state='deletion_pending',deletion_attempts=deletion_attempts+1,
    deletion_lease_token=gen_random_uuid(),deletion_lease_expires_at=icash_recording_private.clock_now()+interval '120 seconds',
    last_action='claim_delete',row_version=row_version+1,updated_at=icash_recording_private.clock_now()
   from candidate c where r.id=c.id returning r.*)
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from changed c;
 else
  with candidate as (select id from public.icash_call_recordings where state not in ('deleted','deletion_pending')
   and next_reconcile_at<=t and (reconcile_lease_expires_at is null or reconcile_lease_expires_at<=t)
   order by next_reconcile_at,id for update skip locked limit p_limit), changed as (
   update public.icash_call_recordings r set reconcile_attempts=reconcile_attempts+1,
    reconcile_lease_token=gen_random_uuid(),reconcile_lease_expires_at=icash_recording_private.clock_now()+interval '120 seconds',
    last_action='claim_reconcile',row_version=row_version+1,updated_at=icash_recording_private.clock_now()
   from candidate c where r.id=c.id returning r.*)
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from changed c;
 end if;
 return result;
end $$;

create function public.icash_finish_call_recording_work(p_id uuid,p_account uuid,p_operation text,p_kind text,p_lease_token uuid,p_outcome text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_call_recordings;result jsonb;t timestamptz;
begin
 if p_kind is null or p_kind not in ('reconcile','delete') then raise exception 'Invalid recording work kind';end if;
 select * into r from public.icash_call_recordings where id=p_id and account_id=p_account and operation_key=p_operation for update;
 if not found or r.state='deleted' then return null;end if;
 t:=icash_recording_private.clock_now();
 if p_kind='delete' then
  if r.state<>'deletion_pending' or r.deletion_lease_token is distinct from p_lease_token or p_lease_token is null or r.deletion_lease_expires_at<=t then return null;end if;
  if p_outcome='deleted' then
   if not icash_recording_private.keys(p_payload,'{}') then raise exception 'Invalid deletion receipt';end if;
   update public.icash_call_recordings set state='deleted',deleted_at=t,deletion_lease_token=null,deletion_lease_expires_at=null,
    reconcile_lease_token=null,reconcile_lease_expires_at=null,next_reconcile_at=null,next_delete_at=null,last_error=null,
    last_action='deleted',row_version=row_version+1,updated_at=t where id=r.id returning * into r;
  elsif p_outcome='retry' then
   if not icash_recording_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') !~ '^[a-z0-9_:-]{1,160}$' then raise exception 'Invalid deletion retry';end if;
   update public.icash_call_recordings set deletion_lease_token=null,deletion_lease_expires_at=null,
    next_delete_at=t+make_interval(secs=>least(3600,60*greatest(1,least(deletion_attempts,60)))),last_error=p_payload->>'reason',
    last_action='delete_retry',row_version=row_version+1,updated_at=t where id=r.id returning * into r;
  else raise exception 'Invalid deletion outcome';end if;
 else
  if r.reconcile_lease_token is distinct from p_lease_token or p_lease_token is null or r.reconcile_lease_expires_at<=t or r.state='deletion_pending' then return null;end if;
  if p_outcome='retry' then
   if not icash_recording_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') !~ '^[a-z0-9_:-]{1,160}$' then raise exception 'Invalid reconciliation retry';end if;
   update public.icash_call_recordings set next_reconcile_at=t+interval '1 minute',last_error=p_payload->>'reason',
    reconcile_lease_token=null,reconcile_lease_expires_at=null,last_action='reconcile_retry',row_version=row_version+1,updated_at=t where id=r.id returning * into r;
  elsif p_outcome in ('started','processing','available','absent') then
   result:=public.icash_transition_call_recording(r.id,r.account_id,r.operation_key,r.state,p_outcome,p_payload);
   if result is null then return null;end if;
   update public.icash_call_recordings set reconcile_lease_token=null,reconcile_lease_expires_at=null,
    last_action='finish_reconcile',row_version=row_version+1,updated_at=icash_recording_private.clock_now() where id=r.id returning * into r;
  else raise exception 'Invalid reconciliation outcome';end if;
 end if;
 return to_jsonb(r);
end $$;

-- Separate carrier-only terminal path: no synthetic ElevenLabs receipt.
create table icash_recording_private.terminal_cost_receipts (
 recording_id uuid primary key references public.icash_call_recordings(id),
 receipt jsonb not null, components jsonb not null, evidence_ref text not null,
 charged_cents bigint not null, created_at timestamptz not null default icash_recording_private.clock_now()
);
alter table icash_recording_private.terminal_cost_receipts enable row level security;
revoke all on icash_recording_private.terminal_cost_receipts from public,anon,authenticated,service_role;
create trigger icash_recording_costs_immutable before update or delete on icash_recording_private.terminal_cost_receipts
 for each row execute function icash_recording_private.audit_immutable();
create trigger icash_recording_costs_no_truncate before truncate on icash_recording_private.terminal_cost_receipts
 for each statement execute function icash_recording_private.audit_immutable();
create function public.icash_settle_unstarted_recorded_call(p_id uuid,p_account uuid,p_operation text,p_receipt jsonb,p_components jsonb,p_evidence text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_call_recordings;o public.icash_operation_spend;prior icash_recording_private.terminal_cost_receipts;
 cat text;part jsonb;n numeric;total numeric:=0;charge bigint;gather bigint;basis text:='verified';
begin
 -- Same budget -> operation lock order as the existing ledger.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation and account_id=p_account for update;
 if not found or o.state not in ('dispatched','settled') or o.customer_price_micros is not null then return null;end if;
 select * into r from public.icash_call_recordings where id=p_id and account_id=p_account and operation_key=p_operation for update;
 if not found or r.state not in ('declined','failed','absent') or r.call_sid is null or r.start_claimed_at is not null or r.recording_sid is not null or r.conversation_id is not null
  or exists(select 1 from public.icash_live_conversations c where c.operation_key=p_operation)
  or exists(select 1 from public.icash_voice_jobs j where j.id=r.voice_job_id and j.conversation_id is not null) then return null;end if;
 if not icash_recording_private.keys(p_receipt,array['providerAccountSid','callSid','fromPhone','toPhone','status','durationSeconds','priceMicros','currency','speechGatherUsed'])
  or row(p_receipt->>'providerAccountSid',p_receipt->>'callSid',p_receipt->>'fromPhone',p_receipt->>'toPhone') is distinct from row(r.provider_account_sid,r.call_sid,r.from_phone,r.to_phone)
  or coalesce(p_receipt->>'status','') not in ('completed','busy','failed','no-answer','canceled') or p_receipt->>'currency' is distinct from 'USD'
  or jsonb_typeof(p_receipt->'speechGatherUsed') is distinct from 'boolean'
  or jsonb_typeof(p_receipt->'durationSeconds') is distinct from 'number' or (p_receipt->>'durationSeconds')::numeric<>trunc((p_receipt->>'durationSeconds')::numeric)
  or (p_receipt->>'durationSeconds')::numeric not between 0 and 600
  or jsonb_typeof(p_receipt->'priceMicros') is distinct from 'number' or (p_receipt->>'priceMicros')::numeric<>trunc((p_receipt->>'priceMicros')::numeric)
  or (p_receipt->>'priceMicros')::numeric not between 0 and 9007199254740991
  or (r.state='declined' and p_receipt->'speechGatherUsed' is distinct from 'true'::jsonb)
  or p_evidence is null or length(btrim(p_evidence)) not between 10 and 300 then raise exception 'Bound terminal carrier receipt required';end if;
 gather:=case when (p_receipt->>'speechGatherUsed')::boolean then 20000 else 0 end;
 if not icash_recording_private.keys(p_components,array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) then raise exception 'Complete carrier-only costs required';end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  part:=p_components->cat;
  if not icash_recording_private.keys(part,array['amountMicros','basis','evidenceRef'],case when cat='other' then array['subitems'] else '{}'::text[] end)
   or jsonb_typeof(part->'amountMicros') is distinct from 'number' or jsonb_typeof(part->'evidenceRef') is distinct from 'string'
   or length(btrim(part->>'evidenceRef')) not between 10 and 300 then raise exception 'Complete carrier-only component required';end if;
  n:=(part->>'amountMicros')::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid carrier-only amount';end if;
  if cat in ('elevenlabs','llm') then
   if n<>0 or part->>'basis' is distinct from 'not_applicable' then raise exception 'Unstarted AI is explicitly not applicable';end if;
  elsif coalesce(part->>'basis','') not in ('verified','estimated') then raise exception 'Explicit carrier-only cost basis required';end if;
  if part->>'basis'='estimated' then basis:='estimated';end if;
  total:=total+n;
 end loop;
 if total>9007199254740991 or p_components->'twilio'->>'basis' is distinct from 'verified'
  or (p_components->'twilio'->>'amountMicros')::numeric<>(p_receipt->>'priceMicros')::numeric
  or (p_components->'other'->>'amountMicros')::numeric<>gather
  or p_components->'other'->'subitems' is distinct from jsonb_build_object('speechGatherMicros',gather,'recordingMicros',0,'storageMicros',0)
  or (gather>0 and p_components->'other'->>'basis' is distinct from 'estimated') then raise exception 'Carrier or speech cost mismatch';end if;
 charge:=ceil(total*o.standard_cost_multiplier/10000);
 if charge>o.charge_cap_cents or o.rate_id<>r.rate_id or o.charge_cap_cents<>r.charge_cap_cents then return null;end if;
 insert into icash_recording_private.terminal_cost_receipts(recording_id,receipt,components,evidence_ref,charged_cents)
 values(r.id,p_receipt,p_components,p_evidence,charge) on conflict do nothing;
 select * into strict prior from icash_recording_private.terminal_cost_receipts where recording_id=r.id;
 if row(prior.receipt,prior.components,prior.evidence_ref,prior.charged_cents) is distinct from row(p_receipt,p_components,p_evidence,charge) then raise exception 'Terminal cost receipt conflict';end if;
 perform public.icash_settle_complete_costs(o.operation_key,charge,p_components,p_evidence);
 update public.icash_operation_spend set cost_basis=basis where operation_key=o.operation_key;
 update public.icash_voice_jobs set state='held',outcome='ended_before_recording',updated_at=icash_recording_private.clock_now() where id=r.voice_job_id and account_id=r.account_id and state in ('dispatching','dispatched');
 update public.icash_call_recordings set next_reconcile_at=null,reconcile_lease_token=null,reconcile_lease_expires_at=null,last_action='gate_settled',row_version=row_version+1,updated_at=icash_recording_private.clock_now() where id=r.id;
 return jsonb_build_object('settled',true,'operationKey',o.operation_key,'chargedCents',charge,'costBasis',basis);
end $$;
revoke all on function public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text) from public,anon,authenticated,service_role;
grant execute on function public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text) to service_role;

revoke all on all functions in schema icash_recording_private from public,anon,authenticated,service_role;
revoke all on function public.icash_create_call_recording(uuid,text,text,text,text,text,text,jsonb,jsonb),
 public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb),public.icash_claim_call_recording_work(text,integer,integer),
 public.icash_finish_call_recording_work(uuid,uuid,text,text,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_create_call_recording(uuid,text,text,text,text,text,text,jsonb,jsonb),
 public.icash_transition_call_recording(uuid,uuid,text,text,text,jsonb),public.icash_claim_call_recording_work(text,integer,integer),
 public.icash_finish_call_recording_work(uuid,uuid,text,text,uuid,text,jsonb) to service_role;
commit;
