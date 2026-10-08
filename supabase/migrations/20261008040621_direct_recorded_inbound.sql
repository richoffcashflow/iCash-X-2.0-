-- Owner approved October 7, 2026, 10:44 PM America/Chicago: keep call audio,
-- skip the spoken introduction and recording question on all business calls.
-- No spoken response/consent is manufactured. Existing historical evidence is immutable.
begin;
alter table icash_recorded_reception_private.sessions add column entry_policy text not null default 'spoken_v1' check(entry_policy in ('spoken_v1','direct_recorded_v1')),
 add column recording_authorized_at timestamptz,
 add constraint direct_recording_authority check(recording_authorized_at is null or (entry_policy='direct_recorded_v1' and isfinite(recording_authorized_at) and consent_at is null and consent_evidence is null and recording_authorized_at>=created_at));
-- Preserve every historical check; extend only the recording authorization operand.
do $constraints$ declare c record; definition text;begin
 for c in select conname,pg_get_constraintdef(oid) d from pg_constraint where conrelid='icash_recorded_reception_private.sessions'::regclass and contype='c'
  and pg_get_constraintdef(oid) like '%consent_at IS NOT NULL%' and (pg_get_constraintdef(oid) like '%start_claimed_at%' or pg_get_constraintdef(oid) like '%recording_sid%' or pg_get_constraintdef(oid) like '%register_claimed_at%') loop
  definition:=replace(c.d,'consent_at IS NOT NULL','COALESCE(consent_at, recording_authorized_at) IS NOT NULL');
  execute format('alter table icash_recorded_reception_private.sessions drop constraint %I, add constraint %I %s',c.conname,c.conname,definition);
 end loop;
