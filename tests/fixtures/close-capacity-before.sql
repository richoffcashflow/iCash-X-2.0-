CREATE OR REPLACE FUNCTION public.icash_voice_queue_slot_open(p_account uuid, p_job uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(
  select 1 from public.icash_voice_jobs j
  join public.icash_voice_contact_targets target on target.id=coalesce(j.permission_id,j.operational_contact_id)
   and target.account_id=j.account_id and target.party='seller' and target.contact_key is not null
   and ((j.permission_id is not null and j.operational_contact_id is null and target.eligibility_source='operator_record')
    or (j.permission_id is null and j.operational_contact_id is not null and target.eligibility_source='operational_checks_only'))
  where j.id=p_job and j.account_id=p_account and j.state='ready'
  and not exists(
   select 1 from public.icash_voice_jobs busy where busy.id<>j.id
    and (busy.state in ('issued','dispatching') or (busy.state='held' and busy.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')))
    and (busy.account_id=j.account_id or exists(
     select 1 from public.icash_voice_contact_targets other where other.id=coalesce(busy.permission_id,busy.operational_contact_id)
      and other.account_id=busy.account_id and other.contact_key=target.contact_key
      and ((busy.permission_id is not null and busy.operational_contact_id is null and other.eligibility_source='operator_record')
       or (busy.permission_id is null and busy.operational_contact_id is not null and other.eligibility_source='operational_checks_only')))))
  and not exists(select 1 from public.icash_live_conversations live where live.state in ('waiting','review')
   and (live.account_id=j.account_id or live.contact_key=target.contact_key))
 );
$function$

;
CREATE OR REPLACE FUNCTION public.icash_reserve_direct_reception(p_config_id uuid, p_call_sid text, p_provider_account_sid text, p_from_phone text, p_to_phone text, p_direction text, p_caller_hash text, p_nonce_hash text, p_stop_token_hash text, p_config_hash text, p_version_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare callback_route jsonb;c icash_recorded_reception_private.configs;s icash_recorded_reception_private.sessions;r public.icash_operation_rates;o public.icash_operation_spend;b public.icash_operating_budget;t timestamptz;op text;planned numeric;p icash_recorded_reception_private.cost_policies;capacity bigint;seconds integer;price bigint;parts jsonb;total numeric;funded_seconds integer;funded_price bigint;funded_costs jsonb;
begin
 if coalesce(p_call_sid,'') !~ '^CA[0-9a-fA-F]{32}$' or coalesce(p_provider_account_sid,'') !~ '^AC[0-9a-fA-F]{32}$'
  or (coalesce(p_from_phone,'') !~ '^\+[1-9][0-9]{7,14}$' and coalesce(p_from_phone,'') not in ('anonymous','restricted','unknown')) or coalesce(p_to_phone,'') !~ '^\+[1-9][0-9]{7,14}$' or p_direction is distinct from 'inbound'
  or coalesce(p_caller_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_nonce_hash,'') !~ '^[a-f0-9]{64}$' or coalesce(p_stop_token_hash,'') !~ '^[a-f0-9]{64}$' then return jsonb_build_object('allowed',false,'reason','invalid_input');end if;
 -- Lock this version BEFORE the shared historical lane, matching config
 -- UPDATE's row lock then guard lock. Financial locks remain unchanged.
 select * into c from icash_recorded_reception_private.configs where id=p_config_id for update;
 if c.entry_policy is distinct from 'direct_recorded_v1' then return jsonb_build_object('allowed',false,'reason','direct_entry_configuration_required');end if;
 if not found or not c.enabled or not icash_callback_private.config_current(c) then return jsonb_build_object('allowed',false,'reason','disabled');end if;
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

 if c.callback_template_id is not null then
  callback_route:=icash_callback_private.route(p_from_phone);
  if callback_route is null or callback_route->>'status' not in ('matched','ambiguous')
   or (callback_route->>'accountId')::uuid is distinct from c.account_id then
   return jsonb_build_object('allowed',false,'reason','callback_route_changed');end if;
 end if;
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
 if public.icash_vip_active(c.account_id) then b.standard_cost_multiplier:=b.standard_cost_multiplier*0.7;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.7;end if;
 begin
  funded_seconds:=c.max_total_seconds;funded_price:=c.charge_cap_cents;funded_costs:=r.costs_micros;
  if c.call_profile='normal' and c.max_total_seconds=600 then
   capacity:=(public.icash_daily_allowance(c.account_id)->>'remainingCents')::bigint;
   if coalesce(capacity,0)<=0 then return jsonb_build_object('allowed',false,'reason','credits_exhausted');end if;
   if capacity<c.charge_cap_cents or public.icash_vip_active(c.account_id) then
    funded_seconds:=null;
    for seconds in reverse 600..600 by 60 loop
     -- Preserve fixed/recording estimates. Round carrier time up by one minute.
     parts:=public.icash_voice_bounded_costs(r.costs_micros,seconds);
     select sum(value::numeric) into total from jsonb_each_text(parts);
     price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
     if price>0 and price<=c.charge_cap_cents then
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
   or (c.cost_policy_id is not null and row(o.standard_cost_multiplier,o.elevenlabs_cost_multiplier) is distinct from row(b.standard_cost_multiplier,b.elevenlabs_cost_multiplier))
   or not exists(select 1 from public.icash_credit_reservations cr where cr.id=o.credit_reservation_id and cr.account_id=c.account_id and cr.operation_key=op and cr.status='reserved' and cr.amount_cents=funded_price) then raise exception 'Exact customer reserve required';end if;
  if not public.icash_claim_operation(op) then raise exception 'Recorded reception claim denied';end if;
  select * into strict o from public.icash_operation_spend where operation_key=op;
  if o.state<>'dispatched' then raise exception 'Dispatched operation required';end if;
  t:=icash_recorded_reception_private.clock_now();
  if t+make_interval(secs=>c.max_total_seconds+60)>least(c.reviewed_until,r.expires_at) then raise exception 'Review expired during admission';end if;
  insert into icash_recorded_reception_private.sessions(callback_route,entry_policy,cost_policy_id,cost_policy_snapshot,configuration,config_id,account_id,operation_key,provider_account_sid,call_sid,direction,from_phone,to_phone,caller_hash,contact_key,config_hash,agent_id,branch_id,version_id,call_profile,rate_id,rate_snapshot,reserved_micros,charge_cap_cents,max_total_seconds,standard_cost_multiplier,elevenlabs_cost_multiplier,nonce_hash,stop_token_hash,disclosure_version,pricing_policy,created_at,updated_at,call_deadline_at,consent_deadline_at,next_reconcile_at)
  values(callback_route,'direct_recorded_v1',c.cost_policy_id,c.cost_policy_snapshot,icash_recorded_reception_private.config_json(c),c.id,c.account_id,op,p_provider_account_sid,p_call_sid,p_direction,p_from_phone,p_to_phone,p_caller_hash,encode(sha256(convert_to(p_from_phone,'UTF8')),'hex'),c.config_hash,c.agent_id,c.branch_id,c.version_id,c.call_profile,c.rate_id,c.rate_snapshot,o.reserved_micros,funded_price,funded_seconds,o.standard_cost_multiplier,o.elevenlabs_cost_multiplier,p_nonce_hash,p_stop_token_hash,c.disclosure_version,c.pricing_policy,t,t,t+interval '60 seconds',t+interval '60 seconds',t+interval '30 seconds') returning * into s;
 exception when raise_exception or check_violation or unique_violation or no_data_found then return jsonb_build_object('allowed',false,'reason','customer_funding_denied');end;
 return jsonb_build_object('allowed',true,'reason','reserved','session',to_jsonb(s));
end $function$

;
CREATE OR REPLACE FUNCTION public.icash_claim_voice_job(p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;c public.icash_voice_configs;prop text;h integer;
begin
 -- Match the ledger lock order so Stop and spending claims serialize.
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job for update;
 if not found or j.state<>'issued' or j.due_at>now() then return false;end if;
 if (not public.icash_voice_outreach_hours_current(j.account_id,p_job) or not public.icash_seller_phone_call_current(j.account_id,p_job)) then return false;end if;

 if j.operational_contact_id is not null then
  if not public.icash_operational_contact_current(j.account_id,j.operational_contact_id,'voice',false) then return false;end if;
 else
  perform 1 from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id for share;
 end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=j.account_id;

 select * into c from public.icash_voice_configs where account_id=j.account_id for share;
 if p.id is null or p.party is distinct from 'seller' or not c.enabled or c.reviewed_until<=now() or p.revoked_at is not null or p.permission_until<=now() or not (public.icash_seller_voice_permission_current(j.account_id,p.id) or (p.dnc_clear and p.dnc_checked_at is not null and p.dnc_checked_at between now()-interval '30 days' and now())) then return false;end if;
 if not exists(select 1 from public.icash_timezone_names where name=p.timezone) then return false;end if;
 h:=extract(hour from now() at time zone p.timezone);
 -- Current business hours were checked above; all recipient evidence remains required.
 perform 1 from public.icash_accounts where id=j.account_id and not bot_paused for update;if not found then return false;end if;
 if not exists(select 1 from public.icash_wallets where account_id=j.account_id and balance_cents>0) then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p.contact_key,17));
 if exists(select 1 from public.icash_contact_suppressions where contact_key=p.contact_key) then return false;end if;
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=p.screening_id and account_id=j.account_id and state='complete';
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=j.account_id and property_id=prop and manual) then return false;end if;
 if j.callback_id is not null and not exists(select 1 from public.icash_live_callbacks where id=j.callback_id and account_id=j.account_id and state='pending_dispatch_review' and due_at between now()-interval '15 minutes' and now()) then return false;end if;
 -- Serialize per account and contact. Uncertain dispatches remain held, never auto-retried.
 if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets x on x.id=coalesce(v.permission_id,v.operational_contact_id) where v.id<>j.id and (v.state='dispatching' or (v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))) and (v.account_id=j.account_id or x.contact_key=p.contact_key)) then return false;end if;
 if exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=j.account_id or contact_key=p.contact_key)) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id where o.operation_key='voice:'||j.id and o.account_id=j.account_id and o.rate_id=case when p.party='buyer' then c.buyer_rate_id else c.seller_rate_id end and r.operation=case when p.party='buyer' then 'buyer_call' else 'seller_call' end and r.voice_max_duration_seconds>=c.max_duration_seconds) then return false;end if;
 if p.party='buyer' and public.icash_buyer_voice_context(p.id) is null then return false;end if;
 if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
 update public.icash_voice_jobs set state='dispatching',updated_at=now(),operation_key='voice:'||id where id=j.id;
 return true;
