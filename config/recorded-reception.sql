begin;
-- LOCAL, CAPTURE-OFF CANDIDATE. Installs no configuration, rate, review, provider
-- change or scheduled job. Uses existing public reserve/claim/complete-cost RPCs
-- unchanged. No private provisioning function is inspected, patched or bypassed.
-- Install only after the existing general-reception and customer cost ledger.
create schema icash_recorded_reception_private;
revoke all on schema icash_recorded_reception_private from public,anon,authenticated,service_role;
create function icash_recorded_reception_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$ select pg_catalog.clock_timestamp() $$;
create function icash_recorded_reception_private.keys(v jsonb,required text[],optional text[] default '{}') returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(v) is distinct from 'object' then false else v ?& required and not exists(select 1 from jsonb_object_keys(v) k where not k=any(required||optional)) end;
$$;
create function icash_recorded_reception_private.micros(v jsonb) returns boolean language sql immutable set search_path='' as $$
 select case when jsonb_typeof(v) is distinct from 'number' then false else (v#>>'{}')::numeric between 0 and 9007199254740991 and (v#>>'{}')::numeric=trunc((v#>>'{}')::numeric) end;
$$;
create function icash_recorded_reception_private.rate_binding(r public.icash_operation_rates) returns jsonb language sql immutable set search_path='' as $$
 select to_jsonb(r)-'enabled';
$$;
-- Standing authority is separately owner-reviewed and rate/account-bound.
-- No policy rows or enabled rates are installed by this candidate.
create table icash_recorded_reception_private.cost_policies (
 id uuid primary key default gen_random_uuid(),version text not null unique check(length(btrim(version)) between 1 and 200),
 account_id uuid not null references public.icash_accounts(id),rate_id uuid not null references public.icash_operation_rates(id),rate_snapshot jsonb not null,
 enabled boolean not null default false,approved_at timestamptz not null check(isfinite(approved_at)),reviewed_until timestamptz not null check(isfinite(reviewed_until)),
 approval_reference text not null check(length(btrim(approval_reference)) between 10 and 2000),
 standard_cost_multiplier numeric not null check(standard_cost_multiplier>=1 and standard_cost_multiplier::text not in ('NaN','Infinity','-Infinity')),
 elevenlabs_cost_multiplier numeric not null check(elevenlabs_cost_multiplier>=1 and elevenlabs_cost_multiplier::text not in ('NaN','Infinity','-Infinity')),
 components jsonb not null,created_at timestamptz not null default icash_recorded_reception_private.clock_now(),
 check(reviewed_until>approved_at)
);
create function icash_recorded_reception_private.guard_cost_policy() returns trigger language plpgsql set search_path='' as $$
declare r public.icash_operation_rates;cat text;part jsonb;total numeric;required numeric;pricing jsonb;
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Standing cost policy cannot be removed';end if;
 if tg_op='UPDATE' and to_jsonb(new)-'enabled' is distinct from to_jsonb(old)-'enabled' then raise exception 'Standing cost policy is immutable';end if;
 select * into r from public.icash_operation_rates where id=new.rate_id for share;
 if not found or r.operation<>'incoming_call' or r.version not like 'recorded-reception-30d-speech-v1:%' or r.voice_max_duration_seconds not in (60,600)
  or icash_recorded_reception_private.rate_binding(r) is distinct from new.rate_snapshot or not isfinite(r.verified_at) or not isfinite(r.expires_at)
  or r.verified_at>new.approved_at or r.expires_at<new.reviewed_until then raise exception 'Standing policy requires exact reviewed rate';end if;
 if not icash_recorded_reception_private.keys(new.components,array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) then raise exception 'Standing policy requires all16 explicit rules';end if;
 pricing:=jsonb_build_object('version','recorded-reception-30d-speech-v1','retentionDays',30,'recordingMicrosPerMinute',2500,'storageMicrosPerMinuteMonth',500,'streamMicrosPerMinute',4400,'speechGatherMicros',20000,'estimate',true);
 for cat,part in select key,value from jsonb_each(new.components) loop
  if jsonb_typeof(part->'evidenceRef') is distinct from 'string' or length(btrim(part->>'evidenceRef')) not between 10 and 2000 then raise exception 'Standing policy evidence missing: %',cat;end if;
  if cat in ('twilio','elevenlabs') then
   if not icash_recorded_reception_private.keys(part,array['source','evidenceRef']) or part->>'source' is distinct from 'provider_receipt' then raise exception 'Actual provider receipts required';end if;
  elsif cat='llm' then
   if not icash_recorded_reception_private.keys(part,array['source','evidenceRef']) or part->>'source' is distinct from 'inclusive_zero' or r.costs_micros->'llm' is distinct from '0'::jsonb then raise exception 'Inclusive provider model rule required';end if;
  elsif cat='other' then
   if not icash_recorded_reception_private.keys(part,array['source','policyVersion','pricingPolicy','evidenceRef']) or part->>'source' is distinct from 'recorded_reception_addons'
    or part->>'policyVersion' is distinct from 'recorded-reception-30d-speech-v1' or part->'pricingPolicy' is distinct from pricing
    or not icash_recorded_reception_private.micros(r.costs_micros->'other') or (r.costs_micros->>'other')::numeric<20000+(r.voice_max_duration_seconds/60)*7500 then raise exception 'Approved complete add-on envelope required';end if;
  else
   if not icash_recorded_reception_private.keys(part,array['source','amountMicros','evidenceRef']) or part->>'source' is distinct from 'fixed_estimate'
    or not icash_recorded_reception_private.micros(part->'amountMicros') or part->'amountMicros' is distinct from r.costs_micros->cat then raise exception 'Explicit rate-matched fixed estimate required: %',cat;end if;
  end if;
 end loop;
 if exists(select 1 from jsonb_each(r.costs_micros) where not icash_recorded_reception_private.micros(value)) then raise exception 'Finite reviewed rate required';end if;
 select sum(value::text::numeric) into total from jsonb_each(r.costs_micros);
 required:=ceil((total*new.standard_cost_multiplier-(r.costs_micros->>'elevenlabs')::numeric*(new.standard_cost_multiplier-new.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/10000);
 if required>r.charge_cents::numeric*10000 then raise exception 'Standing cost policy exceeds quote envelope';end if;
 return new;
end $$;
create trigger recorded_reception_cost_policy_guard before insert or update or delete on icash_recorded_reception_private.cost_policies for each row execute function icash_recorded_reception_private.guard_cost_policy();
create trigger recorded_reception_cost_policy_no_truncate before truncate on icash_recorded_reception_private.cost_policies for each statement execute function icash_recorded_reception_private.guard_cost_policy();
create table icash_recorded_reception_private.configs (
 id uuid primary key default gen_random_uuid(),cost_policy_id uuid references icash_recorded_reception_private.cost_policies(id),cost_policy_snapshot jsonb,check((cost_policy_id is null)=(cost_policy_snapshot is null)), version integer not null check(version>0),
 account_id uuid not null references public.icash_accounts(id), owner_user_id uuid not null,
 called_number text not null check(called_number ~ '^\+[1-9][0-9]{7,14}$'),
 provider_account_sid text not null check(provider_account_sid ~ '^AC[0-9a-fA-F]{32}$'),
 enabled boolean not null default false,
 config_hash text not null check(config_hash ~ '^[a-f0-9]{64}$'),
 agent_id text not null check(agent_id ~ '^agent_[A-Za-z0-9]{1,160}$'),
 branch_id text not null check(branch_id ~ '^agtbrch_[A-Za-z0-9]{1,160}$'),
 version_id text not null check(version_id ~ '^agtvrsn_[A-Za-z0-9]{1,160}$'),
 call_profile text not null check(call_profile in ('normal','owner_quick_test')),
 max_total_seconds integer not null check(max_total_seconds in (60,600)),
 charge_cap_cents bigint not null check(charge_cap_cents between 1 and 1000000),
 rate_id uuid not null references public.icash_operation_rates(id), rate_snapshot jsonb not null,
 pricing_policy jsonb not null,
 stop_tool_id text not null check(stop_tool_id ~ '^tool_[A-Za-z0-9]+$'),
 policy_version text not null default 'recorded-reception-30d-speech-v1' check(policy_version='recorded-reception-30d-speech-v1'),
 funding_mode text not null default 'customer_credits' check(funding_mode='customer_credits'),receipt_mode text not null default 'provider_readback' check(receipt_mode='provider_readback'),
 context_policy text not null default 'message_only' check(context_policy in ('message_only','property_intake_v1')),
 context_policy_hash text,context_approval_reference text,
 check(context_policy='message_only' or (context_policy_hash is not null and context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60' and length(btrim(context_approval_reference)) between 10 and 500)),
 disclosure_version text not null check(disclosure_version='required-audio-30d-speech-2026-10-03'),
 approved_at timestamptz not null check(isfinite(approved_at)), reviewed_until timestamptz not null check(isfinite(reviewed_until)),
 approval_reference text not null check(length(btrim(approval_reference)) between 10 and 2000),
 owner_caller_hash text check(owner_caller_hash ~ '^[a-f0-9]{64}$'),
 owner_quick_test_approval_reference text check(length(btrim(owner_quick_test_approval_reference)) between 10 and 2000),
 caller_window_seconds integer not null default 3600 check(caller_window_seconds between 60 and 86400),
 caller_max_calls integer not null default 2 check(caller_max_calls between 1 and 5),
 max_concurrent_calls integer not null default 1 check(max_concurrent_calls=1),
 created_at timestamptz not null default icash_recorded_reception_private.clock_now() check(isfinite(created_at)),
 unique(account_id,called_number,version),
 check(reviewed_until>=approved_at+make_interval(secs=>max_total_seconds+60)),
 check((call_profile='normal' and max_total_seconds=600 and owner_caller_hash is null and owner_quick_test_approval_reference is null)
  or (call_profile='owner_quick_test' and max_total_seconds=60 and owner_caller_hash is not null and owner_quick_test_approval_reference is not null)),
 check(pricing_policy=jsonb_build_object('version','recorded-reception-30d-speech-v1','retentionDays',30,'recordingMicrosPerMinute',2500,
  'storageMicrosPerMinuteMonth',500,'streamMicrosPerMinute',4400,'speechGatherMicros',20000,'estimate',true))
);
create unique index recorded_reception_one_enabled on icash_recorded_reception_private.configs(called_number) where enabled;
create table icash_recorded_reception_private.sessions (
 id uuid primary key default gen_random_uuid(),cost_policy_id uuid references icash_recorded_reception_private.cost_policies(id),cost_policy_snapshot jsonb,check((cost_policy_id is null)=(cost_policy_snapshot is null)), configuration jsonb not null, config_id uuid not null references icash_recorded_reception_private.configs(id),
 account_id uuid not null references public.icash_accounts(id),operation_key text not null unique references public.icash_operation_spend(operation_key),
 provider_account_sid text not null check(provider_account_sid ~ '^AC[0-9a-fA-F]{32}$'),
 call_sid text not null check(call_sid ~ '^CA[0-9a-fA-F]{32}$'),
 recording_sid text check(recording_sid ~ '^RE[0-9a-fA-F]{32}$'),conversation_id text unique check(conversation_id ~ '^conv_[A-Za-z0-9_-]{1,160}$'),
 direction text not null check(direction='inbound'),from_phone text not null check(from_phone ~ '^\+[1-9][0-9]{7,14}$' or from_phone in ('anonymous','restricted','unknown')),to_phone text not null check(to_phone ~ '^\+[1-9][0-9]{7,14}$'),
 caller_hash text not null check(caller_hash ~ '^[a-f0-9]{64}$'), contact_key text not null check(contact_key ~ '^[a-f0-9]{64}$'),
 config_hash text not null,agent_id text not null,branch_id text not null,version_id text not null,call_profile text not null,
 rate_id uuid not null references public.icash_operation_rates(id),rate_snapshot jsonb not null,
 reserved_micros bigint not null check(reserved_micros>=0),charge_cap_cents bigint not null check(charge_cap_cents>0),max_total_seconds integer not null check(max_total_seconds in (60,600)),
 standard_cost_multiplier numeric not null check(standard_cost_multiplier>=1 and standard_cost_multiplier::text not in ('NaN','Infinity','-Infinity')),
 elevenlabs_cost_multiplier numeric not null check(elevenlabs_cost_multiplier>=1 and elevenlabs_cost_multiplier::text not in ('NaN','Infinity','-Infinity')),
 nonce_hash text not null unique check(nonce_hash ~ '^[a-f0-9]{64}$'),stop_token_hash text not null unique check(stop_token_hash ~ '^[a-f0-9]{64}$'),
 disclosure_version text not null,pricing_policy jsonb not null,
 state text not null default 'reserved' check(state in ('reserved','setup_pending','consent_pending','declined','starting','recording','stopping','processing','available','absent','expired','deletion_pending','deleted','failed')),
 row_version bigint not null default 1 check(row_version>0),
 setup_claimed_at timestamptz, setup_confirmed_at timestamptz,consent_at timestamptz,consent_evidence jsonb,
 start_claimed_at timestamptz,register_claimed_at timestamptz,provider_started_at timestamptz,
 ended_at timestamptz,duration_seconds integer check(duration_seconds>=0 and duration_seconds<=max_total_seconds),
 audio_expires_at timestamptz,deleted_at timestamptz,end_requested_at timestamptz,call_ended_at timestamptz,call_terminal_status text,
 provider_recording_price_micros bigint check(provider_recording_price_micros between 0 and 9007199254740991),price_is_estimate boolean not null default true,
 created_at timestamptz not null default icash_recorded_reception_private.clock_now(),updated_at timestamptz not null default icash_recorded_reception_private.clock_now(),
 call_started_at timestamptz,call_deadline_at timestamptz not null,consent_deadline_at timestamptz not null,
 next_reconcile_at timestamptz,reconcile_attempts integer not null default 0,reconcile_lease_token uuid,reconcile_lease_expires_at timestamptz,
 next_delete_at timestamptz,deletion_attempts integer not null default 0,deletion_lease_token uuid,deletion_lease_expires_at timestamptz,
 billing_state text not null default 'reserved' check(billing_state in ('reserved','settled')),settled_at timestamptz,
 last_error text check(length(last_error) between 1 and 160),last_action text not null default 'reserve',
 check(operation_key='recorded-reception:'||call_sid),check(contact_key=encode(sha256(convert_to(from_phone,'UTF8')),'hex')),
 -- Ringing/setup has a separate 60-second watchdog. Once a canonical Call
 -- start_time is read, the approved 60/600 seconds run from that immutable
 -- provider clock. The admission review already covers max_total_seconds+60.
 check(call_started_at is null or (isfinite(call_started_at) and call_started_at>=created_at-interval '1 second' and call_started_at<=created_at+interval '60 seconds' and setup_confirmed_at is not null)),
 check(call_deadline_at=case when call_started_at is null then created_at+interval '60 seconds' else call_started_at+make_interval(secs=>max_total_seconds) end),
 check(consent_deadline_at=case when call_started_at is null then created_at+interval '60 seconds' else call_started_at+interval '45 seconds' end),
 check(consent_deadline_at<=call_deadline_at),check((consent_at is null)=(consent_evidence is null)),
 check(setup_confirmed_at is null or setup_claimed_at is not null),check(consent_at is null or setup_confirmed_at is not null),
 check(start_claimed_at is null or consent_at is not null),
 check(register_claimed_at is null or (recording_sid is not null and consent_at is not null)),
 check(conversation_id is null or register_claimed_at is not null),
 check(recording_sid is null or (start_claimed_at is not null and consent_at is not null and provider_started_at is not null)),
 check((provider_started_at is null)=(audio_expires_at is null)),check(audio_expires_at=provider_started_at+interval '720 hours'),
 check(ended_at is null or ended_at>=provider_started_at),
 check(state not in ('recording','processing','available','expired','deletion_pending','deleted') or recording_sid is not null),
 check(state<>'available' or (duration_seconds is not null and ended_at is not null)),
 check(state<>'deleted' or deleted_at is not null),check((provider_recording_price_micros is null)=price_is_estimate),
 check((reconcile_lease_token is null)=(reconcile_lease_expires_at is null)),check((deletion_lease_token is null)=(deletion_lease_expires_at is null)),
 check((call_ended_at is null)=(call_terminal_status is null)),
 check(call_terminal_status in ('completed','failed','busy','no-answer','canceled')),
 check((billing_state='settled')=(settled_at is not null))
);
create unique index recorded_reception_call_canonical on icash_recorded_reception_private.sessions(lower(call_sid));
create unique index recorded_reception_recording_canonical on icash_recorded_reception_private.sessions(lower(provider_account_sid),lower(recording_sid)) where recording_sid is not null;
create index recorded_reception_active on icash_recorded_reception_private.sessions(created_at) where call_ended_at is null;
create index recorded_reception_caller on icash_recorded_reception_private.sessions(caller_hash,created_at desc);
create index recorded_reception_reconcile on icash_recorded_reception_private.sessions(next_reconcile_at,id) where next_reconcile_at is not null;
create index recorded_reception_delete on icash_recorded_reception_private.sessions(audio_expires_at,next_delete_at,id) where recording_sid is not null and state<>'deleted';
create table icash_recorded_reception_private.events (
 id bigint generated always as identity primary key,session_id uuid not null references icash_recorded_reception_private.sessions(id),
 account_id uuid not null,operation_key text not null,row_version bigint not null,action text not null,old_state text,new_state text not null,
 occurred_at timestamptz not null default icash_recorded_reception_private.clock_now(),unique(session_id,row_version)
);
create function icash_recorded_reception_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Recorded reception audit is append only';end $$;
create trigger recorded_reception_events_immutable before update or delete on icash_recorded_reception_private.events for each row execute function icash_recorded_reception_private.immutable();
create trigger recorded_reception_events_no_truncate before truncate on icash_recorded_reception_private.events for each statement execute function icash_recorded_reception_private.immutable();

-- The ORIGINAL consumed-config guard remains installed and unchanged. Both
-- lanes serialize on its historical singleton; no receipt or approval is reset.
create function icash_recorded_reception_private.guard_config() returns trigger language plpgsql set search_path='' as $$
declare r public.icash_operation_rates;p icash_recorded_reception_private.cost_policies;
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Versioned reception configuration cannot be removed';end if;
 if tg_op='UPDATE' and (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then raise exception 'Versioned reception approval is immutable';end if;
 perform 1 from icash_reception_private.config where id=1 for update;
 if not found then raise exception 'Historical reception coordination row required';end if;
 if new.enabled then
  if exists(select 1 from icash_reception_private.config where enabled)
   or exists(select 1 from icash_reception_private.receipts legacy left join public.icash_operation_spend old_op on old_op.operation_key=to_jsonb(legacy)->>'operation_key' where legacy.state='reserved' or old_op.state in ('reserved','dispatched')) then raise exception 'Historical reception must be disabled and drained';end if;
  if exists(select 1 from icash_recorded_reception_private.sessions where config_id<>new.id and call_ended_at is null) then raise exception 'Previous recorded reception must be drained';end if;
 end if;
 if new.cost_policy_id is not null then
  select * into p from icash_recorded_reception_private.cost_policies where id=new.cost_policy_id for share;
  if not found or p.account_id<>new.account_id or p.rate_id<>new.rate_id or to_jsonb(p)-'enabled' is distinct from new.cost_policy_snapshot
   or p.rate_snapshot is distinct from new.rate_snapshot or p.approved_at>new.approved_at or p.reviewed_until<new.reviewed_until
   or p.components->'other'->'pricingPolicy' is distinct from new.pricing_policy or (new.enabled and not p.enabled) then raise exception 'Exact standing policy approval required';end if;
 end if;
 if tg_op='INSERT' or new.enabled then
  select * into r from public.icash_operation_rates where id=new.rate_id for share;
  if not found or r.version not like 'recorded-reception-30d-speech-v1:%'
   or not icash_recorded_reception_private.micros(r.costs_micros->'other')
   or (r.costs_micros->>'other')::numeric < 20000+ceil(new.max_total_seconds::numeric/60)*4400+(new.max_total_seconds/60)*3100
   or r.operation<>'incoming_call' or r.voice_max_duration_seconds is distinct from new.max_total_seconds
   or r.charge_cents<>new.charge_cap_cents or icash_recorded_reception_private.rate_binding(r) is distinct from new.rate_snapshot
   or not isfinite(r.verified_at) or not isfinite(r.expires_at) or r.verified_at>new.approved_at
   or r.expires_at<new.reviewed_until then raise exception 'Exact reviewed incoming rate snapshot required';end if;
 end if;
 return new;
end $$;
create trigger recorded_reception_config_guard before insert or update or delete on icash_recorded_reception_private.configs for each row execute function icash_recorded_reception_private.guard_config();
create trigger recorded_reception_config_no_truncate before truncate on icash_recorded_reception_private.configs for each statement execute function icash_recorded_reception_private.guard_config();
create function icash_recorded_reception_private.guard_legacy_enable() returns trigger language plpgsql set search_path='' as $$
begin
 if new.enabled and (exists(select 1 from icash_recorded_reception_private.configs where enabled)
  or exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null)) then raise exception 'Recorded reception must be disabled and drained before legacy enablement';end if;
 return new;
end $$;
create trigger recorded_reception_blocks_legacy before insert or update on icash_reception_private.config for each row execute function icash_recorded_reception_private.guard_legacy_enable();
create function icash_recorded_reception_private.guard_session() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op in ('DELETE','TRUNCATE') then raise exception 'Recorded reception sessions cannot be removed';end if;
 if tg_op='INSERT' then
  if new.state<>'reserved' or new.row_version<>1 or new.setup_claimed_at is not null or new.call_started_at is not null or new.consent_at is not null or new.recording_sid is not null or new.conversation_id is not null then raise exception 'Initial reserved session required';end if;
 else
  if (to_jsonb(new)-array['state','row_version','call_started_at','call_deadline_at','consent_deadline_at','setup_claimed_at','setup_confirmed_at','consent_at','consent_evidence','start_claimed_at','register_claimed_at','provider_started_at','recording_sid','conversation_id','ended_at','duration_seconds','audio_expires_at','deleted_at','end_requested_at','call_ended_at','call_terminal_status','provider_recording_price_micros','price_is_estimate','updated_at','next_reconcile_at','reconcile_attempts','reconcile_lease_token','reconcile_lease_expires_at','next_delete_at','deletion_attempts','deletion_lease_token','deletion_lease_expires_at','billing_state','settled_at','last_error','last_action']) is distinct from
   (to_jsonb(old)-array['state','row_version','call_started_at','call_deadline_at','consent_deadline_at','setup_claimed_at','setup_confirmed_at','consent_at','consent_evidence','start_claimed_at','register_claimed_at','provider_started_at','recording_sid','conversation_id','ended_at','duration_seconds','audio_expires_at','deleted_at','end_requested_at','call_ended_at','call_terminal_status','provider_recording_price_micros','price_is_estimate','updated_at','next_reconcile_at','reconcile_attempts','reconcile_lease_token','reconcile_lease_expires_at','next_delete_at','deletion_attempts','deletion_lease_token','deletion_lease_expires_at','billing_state','settled_at','last_error','last_action']) then raise exception 'Recorded reception identity and policy are immutable';end if;
  if (old.call_started_at is not null and row(new.call_started_at,new.call_deadline_at,new.consent_deadline_at) is distinct from row(old.call_started_at,old.call_deadline_at,old.consent_deadline_at))
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
end $$;
create trigger recorded_reception_session_guard before insert or update or delete on icash_recorded_reception_private.sessions for each row execute function icash_recorded_reception_private.guard_session();
create trigger recorded_reception_session_no_truncate before truncate on icash_recorded_reception_private.sessions for each statement execute function icash_recorded_reception_private.guard_session();
create function icash_recorded_reception_private.audit_session() returns trigger language plpgsql security definer set search_path='' as $$
begin
 insert into icash_recorded_reception_private.events(session_id,account_id,operation_key,row_version,action,old_state,new_state)
 values(new.id,new.account_id,new.operation_key,new.row_version,new.last_action,case when tg_op='UPDATE' then old.state end,new.state);return new;
end $$;
create trigger recorded_reception_session_audit after insert or update on icash_recorded_reception_private.sessions for each row execute function icash_recorded_reception_private.audit_session();
create function icash_recorded_reception_private.config_json(c icash_recorded_reception_private.configs) returns jsonb language sql immutable set search_path='' as $$
 select to_jsonb(c)||jsonb_build_object('reviewed_version_id',c.version_id,'max_duration_seconds',c.max_total_seconds,'customer_charge_cap_cents',c.charge_cap_cents,'owner_quick_test_enabled',c.call_profile='owner_quick_test');
$$;
create function public.icash_get_recorded_reception_config(p_called_number text) returns jsonb language sql stable security definer set search_path='' as $$
 select icash_recorded_reception_private.config_json(c) from icash_recorded_reception_private.configs c where c.called_number=p_called_number and c.enabled;
$$;
create function public.icash_get_recorded_reception_session(p_id uuid,p_account uuid default null,p_operation text default null) returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(s)||jsonb_build_object('charged_cents',o.charged_cents,'cost_basis',o.cost_basis) from icash_recorded_reception_private.sessions s join public.icash_operation_spend o on o.operation_key=s.operation_key and o.account_id=s.account_id where s.id=p_id and (p_account is null or s.account_id=p_account) and (p_operation is null or s.operation_key=p_operation);
$$;
create function public.icash_reserve_recorded_reception(p_config_id uuid,p_call_sid text,p_provider_account_sid text,p_from_phone text,p_to_phone text,p_direction text,p_caller_hash text,p_nonce_hash text,p_stop_token_hash text,p_config_hash text,p_version_id text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare c icash_recorded_reception_private.configs;s icash_recorded_reception_private.sessions;r public.icash_operation_rates;o public.icash_operation_spend;b public.icash_operating_budget;t timestamptz;op text;planned numeric;p icash_recorded_reception_private.cost_policies;
begin
 if coalesce(p_call_sid,'') !~ '^CA[0-9a-fA-F]{32}$' or coalesce(p_provider_account_sid,'') !~ '^AC[0-9a-fA-F]{32}$'
  or (coalesce(p_from_phone,'') !~ '^\+[1-9][0-9]{7,14}$' and coalesce(p_from_phone,'') not in ('anonymous','restricted','unknown')) or coalesce(p_to_phone,'') !~ '^\+[1-9][0-9]{7,14}$' or p_direction is distinct from 'inbound'
  or coalesce(p_caller_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_nonce_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_stop_token_hash,'') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('allowed',false,'reason','invalid_input');end if;
 -- Lock this version BEFORE the shared historical lane, matching config
 -- UPDATE's row lock then guard lock. Financial locks remain unchanged.
 select * into c from icash_recorded_reception_private.configs where id=p_config_id for update;
 if not found or not c.enabled then return jsonb_build_object('allowed',false,'reason','disabled');end if;
 perform 1 from icash_reception_private.config where id=1 for update;
 if not found or exists(select 1 from icash_reception_private.config where enabled) or exists(select 1 from icash_reception_private.receipts legacy left join public.icash_operation_spend old_op on old_op.operation_key=to_jsonb(legacy)->>'operation_key' where legacy.state='reserved' or old_op.state in ('reserved','dispatched')) then return jsonb_build_object('allowed',false,'reason','legacy_lane_not_drained');end if;
 if row(c.called_number,c.provider_account_sid,c.config_hash,c.version_id) is distinct from row(p_to_phone,p_provider_account_sid,p_config_hash,p_version_id) then return jsonb_build_object('allowed',false,'reason','config_changed');end if;
 if c.call_profile='owner_quick_test' and c.owner_caller_hash is distinct from p_caller_hash then return jsonb_build_object('allowed',false,'reason','caller_not_authorized');end if;
 if exists(select 1 from icash_recorded_reception_private.sessions where lower(call_sid)=lower(p_call_sid)) or exists(select 1 from icash_reception_private.receipts where lower(call_sid)=lower(p_call_sid)) then return jsonb_build_object('allowed',false,'reason','duplicate_call');end if;
 if exists(select 1 from icash_recorded_reception_private.sessions where nonce_hash=p_nonce_hash or stop_token_hash=p_stop_token_hash) then return jsonb_build_object('allowed',false,'reason','duplicate_nonce');end if;
 if exists(select 1 from icash_recorded_reception_private.sessions where call_ended_at is null) then return jsonb_build_object('allowed',false,'reason','concurrency_limit');end if;
 select * into b from public.icash_operating_budget where id=1 for update;
 if not found or not b.enabled or b.require_company_reserve then return jsonb_build_object('allowed',false,'reason','spending_disabled');end if;
 perform 1 from public.icash_accounts where id=c.account_id and owner_user_id=c.owner_user_id and not bot_paused for update;
 if not found then return jsonb_build_object('allowed',false,'reason','account_paused_or_changed');end if;
 perform 1 from public.icash_wallets where account_id=c.account_id for update;
 if not found then return jsonb_build_object('allowed',false,'reason','wallet_missing');end if;
 select * into r from public.icash_operation_rates where id=c.rate_id for share;t:=icash_recorded_reception_private.clock_now();
 if c.cost_policy_id is not null then
  select * into p from icash_recorded_reception_private.cost_policies where id=c.cost_policy_id for share;
  t:=icash_recorded_reception_private.clock_now();
  if not found or not p.enabled or to_jsonb(p)-'enabled' is distinct from c.cost_policy_snapshot
   or p.approved_at>t or p.reviewed_until<t+make_interval(secs=>c.max_total_seconds+60)
   or p.standard_cost_multiplier is distinct from b.standard_cost_multiplier or p.elevenlabs_cost_multiplier is distinct from b.elevenlabs_cost_multiplier then return jsonb_build_object('allowed',false,'reason','cost_policy_unavailable');end if;
 end if;
 if c.approved_at>t or c.reviewed_until<t+make_interval(secs=>c.max_total_seconds+60) then return jsonb_build_object('allowed',false,'reason','outside_review');end if;
 if not r.enabled or icash_recorded_reception_private.rate_binding(r) is distinct from c.rate_snapshot or r.operation<>'incoming_call'
  or r.verified_at>t or r.expires_at<t+make_interval(secs=>c.max_total_seconds+60) then return jsonb_build_object('allowed',false,'reason','rate_unavailable');end if;
 if ((select count(*) from icash_recorded_reception_private.sessions where caller_hash=p_caller_hash and created_at>t-make_interval(secs=>c.caller_window_seconds))+(select count(*) from icash_reception_private.receipts where caller_hash=p_caller_hash and reserved_at>t-make_interval(secs=>c.caller_window_seconds)))>=c.caller_max_calls then return jsonb_build_object('allowed',false,'reason','caller_throttled');end if;
 op:='recorded-reception:'||p_call_sid;
 if exists(select 1 from public.icash_operation_spend where lower(operation_key)=lower(op)) or exists(select 1 from public.icash_credit_reservations where lower(operation_key)=lower(op)) then return jsonb_build_object('allowed',false,'reason','operation_conflict');end if;
 begin
  perform public.icash_reserve_operation(c.account_id,op,c.rate_id,least(c.reviewed_until,r.expires_at));
  select * into strict o from public.icash_operation_spend where operation_key=op for update;
  select ceil(sum(value::text::numeric)*(10000+r.buffer_bps)/10000) into planned from jsonb_each(r.costs_micros);
  if o.account_id<>c.account_id or o.rate_id<>c.rate_id or o.state<>'reserved' or o.charge_cap_cents<>c.charge_cap_cents or o.reserved_micros<>planned
   or o.customer_price_micros is not null
   or (c.cost_policy_id is not null and row(o.standard_cost_multiplier,o.elevenlabs_cost_multiplier) is distinct from row(p.standard_cost_multiplier,p.elevenlabs_cost_multiplier))
   or not exists(select 1 from public.icash_credit_reservations cr where cr.id=o.credit_reservation_id and cr.account_id=c.account_id and cr.operation_key=op and cr.status='reserved' and cr.amount_cents=c.charge_cap_cents) then raise exception 'Exact customer reserve required';end if;
  if not public.icash_claim_operation(op) then raise exception 'Recorded reception claim denied';end if;
  select * into strict o from public.icash_operation_spend where operation_key=op;
  if o.state<>'dispatched' then raise exception 'Dispatched operation required';end if;
  t:=icash_recorded_reception_private.clock_now();
  if t+make_interval(secs=>c.max_total_seconds+60)>least(c.reviewed_until,r.expires_at) then raise exception 'Review expired during admission';end if;
  insert into icash_recorded_reception_private.sessions(cost_policy_id,cost_policy_snapshot,configuration,config_id,account_id,operation_key,provider_account_sid,call_sid,direction,from_phone,to_phone,caller_hash,contact_key,config_hash,agent_id,branch_id,version_id,call_profile,rate_id,rate_snapshot,reserved_micros,charge_cap_cents,max_total_seconds,standard_cost_multiplier,elevenlabs_cost_multiplier,nonce_hash,stop_token_hash,disclosure_version,pricing_policy,created_at,updated_at,call_deadline_at,consent_deadline_at,next_reconcile_at)
  values(c.cost_policy_id,c.cost_policy_snapshot,icash_recorded_reception_private.config_json(c),c.id,c.account_id,op,p_provider_account_sid,p_call_sid,p_direction,p_from_phone,p_to_phone,p_caller_hash,encode(sha256(convert_to(p_from_phone,'UTF8')),'hex'),c.config_hash,c.agent_id,c.branch_id,c.version_id,c.call_profile,c.rate_id,c.rate_snapshot,o.reserved_micros,c.charge_cap_cents,c.max_total_seconds,o.standard_cost_multiplier,o.elevenlabs_cost_multiplier,p_nonce_hash,p_stop_token_hash,c.disclosure_version,c.pricing_policy,t,t,t+interval '60 seconds',t+interval '60 seconds',t+interval '30 seconds') returning * into s;
 exception when raise_exception or check_violation or unique_violation or no_data_found then return jsonb_build_object('allowed',false,'reason','customer_funding_denied');end;
 return jsonb_build_object('allowed',true,'reason','reserved','session',to_jsonb(s));
end $$;
create function public.icash_list_recorded_reception_sessions(p_account uuid,p_limit integer default 20) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(v)),'[]'::jsonb) from (select s.*,o.charged_cents,o.cost_basis from icash_recorded_reception_private.sessions s
  join public.icash_operation_spend o on o.operation_key=s.operation_key and o.account_id=s.account_id where s.account_id=p_account order by s.created_at desc,s.id limit greatest(0,least(coalesce(p_limit,20),20))) v;
$$;
create function public.icash_transition_recorded_reception(p_id uuid,p_account uuid,p_operation text,p_expected_version bigint,p_action text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r icash_recorded_reception_private.sessions;t timestamptz;started timestamptz;finished timestamptz;utterance text;ns text;
begin
 select * into r from icash_recorded_reception_private.sessions where id=p_id and account_id=p_account and operation_key=p_operation and row_version=p_expected_version for update;
 if not found then return null;end if;t:=icash_recorded_reception_private.clock_now();ns:=r.state;
 if r.state='deleted' and p_action not in ('call_ended','bind_conversation','request_end') then return null;end if;
 -- Fresh work honors current paused/disabled/review state. Cleanup and receipt
 -- reconciliation deliberately remain possible after these gates close.
 if p_action in ('claim_setup','bounded','consent','claim_start','claim_register') then
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
  if not icash_recorded_reception_private.keys(p_payload,array['nonceHash','source','utterance','confidence','disclosureVersion'])
   or jsonb_typeof(p_payload->'utterance') is distinct from 'string' or jsonb_typeof(p_payload->'confidence') is distinct from 'number' then raise exception 'Invalid spoken consent evidence';end if;
  utterance:=lower(btrim(regexp_replace(btrim(p_payload->>'utterance'),'[.!]+$','')));
  if length(p_payload->>'utterance') not between 1 and 120 or r.state<>'consent_pending' or r.call_started_at is null or r.consent_at is not null or r.consent_deadline_at<=t or r.nonce_hash is distinct from p_payload->>'nonceHash'
   or r.disclosure_version is distinct from p_payload->>'disclosureVersion' or p_payload->>'source' is distinct from 'twilio_gather_speech'
   or (p_payload->>'confidence')::numeric not between 0.9 and 1
   or utterance not in ('yes','yeah','yep','sure','yes please','yes that''s okay','yes you can record','yes i agree','i agree','i consent','yes you may record') then return null;end if;
  r.consent_at:=t;r.consent_evidence:=jsonb_build_object('method','speech','source','twilio_gather_speech','utterance',btrim(p_payload->>'utterance'),'confidence',p_payload->'confidence','accountSid',r.provider_account_sid,'callSid',r.call_sid,'disclosureVersion',r.disclosure_version);
 elsif p_action='decline' then
  if not icash_recorded_reception_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') not in ('declined','timeout','ambiguous') then raise exception 'Invalid decline';end if;
  if r.state<>'consent_pending' or r.start_claimed_at is not null then return null;end if;
  ns:='declined';r.last_error:=p_payload->>'reason';r.end_requested_at:=coalesce(r.end_requested_at,t);r.next_reconcile_at:=t;
 elsif p_action='claim_start' then
  if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid start claim';end if;
  if r.state<>'consent_pending' or r.consent_at is null or r.start_claimed_at is not null or r.consent_deadline_at<=t then return null;end if;
  ns:='starting';r.start_claimed_at:=t;r.next_reconcile_at:=t+interval '30 seconds';
 elsif p_action in ('started','processing','available') then
  if not icash_recorded_reception_private.keys(p_payload,case when p_action='available' then array['recordingSid','providerStartedAt','endedAt','durationSeconds'] else array['recordingSid','providerStartedAt'] end,case when p_action='available' then array['providerRecordingPriceMicros'] else '{}'::text[] end)
   or coalesce(p_payload->>'recordingSid','') !~ '^RE[0-9a-fA-F]{32}$' or jsonb_typeof(p_payload->'providerStartedAt') is distinct from 'string' then raise exception 'Invalid recording evidence';end if;
  if r.start_claimed_at is null or r.consent_at is null or r.state not in ('starting','recording','stopping','processing','available','failed','absent') then return null;end if;
  started:=(p_payload->>'providerStartedAt')::timestamptz;
  if not isfinite(started) or started<r.consent_at-interval '1 second' or started>t+interval '1 minute' or started>r.call_deadline_at
   or (r.recording_sid is not null and r.recording_sid is distinct from p_payload->>'recordingSid')
   or (r.provider_started_at is not null and r.provider_started_at is distinct from started) then return null;end if;
  r.recording_sid:=p_payload->>'recordingSid';r.provider_started_at:=started;r.audio_expires_at:=started+interval '720 hours';r.next_delete_at:=coalesce(r.next_delete_at,r.audio_expires_at);
  if p_action='available' then
   if not icash_recorded_reception_private.micros(p_payload->'durationSeconds') or (p_payload->>'durationSeconds')::numeric>r.max_total_seconds
    or jsonb_typeof(p_payload->'endedAt') is distinct from 'string'
    or (p_payload ? 'providerRecordingPriceMicros' and not icash_recorded_reception_private.micros(p_payload->'providerRecordingPriceMicros')) then raise exception 'Invalid completed recording';end if;
   finished:=(p_payload->>'endedAt')::timestamptz;
   if not isfinite(finished) or finished<>started+make_interval(secs=>(p_payload->>'durationSeconds')::integer) or finished>t+interval '1 minute' or finished>r.call_deadline_at+interval '2 seconds'
    or (r.ended_at is not null and row(r.ended_at,r.duration_seconds) is distinct from row(finished,(p_payload->>'durationSeconds')::integer))
    or (r.provider_recording_price_micros is not null and r.provider_recording_price_micros is distinct from (p_payload->>'providerRecordingPriceMicros')::bigint) then return null;end if;
   r.ended_at:=finished;r.duration_seconds:=(p_payload->>'durationSeconds')::integer;r.provider_recording_price_micros:=(p_payload->>'providerRecordingPriceMicros')::bigint;r.price_is_estimate:=r.provider_recording_price_micros is null;
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
 update icash_recorded_reception_private.sessions set state=ns,call_started_at=r.call_started_at,call_deadline_at=r.call_deadline_at,consent_deadline_at=r.consent_deadline_at,setup_claimed_at=r.setup_claimed_at,setup_confirmed_at=r.setup_confirmed_at,consent_at=r.consent_at,consent_evidence=r.consent_evidence,start_claimed_at=r.start_claimed_at,register_claimed_at=r.register_claimed_at,
  recording_sid=r.recording_sid,conversation_id=r.conversation_id,provider_started_at=r.provider_started_at,ended_at=r.ended_at,duration_seconds=r.duration_seconds,audio_expires_at=r.audio_expires_at,
  provider_recording_price_micros=r.provider_recording_price_micros,price_is_estimate=r.price_is_estimate,end_requested_at=r.end_requested_at,call_ended_at=r.call_ended_at,call_terminal_status=r.call_terminal_status,
  next_reconcile_at=r.next_reconcile_at,next_delete_at=r.next_delete_at,last_error=r.last_error,last_action=p_action,row_version=row_version+1,updated_at=t where id=r.id returning * into r;
 return to_jsonb(r);
end $$;
create function public.icash_claim_recorded_reception_work(p_kind text,p_limit integer default 10,p_lease_seconds integer default 120)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;t timestamptz:=icash_recorded_reception_private.clock_now();
begin
 if coalesce(p_kind,'') not in ('reconcile','delete') or p_limit is null or p_limit not between 1 and 100 or p_lease_seconds is distinct from 120 then raise exception 'Invalid work claim';end if;
 if p_kind='delete' then
  with candidate as (select id from icash_recorded_reception_private.sessions where recording_sid is not null and state<>'deleted' and audio_expires_at<=t and (next_delete_at is null or next_delete_at<=t) and (deletion_lease_expires_at is null or deletion_lease_expires_at<=t) order by audio_expires_at,id for update skip locked limit p_limit),changed as (
   update icash_recorded_reception_private.sessions s set state='deletion_pending',deletion_attempts=deletion_attempts+1,deletion_lease_token=gen_random_uuid(),deletion_lease_expires_at=icash_recorded_reception_private.clock_now()+interval '120 seconds',last_action='claim_delete',row_version=row_version+1,updated_at=icash_recorded_reception_private.clock_now() from candidate c where s.id=c.id returning s.*)
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from changed c;
 else
  with candidate as (select id from icash_recorded_reception_private.sessions where next_reconcile_at<=t and (reconcile_lease_expires_at is null or reconcile_lease_expires_at<=t) order by next_reconcile_at,id for update skip locked limit p_limit),changed as (
   update icash_recorded_reception_private.sessions s set reconcile_attempts=reconcile_attempts+1,reconcile_lease_token=gen_random_uuid(),reconcile_lease_expires_at=icash_recorded_reception_private.clock_now()+interval '120 seconds',last_action='claim_reconcile',row_version=row_version+1,updated_at=icash_recorded_reception_private.clock_now() from candidate c where s.id=c.id returning s.*)
  select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) into result from changed c;
 end if;
 return result;
end $$;
create function public.icash_finish_recorded_reception_work(p_id uuid,p_account uuid,p_operation text,p_kind text,p_lease_token uuid,p_expected_version bigint,p_outcome text,p_payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r icash_recorded_reception_private.sessions;result jsonb;t timestamptz;
begin
 select * into r from icash_recorded_reception_private.sessions where id=p_id and account_id=p_account and operation_key=p_operation and row_version=p_expected_version for update;
 if not found then return null;end if;t:=icash_recorded_reception_private.clock_now();
 if p_kind='delete' then
  if r.state<>'deletion_pending' or p_lease_token is null or r.deletion_lease_token is distinct from p_lease_token or r.deletion_lease_expires_at<=t then return null;end if;
  if p_outcome='deleted' then
   if not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid deletion receipt';end if;
   update icash_recorded_reception_private.sessions set state='deleted',deleted_at=t,deletion_lease_token=null,deletion_lease_expires_at=null,next_delete_at=null,last_action='deleted',row_version=row_version+1,updated_at=t where id=r.id returning * into r;
  elsif p_outcome='retry' then
   if not icash_recorded_reception_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') !~ '^[a-z0-9_:-]{1,160}$' then raise exception 'Invalid deletion retry';end if;
   update icash_recorded_reception_private.sessions set deletion_lease_token=null,deletion_lease_expires_at=null,next_delete_at=t+make_interval(secs=>least(3600,60*greatest(1,least(deletion_attempts,60)))),last_error=p_payload->>'reason',last_action='delete_retry',row_version=row_version+1,updated_at=t where id=r.id returning * into r;
  else raise exception 'Invalid deletion outcome';end if;
 elsif p_kind='reconcile' then
  if p_lease_token is null or r.reconcile_lease_token is distinct from p_lease_token or r.reconcile_lease_expires_at<=t then return null;end if;
  if p_outcome in ('retry','done','checked') then
   if p_outcome='checked' and not icash_recorded_reception_private.keys(p_payload,'{}') then raise exception 'Invalid check receipt';end if;
   if p_outcome='retry' and (not icash_recorded_reception_private.keys(p_payload,array['reason']) or coalesce(p_payload->>'reason','') !~ '^[a-z0-9_:-]{1,160}$') then raise exception 'Invalid reconciliation retry';end if;
   if p_outcome='done' and (not icash_recorded_reception_private.keys(p_payload,'{}') or r.call_ended_at is null or r.billing_state<>'settled' or (r.register_claimed_at is not null and r.conversation_id is null) or (r.start_claimed_at is not null and r.state not in ('available','expired','deleted','absent'))) then return null;end if;
  elsif p_outcome in ('started','processing','available','absent','call_ended','bind_conversation') then
   result:=public.icash_transition_recorded_reception(r.id,r.account_id,r.operation_key,r.row_version,p_outcome,p_payload);
   if result is null then return null;end if;
  else raise exception 'Invalid reconciliation outcome';end if;
  update icash_recorded_reception_private.sessions set reconcile_lease_token=null,reconcile_lease_expires_at=null,next_reconcile_at=case when p_outcome='done' or (p_outcome='checked' and call_ended_at is not null and billing_state='settled' and (register_claimed_at is null or conversation_id is not null) and (start_claimed_at is null or state in ('available','expired','deleted','absent'))) then null else t+interval '1 minute' end,
   last_error=case when p_outcome='retry' then p_payload->>'reason' else last_error end,last_action='reconcile_'||p_outcome,row_version=row_version+1,updated_at=t where id=r.id returning * into r;
 else raise exception 'Invalid work kind';end if;
 return to_jsonb(r);
end $$;

create function public.icash_recorded_reception_property_context(p_id uuid,p_nonce_hash text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare r icash_recorded_reception_private.sessions;matches jsonb;address text;bound_thread uuid;first_name text;
 p_contact_key text;checked_at timestamptz:=icash_recorded_reception_private.clock_now();
begin
 select s.* into r from icash_recorded_reception_private.sessions s
 join icash_recorded_reception_private.configs c on c.id=s.config_id
 join public.icash_accounts a on a.id=s.account_id and a.owner_user_id=c.owner_user_id
 join public.icash_operation_spend o on o.operation_key=s.operation_key and o.account_id=s.account_id
 where s.id=p_id and s.nonce_hash=p_nonce_hash and s.state='recording' and s.consent_at is not null and s.recording_sid is not null
  and s.register_claimed_at is null and s.conversation_id is null and s.end_requested_at is null and s.call_ended_at is null
  and s.from_phone ~ '^\+[1-9][0-9]{7,14}$' and s.call_deadline_at>checked_at
  and c.enabled and not a.bot_paused and c.approved_at<=checked_at and c.reviewed_until>checked_at
  and o.state='dispatched' and o.rate_id=s.rate_id and o.charge_cap_cents=s.charge_cap_cents
  and c.context_policy='property_intake_v1' and c.context_policy_hash='44fe91fa860afe2a83d897ffa647c2d42661fb2cdcdc0c0630da24218ee79e60'
  and length(btrim(c.context_approval_reference))>=10;
 if not found then return null;end if;
 p_contact_key:=encode(sha256(convert_to(r.from_phone,'UTF8')),'hex');
 if exists(select 1 from public.icash_contact_suppressions s where s.contact_key=p_contact_key) then return null;end if;

 -- The trusted signed-webhook handler computes SHA256(from), never from an LLM
 -- or client account selector. Reception's HMAC caller hash is a separate throttle
 -- key, not proof of identity. A match permits only a property/name confirmation.
 -- Count every matching live-deal invitation before permission filtering; revoked
 -- or expired alternatives must not make an otherwise ambiguous match look unique.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id as deal_id,t.id as thread_id,p.party,
   case when jsonb_typeof(d.terms->'address')='string' then d.terms->>'address' end as address,
   (p.revoked_at is null and p.permission_until>now() and not t.paused
    and not exists(select 1 from public.icash_property_controls ctrl where ctrl.account_id=d.account_id
     and ctrl.property_id=s.snapshot->>'propertyId' and ctrl.manual)) as permission_current
  from public.icash_contact_permissions p
  join public.icash_deal_files d on d.account_id=p.account_id and d.screening_id=p.screening_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party=p.party and t.recipient=p.phone
  where p.account_id=r.account_id and p.contact_key=p_contact_key
   and p.contact_key=encode(sha256(convert_to(p.phone,'UTF8')),'hex')
   and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
   and not exists(select 1 from public.icash_text_suppressions s where s.phone=p.phone)
   and exists(select 1 from public.icash_text_messages sent where sent.account_id=p.account_id and sent.thread_id=t.id
    and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at between now()-interval '30 days' and now())
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 if (matches->0->>'permission_current')::boolean is not true or matches->0->>'party'<>'seller' then return null;end if;
 address:=btrim(matches->0->>'address');
 if address is null or length(address) not between 1 and 300 then return null;end if;
 bound_thread:=(matches->0->>'thread_id')::uuid;
 select introduced.name into first_name from (
  select m.created_at,m.id,substring(m.body from '^(?:[Hh]i[, ]+|[Hh]ello[, ]+)?(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[.!]?(?:[[:space:]]|$))') as name
  from (select m.id,m.created_at,m.body from public.icash_text_messages m
   where m.account_id=r.account_id and m.thread_id=bound_thread and m.direction='incoming' and m.state='received'
    and m.created_at between now()-interval '30 days' and now()
    and exists(select 1 from public.icash_text_messages sent where sent.account_id=r.account_id and sent.thread_id=m.thread_id
     and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.created_at>=now()-interval '30 days' and sent.created_at<=m.created_at)
   order by m.created_at desc,m.id desc limit 12) m
 ) introduced where introduced.name is not null and lower(introduced.name) not in ('interested','owner','selling','ready','not','yes','no') order by introduced.created_at desc,introduced.id desc limit 1;
 return jsonb_strip_nulls(jsonb_build_object('status','matched','address',address,'returningName',first_name));
end $$;
-- Owner-reviewed exact all-in evidence only. Service collectors can submit a
-- matching attestation, never approve a cost manifest or invent a zero AI bill.
create table icash_recorded_reception_private.cost_reviews (
 session_id uuid primary key references icash_recorded_reception_private.sessions(id),operation_key text not null unique references public.icash_operation_spend(operation_key),
 attestation jsonb not null,components jsonb not null,evidence_ref text not null check(length(btrim(evidence_ref)) between 10 and 2000),
 reviewed_by text not null check(length(btrim(reviewed_by)) between 3 and 200),reviewed_at timestamptz not null default icash_recorded_reception_private.clock_now() check(isfinite(reviewed_at))
);
create function icash_recorded_reception_private.validate_cost_review(p_id uuid,p_attestation jsonb,p_components jsonb) returns text language plpgsql set search_path='' as $$
declare r icash_recorded_reception_private.sessions;b jsonb;part jsonb;cat text;total numeric:=0;n numeric;basis text:='verified';gate boolean;minutes numeric;rec numeric;storage numeric;speech numeric;stream numeric;
begin
 select * into r from icash_recorded_reception_private.sessions where id=p_id;
 if not found or r.call_ended_at is null then raise exception 'Terminal bound carrier required';end if;
 if r.setup_confirmed_at is not null and r.call_terminal_status='completed' and r.call_started_at is null then raise exception 'Bound answered call clock required';end if;
 b:=jsonb_build_object('sessionId',r.id,'configId',r.config_id,'accountId',r.account_id,'operationKey',r.operation_key,'providerAccountSid',r.provider_account_sid,'callSid',r.call_sid,'fromPhone',r.from_phone,'toPhone',r.to_phone,'direction','inbound','agentId',r.agent_id,'branchId',r.branch_id,'versionId',r.version_id,'rateId',r.rate_id,'chargeCapCents',r.charge_cap_cents,'maxTotalSeconds',r.max_total_seconds,'conversationId',r.conversation_id,'recordingSid',r.recording_sid);
 if not icash_recorded_reception_private.keys(p_attestation,array['schemaVersion','mode','binding','durationSeconds','providers','recording']) or p_attestation->'schemaVersion' is distinct from '1'::jsonb or p_attestation->'binding' is distinct from b
  or not icash_recorded_reception_private.micros(p_attestation->'durationSeconds') or (p_attestation->>'durationSeconds')::numeric>r.max_total_seconds then raise exception 'Exact provider binding and duration required';end if;
 gate:=p_attestation->>'mode'='gate_only';
 if p_attestation->>'mode' not in ('gate_only','recorded') or p_attestation->>'mode' is null then raise exception 'Invalid settlement mode';end if;
 if gate then
  if r.start_claimed_at is not null or r.register_claimed_at is not null or r.recording_sid is not null or r.conversation_id is not null then raise exception 'Gate-only requires no recording or AI start claim';end if;
  if not icash_recorded_reception_private.keys(p_attestation->'providers',array['twilio']) then raise exception 'Gate-only cannot fabricate AI receipt';end if;
 else
  if r.recording_sid is null or r.conversation_id is null or r.consent_at is null or r.duration_seconds is null or r.ended_at is null or r.state not in ('available','expired','deletion_pending','deleted') then raise exception 'Complete recording and conversation required';end if;
  if not icash_recorded_reception_private.keys(p_attestation->'providers',array['twilio','elevenlabs']) then raise exception 'Both real provider receipts required';end if;
 end if;
 for cat,part in select key,value from jsonb_each(p_attestation->'providers') loop
  if not icash_recorded_reception_private.keys(part,array['amountMicros','currency','receiptHash']) or part->>'currency' is distinct from 'USD'
   or not icash_recorded_reception_private.micros(part->'amountMicros') or coalesce(part->>'receiptHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Exact USD provider receipt required';end if;
 end loop;
 speech:=case when r.setup_confirmed_at is null then 0 else 20000 end;
 if gate then rec:=0;storage:=0;stream:=0;
 else minutes:=ceil(r.duration_seconds::numeric/60);rec:=coalesce(r.provider_recording_price_micros,minutes*2500);storage:=ceil(minutes*500*30/28);stream:=ceil((p_attestation->>'durationSeconds')::numeric/60)*4400;end if;
 if p_attestation->'recording' is distinct from jsonb_build_object('policyVersion','recorded-reception-30d-speech-v1','speechGatherMicros',speech,'recordingMicros',rec,'storageMicros',storage,'streamMicros',stream,'recordingEstimated',not gate and r.provider_recording_price_micros is null) then raise exception 'Immutable recording, stream, storage and Gather policy required';end if;
 if not icash_recorded_reception_private.keys(p_components,array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other']) then raise exception 'All 16 reviewed cost categories required';end if;
 for cat,part in select key,value from jsonb_each(p_components) loop
  if not icash_recorded_reception_private.keys(part,array['amountMicros','evidenceRef','basis']) or not icash_recorded_reception_private.micros(part->'amountMicros')
   or jsonb_typeof(part->'evidenceRef') is distinct from 'string' or length(btrim(part->>'evidenceRef')) not between 10 and 2000
   or coalesce(part->>'basis','') not in ('verified','estimated') then raise exception 'Reviewed amount and evidence required: %',cat;end if;
  total:=total+(part->>'amountMicros')::numeric;if part->>'basis'='estimated' then basis:='estimated';end if;
 end loop;
 if total>9007199254740991 then raise exception 'Cost total out of range';end if;
 if p_components->'twilio'->'amountMicros' is distinct from p_attestation->'providers'->'twilio'->'amountMicros' or p_components->'twilio'->>'basis' is distinct from 'verified'
  or p_components->'elevenlabs'->'amountMicros' is distinct from (case when gate then '0'::jsonb else p_attestation->'providers'->'elevenlabs'->'amountMicros' end)
  or p_components->'elevenlabs'->>'basis' is distinct from 'verified' then raise exception 'Provider receipt cost mismatch';end if;
 if p_components->'llm'->'amountMicros' is distinct from '0'::jsonb or p_components->'llm'->>'basis' is distinct from 'verified' then raise exception 'Inclusive model cost required';end if;
 if (p_components->'other'->>'amountMicros')::numeric<>speech+rec+storage+stream or (speech+rec+storage+stream>0 and p_components->'other'->>'basis' is distinct from 'estimated') then raise exception 'Complete recording add-ons must remain estimated';end if;
 return basis;
end $$;
create function icash_recorded_reception_private.guard_cost_review() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'INSERT' then raise exception 'Recorded reception cost review is immutable';end if;
 if not exists(select 1 from icash_recorded_reception_private.sessions where id=new.session_id and operation_key=new.operation_key and call_ended_at<=new.reviewed_at and new.reviewed_at<=icash_recorded_reception_private.clock_now()) then raise exception 'Cost review session/time mismatch';end if;
 perform icash_recorded_reception_private.validate_cost_review(new.session_id,new.attestation,new.components);return new;
end $$;
create trigger recorded_reception_review_guard before insert or update or delete on icash_recorded_reception_private.cost_reviews for each row execute function icash_recorded_reception_private.guard_cost_review();
create trigger recorded_reception_review_no_truncate before truncate on icash_recorded_reception_private.cost_reviews for each statement execute function icash_recorded_reception_private.guard_cost_review();
create table icash_recorded_reception_private.automatic_settlements (
 session_id uuid primary key references icash_recorded_reception_private.sessions(id),operation_key text not null unique references public.icash_operation_spend(operation_key),
 cost_policy_id uuid not null references icash_recorded_reception_private.cost_policies(id),cost_policy_version text not null,cost_policy_snapshot jsonb not null,
 attestation jsonb not null,components jsonb not null,evidence_ref text not null,charged_cents bigint not null check(charged_cents>=0),actual_micros bigint not null check(actual_micros>=0),
 cost_basis text not null check(cost_basis in ('verified','estimated')),settled_at timestamptz not null default icash_recorded_reception_private.clock_now(),
 check(cost_policy_snapshot->>'id'=cost_policy_id::text),check(cost_policy_snapshot->>'version'=cost_policy_version)
);
create trigger recorded_reception_automatic_immutable before update or delete on icash_recorded_reception_private.automatic_settlements for each row execute function icash_recorded_reception_private.immutable();
create trigger recorded_reception_automatic_no_truncate before truncate on icash_recorded_reception_private.automatic_settlements for each statement execute function icash_recorded_reception_private.immutable();
create function icash_recorded_reception_private.automatic_components(r icash_recorded_reception_private.sessions,a jsonb) returns jsonb language plpgsql set search_path='' as $$
declare result jsonb:='{}';cat text;rule jsonb;n numeric;basis text;evidence text;p jsonb:=r.cost_policy_snapshot;
begin
 -- Frozen dispatch authority is intentional: later pause/disable/review expiry
 -- cannot strand a previously admitted call's truthful debit or media deletion.
 if r.cost_policy_id is null or p->>'id' is distinct from r.cost_policy_id::text or p->>'account_id' is distinct from r.account_id::text
  or p->>'rate_id' is distinct from r.rate_id::text or p->'rate_snapshot' is distinct from r.rate_snapshot
  or (p->>'standard_cost_multiplier')::numeric is distinct from r.standard_cost_multiplier
  or (p->>'elevenlabs_cost_multiplier')::numeric is distinct from r.elevenlabs_cost_multiplier
  or p->'components'->'other'->'pricingPolicy' is distinct from r.pricing_policy then raise exception 'Frozen standing policy binding required';end if;
 for cat,rule in select key,value from jsonb_each(p->'components') loop
  evidence:=rule->>'evidenceRef';basis:='verified';
  if cat='twilio' or (cat='elevenlabs' and a->>'mode'='recorded') then
   if rule->>'source' is distinct from 'provider_receipt' or not icash_recorded_reception_private.micros(a->'providers'->cat->'amountMicros') then raise exception 'Real provider cost required';end if;
   n:=(a->'providers'->cat->>'amountMicros')::numeric;evidence:=cat||':receipt-sha256:'||coalesce(a->'providers'->cat->>'receiptHash','');
  elsif cat='elevenlabs' then
   if a->>'mode' is distinct from 'gate_only' or r.start_claimed_at is not null or r.register_claimed_at is not null then raise exception 'No fabricated AI zero';end if;
   n:=0;evidence:='not-started:'||r.id::text;
  elsif cat='llm' then
   if rule->>'source' is distinct from 'inclusive_zero' then raise exception 'Inclusive model rule required';end if;n:=0;
  elsif cat='other' then
   if rule->>'source' is distinct from 'recorded_reception_addons' then raise exception 'Add-on policy required';end if;
   n:=(a->'recording'->>'speechGatherMicros')::numeric+(a->'recording'->>'recordingMicros')::numeric+(a->'recording'->>'storageMicros')::numeric+(a->'recording'->>'streamMicros')::numeric;basis:='estimated';
  else
   if rule->>'source' is distinct from 'fixed_estimate' or not icash_recorded_reception_private.micros(rule->'amountMicros') then raise exception 'Approved fixed estimate required';end if;
   n:=(rule->>'amountMicros')::numeric;basis:='estimated';
  end if;
  result:=result||jsonb_build_object(cat,jsonb_build_object('amountMicros',n,'basis',basis,'evidenceRef',evidence));
 end loop;
 -- Same exact provider binding and independent16-category validation as the
 -- historical owner-reviewed path; an LLM cannot supply category prices here.
 perform icash_recorded_reception_private.validate_cost_review(r.id,a,result);
 return result;
end $$;
create function public.icash_settle_recorded_reception(p_id uuid,p_account uuid,p_operation text,p_attestation jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare r icash_recorded_reception_private.sessions;v icash_recorded_reception_private.cost_reviews;o public.icash_operation_spend;cr public.icash_credit_reservations;m public.icash_cost_manifests;total numeric;required numeric;charge bigint;basis text;t timestamptz;components jsonb;attestation jsonb;evidence text;prior_attestation jsonb;receipt_changed boolean;economic_changed boolean;
begin
 -- Settlement never takes a config/lane lock. Budget first matches existing
 -- settlement. Session lock follows public operation/account/wallet locks.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation and account_id=p_account for update;
 if not found or o.state not in ('dispatched','settled') then return jsonb_build_object('settled',false,'reason','operation_not_dispatched');end if;
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 select * into r from icash_recorded_reception_private.sessions where id=p_id and account_id=p_account and operation_key=p_operation for update;
 if not found or r.call_ended_at is null then return jsonb_build_object('settled',false,'reason','carrier_not_terminal');end if;
 if o.state='settled' and r.billing_state='settled' then
  if r.cost_policy_id is null then select v0.attestation into prior_attestation from icash_recorded_reception_private.cost_reviews v0 where v0.session_id=r.id;
  else select a.attestation into prior_attestation from icash_recorded_reception_private.automatic_settlements a where a.session_id=r.id and a.operation_key=r.operation_key;end if;
  if prior_attestation is null then return jsonb_build_object('settled',false,'reason','settlement_audit_missing','previouslySettled',true);end if;
  -- p_id/account/operation were verified above. Contradictory submitted
  -- receipt binding flags that owned settlement; it cannot debit another call.
  receipt_changed:=p_attestation is distinct from prior_attestation;
  economic_changed:=(p_attestation #- '{providers,twilio,receiptHash}' #- '{providers,elevenlabs,receiptHash}') is distinct from (prior_attestation #- '{providers,twilio,receiptHash}' #- '{providers,elevenlabs,receiptHash}');
  if economic_changed and r.last_error is distinct from 'settled_receipt_conflict' then
   update icash_recorded_reception_private.sessions set last_error='settled_receipt_conflict',last_action='settled_receipt_conflict',row_version=row_version+1,updated_at=icash_recorded_reception_private.clock_now() where id=r.id;
  end if;
  return jsonb_build_object('settled',true,'chargedCents',o.charged_cents,'costBasis',o.cost_basis,'receiptChanged',receipt_changed,'reviewRequired',economic_changed,'reason',case when economic_changed then 'settled_receipt_conflict' when receipt_changed then 'settled_receipt_hash_changed' else 'already_settled' end);
 end if;
 if r.cost_policy_id is not null then
  attestation:=p_attestation;
  begin components:=icash_recorded_reception_private.automatic_components(r,attestation);
  exception when raise_exception or invalid_text_representation or numeric_value_out_of_range then return jsonb_build_object('settled',false,'reason','standing_policy_receipt_mismatch');end;
  evidence:='recorded-reception-policy:'||r.cost_policy_id::text||':'||(r.cost_policy_snapshot->>'version')||':attestation-sha256:'||encode(sha256(convert_to(attestation::text,'UTF8')),'hex');
 else
  select * into v from icash_recorded_reception_private.cost_reviews where session_id=r.id and operation_key=p_operation;
  if not found then return jsonb_build_object('settled',false,'reason','cost_review_required');end if;
  if v.attestation is distinct from p_attestation then return jsonb_build_object('settled',false,'reason','cost_review_mismatch');end if;
  attestation:=v.attestation;components:=v.components;evidence:=v.evidence_ref;
 end if;
 basis:=icash_recorded_reception_private.validate_cost_review(r.id,attestation,components);
 select * into cr from public.icash_credit_reservations where id=o.credit_reservation_id for update;
 if row(o.account_id,o.rate_id,o.charge_cap_cents,o.reserved_micros,o.standard_cost_multiplier,o.elevenlabs_cost_multiplier) is distinct from row(r.account_id,r.rate_id,r.charge_cap_cents,r.reserved_micros,r.standard_cost_multiplier,r.elevenlabs_cost_multiplier)
  or o.customer_price_micros is not null or row(cr.account_id,cr.operation_key,cr.amount_cents) is distinct from row(r.account_id,r.operation_key,r.charge_cap_cents)
  or (o.state='dispatched' and cr.status<>'reserved') then return jsonb_build_object('settled',false,'reason','reservation_mismatch');end if;
 select sum((value->>'amountMicros')::numeric) into total from jsonb_each(components);
 required:=total*r.standard_cost_multiplier-(components->'elevenlabs'->>'amountMicros')::numeric*(r.standard_cost_multiplier-r.elevenlabs_cost_multiplier);
 if required>r.charge_cap_cents::numeric*10000 then return jsonb_build_object('settled',false,'reason','charge_exceeds_cap');end if;
 charge:=ceil(required/10000)::bigint;
 perform public.icash_settle_complete_costs(p_operation,charge,components,evidence);
 select * into strict o from public.icash_operation_spend where operation_key=p_operation;
 select * into strict m from public.icash_cost_manifests where operation_key=p_operation;
 select * into strict cr from public.icash_credit_reservations where id=o.credit_reservation_id;
 if o.state<>'settled' or o.charged_cents<>charge or o.actual_micros<>total or m.components is distinct from components or m.evidence_ref is distinct from evidence
  or (charge=0 and cr.status<>'released') or (charge>0 and (cr.status<>'settled' or cr.settled_cents<>charge)) then raise exception 'Settlement result mismatch';end if;
 if r.billing_state<>'settled' then
  t:=icash_recorded_reception_private.clock_now();
  if r.cost_policy_id is not null then
   insert into icash_recorded_reception_private.automatic_settlements(session_id,operation_key,cost_policy_id,cost_policy_version,cost_policy_snapshot,attestation,components,evidence_ref,charged_cents,actual_micros,cost_basis,settled_at)
   values(r.id,r.operation_key,r.cost_policy_id,r.cost_policy_snapshot->>'version',r.cost_policy_snapshot,attestation,components,evidence,charge,total::bigint,basis,t);
  end if;
  update public.icash_operation_spend set cost_basis=basis where operation_key=p_operation;
  update icash_recorded_reception_private.sessions set billing_state='settled',settled_at=t,next_reconcile_at=t,last_action='settle',row_version=row_version+1,updated_at=t where id=r.id;
 end if;
 return jsonb_build_object('settled',true,'chargedCents',charge,'costBasis',basis);
end $$;

-- Every table and sequence remains private even when installation runs under
-- broad default privileges. All public RPCs are explicitly service-only.
alter table icash_recorded_reception_private.cost_policies enable row level security;
alter table icash_recorded_reception_private.automatic_settlements enable row level security;
alter table icash_recorded_reception_private.configs enable row level security;
alter table icash_recorded_reception_private.sessions enable row level security;
alter table icash_recorded_reception_private.events enable row level security;
alter table icash_recorded_reception_private.cost_reviews enable row level security;
revoke all on all tables in schema icash_recorded_reception_private from public,anon,authenticated,service_role;
revoke all on all sequences in schema icash_recorded_reception_private from public,anon,authenticated,service_role;
revoke all on all functions in schema icash_recorded_reception_private from public,anon,authenticated,service_role;
revoke all on function public.icash_get_recorded_reception_config(text),public.icash_get_recorded_reception_session(uuid,uuid,text),public.icash_list_recorded_reception_sessions(uuid,integer),public.icash_reserve_recorded_reception(uuid,text,text,text,text,text,text,text,text,text,text),public.icash_transition_recorded_reception(uuid,uuid,text,bigint,text,jsonb),public.icash_claim_recorded_reception_work(text,integer,integer),public.icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb),public.icash_recorded_reception_property_context(uuid,text),public.icash_settle_recorded_reception(uuid,uuid,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_get_recorded_reception_config(text),public.icash_get_recorded_reception_session(uuid,uuid,text),public.icash_list_recorded_reception_sessions(uuid,integer),public.icash_reserve_recorded_reception(uuid,text,text,text,text,text,text,text,text,text,text),public.icash_transition_recorded_reception(uuid,uuid,text,bigint,text,jsonb),public.icash_claim_recorded_reception_work(text,integer,integer),public.icash_finish_recorded_reception_work(uuid,uuid,text,text,uuid,bigint,text,jsonb),public.icash_recorded_reception_property_context(uuid,text),public.icash_settle_recorded_reception(uuid,uuid,text,jsonb) to service_role;
commit;