end $constraints$;
alter table icash_recorded_reception_private.configs add column entry_policy text not null default 'spoken_v1' check(entry_policy in ('spoken_v1','direct_recorded_v1'));
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
  if (to_jsonb(new)-array['state','row_version','call_started_at','call_deadline_at','consent_deadline_at','setup_claimed_at','setup_confirmed_at','consent_at','consent_evidence','recording_authorized_at','start_claimed_at','register_claimed_at','provider_started_at','recording_sid','conversation_id','ended_at','duration_seconds','audio_expires_at','deleted_at','end_requested_at','call_ended_at','call_terminal_status','provider_recording_price_micros','price_is_estimate','updated_at','next_reconcile_at','reconcile_attempts','reconcile_lease_token','reconcile_lease_expires_at','next_delete_at','deletion_attempts','deletion_lease_token','deletion_lease_expires_at','billing_state','settled_at','last_error','last_action']) is distinct from
   (to_jsonb(old)-array['state','row_version','call_started_at','call_deadline_at','consent_deadline_at','setup_claimed_at','setup_confirmed_at','consent_at','consent_evidence','recording_authorized_at','start_claimed_at','register_claimed_at','provider_started_at','recording_sid','conversation_id','ended_at','duration_seconds','audio_expires_at','deleted_at','end_requested_at','call_ended_at','call_terminal_status','provider_recording_price_micros','price_is_estimate','updated_at','next_reconcile_at','reconcile_attempts','reconcile_lease_token','reconcile_lease_expires_at','next_delete_at','deletion_attempts','deletion_lease_token','deletion_lease_expires_at','billing_state','settled_at','last_error','last_action']) then raise exception 'Recorded reception identity and policy are immutable';end if;
  if (old.recording_authorized_at is not null and new.recording_authorized_at is distinct from old.recording_authorized_at)
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
CREATE OR REPLACE FUNCTION public.icash_reserve_direct_reception(p_config_id uuid, p_call_sid text, p_provider_account_sid text, p_from_phone text, p_to_phone text, p_direction text, p_caller_hash text, p_nonce_hash text, p_stop_token_hash text, p_config_hash text, p_version_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare c icash_recorded_reception_private.configs;s icash_recorded_reception_private.sessions;r public.icash_operation_rates;o public.icash_operation_spend;b public.icash_operating_budget;t timestamptz;op text;planned numeric;p icash_recorded_reception_private.cost_policies;capacity bigint;seconds integer;price bigint;parts jsonb;total numeric;funded_seconds integer;funded_price bigint;funded_costs jsonb;
begin
 if coalesce(p_call_sid,'') !~ '^CA[0-9a-fA-F]{32}$' or coalesce(p_provider_account_sid,'') !~ '^AC[0-9a-fA-F]{32}$'
  or (coalesce(p_from_phone,'') !~ '^\+[1-9][0-9]{7,14}$' and coalesce(p_from_phone,'') not in ('anonymous','restricted','unknown')) or coalesce(p_to_phone,'') !~ '^\+[1-9][0-9]{7,14}$' or p_direction is distinct from 'inbound'
  or coalesce(p_caller_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_nonce_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_stop_token_hash,'') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('allowed',false,'reason','invalid_input');end if;
 -- Lock this version BEFORE the shared historical lane, matching config
 -- UPDATE's row lock then guard lock. Financial locks remain unchanged.
 select * into c from icash_recorded_reception_private.configs where id=p_config_id for update;
 if c.entry_policy is distinct from 'direct_recorded_v1' then return jsonb_build_object('allowed',false,'reason','direct_entry_configuration_required');end if;
 if not found or not c.enabled then return jsonb_build_object('allowed',false,'reason','disabled');end if;
 perform 1 from icash_reception_private.config where id=1 for update;
 if not found or exists(select 1 from icash_reception_private.config where enabled) or icash_recorded_reception_private.legacy_calls_pending() then return jsonb_build_object('allowed',false,'reason','legacy_lane_not_drained');end if;
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
  funded_seconds:=c.max_total_seconds;funded_price:=c.charge_cap_cents;funded_costs:=r.costs_micros;
  if c.call_profile='normal' and c.max_total_seconds=600 then
   capacity:=(public.icash_daily_allowance(c.account_id)->>'remainingCents')::bigint;
   select least(capacity,greatest(0,a.customer_cap_cents-coalesce((select sum(case when state='settled' then charged_cents else charge_cap_cents end) from public.icash_operation_spend where account_id=c.account_id and state in ('reserved','dispatched','settled')),0))) into capacity
    from public.icash_spend_activations a where a.account_id=c.account_id and a.enabled;
   if capacity is null then raise exception 'Active spending permission required';end if;
   if capacity<c.charge_cap_cents then
    funded_seconds:=null;
    for seconds in reverse 600..120 by 60 loop
     -- Preserve fixed/recording estimates. Round carrier time up by one minute.
     parts:=public.icash_voice_bounded_costs(r.costs_micros,seconds);
     select sum(value::numeric) into total from jsonb_each_text(parts);
     price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
     if price>0 and price<=least(capacity,c.charge_cap_cents) then
      funded_seconds:=seconds;funded_price:=price;funded_costs:=parts;exit;
     end if;
    end loop;
    if funded_seconds is null then return jsonb_build_object('allowed',false,'reason','insufficient_call_allowance');end if;
    insert into icash_recorded_reception_private.credit_bounds(operation_key,config_id,account_id,rate_id,max_seconds,charge_cents,costs_micros)
     values(op,c.id,c.account_id,c.rate_id,funded_seconds,funded_price,funded_costs);
   end if;
  end if;
  perform public.icash_reserve_operation(c.account_id,op,c.rate_id,least(c.reviewed_until,r.expires_at));
  select * into strict o from public.icash_operation_spend where operation_key=op for update;
  select ceil(sum(value::text::numeric)*(10000+r.buffer_bps)/10000) into planned from jsonb_each(funded_costs);
  if o.account_id<>c.account_id or o.rate_id<>c.rate_id or o.state<>'reserved' or o.charge_cap_cents<>funded_price or o.reserved_micros<>planned
   or o.customer_price_micros is not null
   or (c.cost_policy_id is not null and row(o.standard_cost_multiplier,o.elevenlabs_cost_multiplier) is distinct from row(p.standard_cost_multiplier,p.elevenlabs_cost_multiplier))
   or not exists(select 1 from public.icash_credit_reservations cr where cr.id=o.credit_reservation_id and cr.account_id=c.account_id and cr.operation_key=op and cr.status='reserved' and cr.amount_cents=funded_price) then raise exception 'Exact customer reserve required';end if;
  if not public.icash_claim_operation(op) then raise exception 'Recorded reception claim denied';end if;
  select * into strict o from public.icash_operation_spend where operation_key=op;
  if o.state<>'dispatched' then raise exception 'Dispatched operation required';end if;
  t:=icash_recorded_reception_private.clock_now();
  if t+make_interval(secs=>c.max_total_seconds+60)>least(c.reviewed_until,r.expires_at) then raise exception 'Review expired during admission';end if;
  insert into icash_recorded_reception_private.sessions(entry_policy,cost_policy_id,cost_policy_snapshot,configuration,config_id,account_id,operation_key,provider_account_sid,call_sid,direction,from_phone,to_phone,caller_hash,contact_key,config_hash,agent_id,branch_id,version_id,call_profile,rate_id,rate_snapshot,reserved_micros,charge_cap_cents,max_total_seconds,standard_cost_multiplier,elevenlabs_cost_multiplier,nonce_hash,stop_token_hash,disclosure_version,pricing_policy,created_at,updated_at,call_deadline_at,consent_deadline_at,next_reconcile_at)
  values('direct_recorded_v1',c.cost_policy_id,c.cost_policy_snapshot,icash_recorded_reception_private.config_json(c),c.id,c.account_id,op,p_provider_account_sid,p_call_sid,p_direction,p_from_phone,p_to_phone,p_caller_hash,encode(sha256(convert_to(p_from_phone,'UTF8')),'hex'),c.config_hash,c.agent_id,c.branch_id,c.version_id,c.call_profile,c.rate_id,c.rate_snapshot,o.reserved_micros,funded_price,funded_seconds,o.standard_cost_multiplier,o.elevenlabs_cost_multiplier,p_nonce_hash,p_stop_token_hash,c.disclosure_version,c.pricing_policy,t,t,t+interval '60 seconds',t+interval '60 seconds',t+interval '30 seconds') returning * into s;
 exception when raise_exception or check_violation or unique_violation or no_data_found then return jsonb_build_object('allowed',false,'reason','customer_funding_denied');end;
 return jsonb_build_object('allowed',true,'reason','reserved','session',to_jsonb(s));
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
 update icash_recorded_reception_private.sessions set state=ns,call_started_at=r.call_started_at,call_deadline_at=r.call_deadline_at,consent_deadline_at=r.consent_deadline_at,setup_claimed_at=r.setup_claimed_at,setup_confirmed_at=r.setup_confirmed_at,consent_at=r.consent_at,consent_evidence=r.consent_evidence,recording_authorized_at=r.recording_authorized_at,start_claimed_at=r.start_claimed_at,register_claimed_at=r.register_claimed_at,
  recording_sid=r.recording_sid,conversation_id=r.conversation_id,provider_started_at=r.provider_started_at,ended_at=r.ended_at,duration_seconds=r.duration_seconds,audio_expires_at=r.audio_expires_at,
  provider_recording_price_micros=r.provider_recording_price_micros,price_is_estimate=r.price_is_estimate,end_requested_at=r.end_requested_at,call_ended_at=r.call_ended_at,call_terminal_status=r.call_terminal_status,
  next_reconcile_at=r.next_reconcile_at,next_delete_at=r.next_delete_at,last_error=r.last_error,last_action=p_action,row_version=row_version+1,updated_at=t where id=r.id returning * into r;
 return to_jsonb(r);
end $function$;
CREATE OR REPLACE FUNCTION icash_recorded_reception_private.validate_cost_review(p_id uuid, p_attestation jsonb, p_components jsonb)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  if r.recording_sid is null or r.conversation_id is null or coalesce(r.consent_at,r.recording_authorized_at) is null or r.duration_seconds is null or r.ended_at is null or r.state not in ('available','expired','deletion_pending','deleted') then raise exception 'Complete recording and conversation required';end if;
  if not icash_recorded_reception_private.keys(p_attestation->'providers',array['twilio','elevenlabs']) then raise exception 'Both real provider receipts required';end if;
 end if;
 for cat,part in select key,value from jsonb_each(p_attestation->'providers') loop
  if cat='twilio' and part->>'basis'='estimated' then
   if not icash_recorded_reception_private.carrier_estimate_allowed(r,part,(p_attestation->>'durationSeconds')::numeric) then raise exception 'Approved exact carrier tariff estimate required';end if;
  elsif not icash_recorded_reception_private.keys(part,array['amountMicros','currency','receiptHash']) or part->>'currency' is distinct from 'USD'
   or not icash_recorded_reception_private.micros(part->'amountMicros') or coalesce(part->>'receiptHash','') !~ '^[a-f0-9]{64}$' then raise exception 'Exact USD provider receipt required';end if;
 end loop;
 speech:=case when r.entry_policy='direct_recorded_v1' or r.setup_confirmed_at is null then 0 else 20000 end;
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
 if p_components->'twilio'->'amountMicros' is distinct from p_attestation->'providers'->'twilio'->'amountMicros' or p_components->'twilio'->>'basis' is distinct from (case when p_attestation->'providers'->'twilio'->>'basis'='estimated' then 'estimated' else 'verified' end)
  or p_components->'elevenlabs'->'amountMicros' is distinct from (case when gate then '0'::jsonb else p_attestation->'providers'->'elevenlabs'->'amountMicros' end)
  or p_components->'elevenlabs'->>'basis' is distinct from 'verified' then raise exception 'Provider receipt cost mismatch';end if;
 if p_components->'llm'->'amountMicros' is distinct from '0'::jsonb or p_components->'llm'->>'basis' is distinct from 'verified' then raise exception 'Inclusive model cost required';end if;
 if (p_components->'other'->>'amountMicros')::numeric<>speech+rec+storage+stream or (speech+rec+storage+stream>0 and p_components->'other'->>'basis' is distinct from 'estimated') then raise exception 'Complete recording add-ons must remain estimated';end if;
 return basis;
end $function$;
CREATE OR REPLACE FUNCTION public.icash_recorded_reception_property_context(p_id uuid, p_nonce_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare r icash_recorded_reception_private.sessions;matches jsonb;opportunity jsonb;focus_thread uuid;history jsonb;checked_at timestamptz:=icash_recorded_reception_private.clock_now();
begin
 select s.* into r from icash_recorded_reception_private.sessions s
 join icash_recorded_reception_private.configs c on c.id=s.config_id
 join public.icash_accounts a on a.id=s.account_id and a.owner_user_id=c.owner_user_id
 join public.icash_operation_spend o on o.operation_key=s.operation_key and o.account_id=s.account_id
 where s.id=p_id and s.nonce_hash=p_nonce_hash and s.state='recording' and coalesce(s.consent_at,s.recording_authorized_at) is not null and s.recording_sid is not null
 and s.register_claimed_at is null and s.conversation_id is null and s.end_requested_at is null and s.call_ended_at is null
 and s.from_phone ~ '^\+[1-9][0-9]{7,14}$' and s.call_deadline_at>checked_at
 and c.enabled and not a.bot_paused and c.approved_at<=checked_at and c.reviewed_until>checked_at
 and o.state='dispatched' and o.rate_id=s.rate_id and o.charge_cap_cents=s.charge_cap_cents
 and c.context_policy='buyer_seller_v1' and c.context_policy_hash='06b4040c9d2b788ac204479d1179173f9acbd59172a7e930bac0b189438fde57'
 and length(btrim(c.context_approval_reference))>=10;
 if not found then return public.icash_recorded_reception_context_before_buyer(p_id,p_nonce_hash);end if;
 if exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(r.from_phone,'UTF8')),'hex'))
 or exists(select 1 from public.icash_text_suppressions where phone=r.from_phone) then return null;end if;
 -- Carry the exact, unexpired SMS property focus into the same account's return call.
 -- A different property's outbound message invalidates this focus in the SMS engine.
 select case when count(*)=1 then min(f.thread_id::text)::uuid end into focus_thread
 from public.icash_sms_conversation_focus f
 join public.icash_sms_routes route on route.sender=f.sender and route.recipient=f.recipient and route.account_id=f.account_id and route.revision=f.route_revision and not route.needs_review
 join public.icash_text_threads t on t.id=f.thread_id and t.account_id=f.account_id and t.sender=f.sender and t.recipient=f.recipient
 where f.account_id=r.account_id and f.recipient=r.from_phone and f.expires_at>checked_at and t.retired_at is null and t.party='seller' and not t.paused and not t.manual_only
 and not exists(select 1 from public.icash_text_threads other where other.account_id=r.account_id and other.recipient=r.from_phone and other.retired_at is null and other.party<>'seller');
 -- Caller ID permits public opportunity context only. Never seller identity,
 -- agreements, messages, account data, payment instructions or authentication.
 select jsonb_agg(to_jsonb(candidate)) into matches from (
  select distinct d.id,t.id thread_id,t.party,d.terms->>'address' address,
   (not t.paused and not t.manual_only and not exists(select 1 from public.icash_property_controls pc where pc.account_id=d.account_id and pc.property_id=sc.snapshot->>'propertyId' and pc.manual)) active
  from public.icash_text_threads t join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs sc on sc.id=d.screening_id and sc.account_id=d.account_id
  where t.account_id=r.account_id and t.recipient=r.from_phone and t.retired_at is null and (focus_thread is null or t.id=focus_thread)
  and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
  and exists(select 1 from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=t.id and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null and m.created_at between checked_at-interval '30 days' and checked_at)
  limit 2
 ) candidate;
 if coalesce(jsonb_array_length(matches),0)=0 then return null;end if;
 if jsonb_array_length(matches)<>1 then return jsonb_build_object('status','ambiguous');end if;
 if (matches->0->>'active')::boolean is not true or length(btrim(matches->0->>'address')) not between 1 and 300 then return null;end if;
 if matches->0->>'party'='buyer' then
  opportunity:=public.icash_buyer_package_data(r.account_id,(matches->0->>'id')::uuid);
  if opportunity is null then return null;end if;
  return jsonb_build_object('status','buyer','address',opportunity->'address','purchasePriceCents',opportunity->'purchasePriceCents','assignmentFeeCents',opportunity->'assignmentFeeCents','askingPriceCents',opportunity->'askingPriceCents','buyerPaysClosingCosts',true);
 end if;
 if matches->0->>'party'='seller' then
  select jsonb_agg(m order by m->>'at',m->>'id') into history from (
   select jsonb_build_object('id',m.id,'direction',m.direction,'body',left(m.body,1000),'at',m.created_at) m
   from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=(matches->0->>'thread_id')::uuid
    and m.created_at between checked_at-interval '30 days' and checked_at
    and ((m.direction='incoming' and m.state='received') or (m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null))
   order by m.created_at desc,m.id desc limit 12
  ) recent;
  return jsonb_build_object('status','matched','address',matches->0->>'address','smsContext',jsonb_build_object('threadId',matches->0->>'thread_id','messages',coalesce(history,'[]'::jsonb)));
 end if;
 return null;
end $function$;
revoke all on function public.icash_reserve_direct_reception(uuid,text,text,text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_reserve_direct_reception(uuid,text,text,text,text,text,text,text,text,text,text) to service_role;
commit;