end $function$

;
CREATE OR REPLACE FUNCTION public.icash_claim_cancellation_voice(p_account uuid, p_job uuid, p_context jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' or public.icash_cancellation_voice_context(p_account,p_job) is distinct from p_context or not public.icash_cancellation_voice_current(p_account,'voice:'||j.id) then return false;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account;
 perform pg_advisory_xact_lock(hashtextextended(p.phone,74));
 if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets cp on cp.id=coalesce(v.permission_id,v.operational_contact_id) and cp.account_id=v.account_id
  where v.id<>j.id and (v.state='dispatching' or (v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))) and (v.account_id=p_account or cp.phone=p.phone))
 or exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=p_account or contact_key=p.contact_key)) then return false;end if;
 if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
 update public.icash_voice_jobs set state='dispatching',operation_key='voice:'||id,updated_at=now() where id=j.id;
 return true;
end $function$

;
CREATE OR REPLACE FUNCTION public.icash_meta_claim_or_defer_voice(p_account uuid, p_job uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_contact_permissions;c public.icash_voice_configs;h integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' or j.due_at>now() then return 'unavailable';end if;
 if public.icash_meta_voice_context(p_account,p_job) is null then perform public.icash_hold_voice_job(p_account,p_job,'dispatch_permission_changed',false); return 'held';end if;
 if (not public.icash_voice_outreach_hours_current(p_account,p_job) or not public.icash_seller_phone_call_current(p_account,p_job)) then perform public.icash_hold_voice_job(p_account,p_job,'dispatch_permission_changed',false); return 'held';end if;
 select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=p_account for share;
 select * into c from public.icash_voice_configs where account_id=p_account and enabled and reviewed_until>now() for share;
 if c.account_id is null or not public.icash_outreach_voice_current(p_account) then perform public.icash_hold_voice_job(p_account,p_job,'dispatch_permission_changed',false); return 'held';end if;
 h:=extract(hour from now() at time zone p.timezone);
 -- Meta voice context already verifies current inbound contact evidence.
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then perform public.icash_hold_voice_job(p_account,p_job,'dispatch_permission_changed',false); return 'held';end if;
 perform pg_advisory_xact_lock(hashtextextended(p.contact_key,17));
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
  where o.operation_key='voice:'||j.id and o.account_id=p_account and o.rate_id=c.seller_rate_id and r.operation='seller_call' and r.voice_max_duration_seconds>=c.max_duration_seconds) then perform public.icash_hold_voice_job(p_account,p_job,'dispatch_permission_changed',false); return 'held';end if;
 if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets t on t.id=coalesce(v.permission_id,v.operational_contact_id)
  where v.id<>j.id and (v.state='dispatching' or v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) and (v.account_id=p_account or t.contact_key=p.contact_key))
  or exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=p_account or contact_key=p.contact_key)) then
  if j.callback_id is not null or j.sms_source_message_id is not null or j.cancellation_notice_id is not null
   or j.meta_offer_lead_id is not null or j.meta_followup_lead_id is not null or j.operational_contact_id is not null
   or j.operation_key is not null or j.provider_call_sid is not null or j.conversation_id is not null
   or not exists(select 1 from public.icash_meta_leads m where m.account_id=p_account and m.voice_job_id=j.id)
   or not exists(select 1 from public.icash_operation_spend o where o.account_id=p_account and o.operation_key='voice:'||j.id
    and o.state='reserved' and o.dispatched_at is null and o.settled_at is null
    and coalesce(o.actual_micros,0)=0 and coalesce(o.charged_cents,0)=0)
   or exists(select 1 from public.icash_call_recordings r where r.voice_job_id=j.id or r.operation_key='voice:'||j.id)
   or exists(select 1 from public.icash_live_conversations v where v.operation_key='voice:'||j.id) then perform public.icash_hold_voice_job(p_account,p_job,'dispatch_permission_changed',false); return 'held';end if;
  declare claim_valid boolean:=false;
  begin
   -- Use the real final membership, credits, activation, consent expiry and
   -- company-budget chain. Its successful ledger transition is rolled back;
   -- no provider work occurs in any of these database functions.
   if not public.icash_claim_operation('voice:'||j.id) then perform public.icash_hold_voice_job(p_account,p_job,'dispatch_permission_changed',false); return 'held';end if;
   claim_valid:=true;
   raise exception using errcode='P0M01',message='Meta initial call deferred solely for active-call contention';
  exception when sqlstate 'P0M01' then
   if not claim_valid then raise;end if;
   -- Budget/job/account/contact locks were acquired outside this savepoint.
   -- The SAME reserved operation and original provider evidence are retained.
   update public.icash_voice_jobs set state='ready',due_at=now()+interval '1 minute',
    outcome='Waiting for another call to finish',updated_at=now() where id=j.id and account_id=p_account;
   return 'deferred';
  end;
 end if;
 if not public.icash_claim_operation('voice:'||j.id) then perform public.icash_hold_voice_job(p_account,p_job,'dispatch_permission_changed',false); return 'held';end if;
 update public.icash_voice_jobs set state='dispatching',updated_at=now(),operation_key='voice:'||id where id=j.id;
 return 'claimed';
end $function$

;
CREATE OR REPLACE FUNCTION public.icash_meta_claim_voice(p_account uuid, p_job uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_contact_permissions;c public.icash_voice_configs;h integer;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' or j.due_at>now() or public.icash_meta_voice_context(p_account,p_job) is null then return false;end if;
 if (not public.icash_voice_outreach_hours_current(p_account,p_job) or not public.icash_seller_phone_call_current(p_account,p_job)) then return false;end if;
 select * into p from public.icash_contact_permissions where id=j.permission_id and account_id=p_account for share;
 select * into c from public.icash_voice_configs where account_id=p_account and enabled and reviewed_until>now() for share;
 if c.account_id is null or not public.icash_outreach_voice_current(p_account) then return false;end if;
 h:=extract(hour from now() at time zone p.timezone);
 -- Meta voice context already verifies current inbound contact evidence.
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return false;end if;
 perform pg_advisory_xact_lock(hashtextextended(p.contact_key,17));
 if exists(select 1 from public.icash_voice_jobs v join public.icash_voice_contact_targets t on t.id=coalesce(v.permission_id,v.operational_contact_id)
  where v.id<>j.id and (v.state='dispatching' or v.state='held' and v.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry')) and (v.account_id=p_account or t.contact_key=p.contact_key))
  or exists(select 1 from public.icash_live_conversations where state in ('waiting','review') and (account_id=p_account or contact_key=p.contact_key)) then return false;end if;
 if not exists(select 1 from public.icash_operation_spend o join public.icash_operation_rates r on r.id=o.rate_id
  where o.operation_key='voice:'||j.id and o.account_id=p_account and o.rate_id=c.seller_rate_id and r.operation='seller_call' and r.voice_max_duration_seconds>=c.max_duration_seconds) then return false;end if;
 if not public.icash_claim_operation('voice:'||j.id) then return false;end if;
 update public.icash_voice_jobs set state='dispatching',updated_at=now(),operation_key='voice:'||id where id=j.id;
 return true;
end $function$
