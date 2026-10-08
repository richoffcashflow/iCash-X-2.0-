-- Outbound buyer contact is SMS/email only. Keep inbound routing and seller calls.
begin;

CREATE OR REPLACE FUNCTION public.icash_queue_voice_jobs_before_operational()
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 insert into public.icash_voice_jobs(account_id,permission_id)
 select p.account_id,p.id from public.icash_contact_permissions p join public.icash_voice_configs c on c.account_id=p.account_id and c.enabled join public.icash_accounts a on a.id=p.account_id and not a.bot_paused join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id and s.state='complete'
 where public.icash_outreach_voice_current(p.account_id) and p.revoked_at is null and p.permission_until>now() and (p.dnc_clear or public.icash_seller_voice_permission_current(p.account_id,p.id)) and (s.result->'financialCheck'->>'status'='eligible' or public.icash_seller_limited_contact(p.account_id,p.screening_id)) and p.party='seller' and not exists(select 1 from public.icash_voice_jobs prior join public.icash_operational_contacts oc on oc.id=prior.operational_contact_id where prior.account_id=p.account_id and oc.account_id=p.account_id and oc.screening_id=p.screening_id and oc.contact_key=p.contact_key and prior.callback_id is null)
 and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.callback_id is null) limit 100
 on conflict do nothing;
 -- Buyers receive outbound SMS/email only. Inbound buyer calls remain available.
 insert into public.icash_voice_jobs(account_id,permission_id,callback_id,due_at)
 select b.account_id,p.id,b.id,b.due_at from public.icash_live_callbacks b join public.icash_live_conversations c on c.id=b.conversation_id join public.icash_contact_permissions p on p.account_id=b.account_id and p.screening_id=b.screening_id and p.contact_key=c.contact_key and p.party=c.party
 where public.icash_outreach_voice_current(b.account_id) and c.party='seller' and c.state='complete' and (c.result->>'callbackDueAt')::timestamptz=b.due_at and b.state='pending_dispatch_review' and b.due_at>now()-interval '15 minutes' and p.revoked_at is null and p.permission_until>b.due_at and not exists(select 1 from public.icash_voice_jobs v where v.callback_id=b.id) limit 100 on conflict do nothing;
 update public.icash_voice_jobs set state='held',outcome='Callback time passed; review required' where state='ready' and callback_id is not null and due_at<now()-interval '15 minutes';
 update public.icash_live_callbacks b set state='missed' where state='pending_dispatch_review' and due_at<now()-interval '15 minutes';
 -- An expired one-use ticket may be issued again only before provider dispatch was claimed.
 update public.icash_voice_jobs set state='ready' where state='issued' and updated_at<now()-interval '5 minutes';
end $function$;

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

 if j.operational_contact_id is not null then
  if not public.icash_operational_contact_current(j.account_id,j.operational_contact_id,'voice',true) then return false;end if;
 else
  perform 1 from public.icash_contact_permissions where id=j.permission_id and account_id=j.account_id for share;
 end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=j.account_id;

 select * into c from public.icash_voice_configs where account_id=j.account_id for share;
 if p.id is null or p.party is distinct from 'seller' or not c.enabled or c.reviewed_until<=now() or p.revoked_at is not null or p.permission_until<=now() or not (public.icash_seller_voice_permission_current(j.account_id,p.id) or (p.dnc_clear and p.dnc_checked_at is not null and p.dnc_checked_at between now()-interval '30 days' and now())) then return false;end if;
 if not exists(select 1 from public.icash_timezone_names where name=p.timezone) then return false;end if;
 h:=extract(hour from now() at time zone p.timezone);
 if h<greatest(9,p.local_start_hour) or h>=least(case when public.icash_seller_voice_permission_current(j.account_id,p.id) then 20 else 18 end,p.local_end_hour) then return false;end if;
 perform 1 from public.icash_accounts where id=j.account_id and not bot_paused for update;if not found then return false;end if;
 if not exists(select 1 from public.icash_wallets where account_id=j.account_id and balance_cents>=reserved_cents and reserved_cents>0) then return false;end if;
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
end $function$;

CREATE OR REPLACE FUNCTION public.icash_reserve_flexible_voice(p_account uuid, p_job uuid, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;r public.icash_operation_rates;c public.icash_voice_configs;b public.icash_operating_budget;bound public.icash_voice_credit_bounds;capacity bigint;parts jsonb;price bigint;seconds integer;allowance jsonb;total numeric;operation text:='voice:'||p_job;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' then return null;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account;
 select * into c from public.icash_voice_configs where account_id=p_account;
 select * into r from public.icash_operation_rates where id=p_rate and enabled and verified_at<=now() and expires_at>now() and voice_max_duration_seconds=600 and charge_cents=977 and version like 'required-audio-30d-speech-v1:%';
 if p.id is null or p.party is distinct from 'seller' or r.id is null or not c.enabled or c.reviewed_until<=now() or p_rate is distinct from (case p.party when 'buyer' then c.buyer_rate_id else c.seller_rate_id end) then return null;end if;
 if exists(select 1 from public.icash_operation_spend where operation_key=operation) then
  select * into bound from public.icash_voice_credit_bounds where operation_key=operation and account_id=p_account and rate_id=p_rate;
  if public.icash_reserve_paced_voice(p_account,p_job,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible) then return jsonb_build_object('maxSeconds',coalesce(bound.max_seconds,600));end if;return null;
 end if;
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 capacity:=(public.icash_daily_allowance(p_account)->>'remainingCents')::bigint;
 if not b.require_company_reserve then
  select least(capacity,greatest(0,a.customer_cap_cents-coalesce((select sum(case when state='settled' then charged_cents else charge_cap_cents end) from public.icash_operation_spend where account_id=p_account and state in ('reserved','dispatched','settled')),0))) into capacity
   from public.icash_spend_activations a where a.account_id=p_account and a.enabled;
 end if;
 if capacity is null then return null;end if;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;end if;
 if p.party='seller' and j.callback_id is null and exists(select 1 from public.icash_daytime_pacing_settings where id=1 and enabled) and not public.icash_seller_voice_permission_current(p_account,p.id) then
  allowance:=public.icash_voice_daytime_allowance(p_account,p.id);capacity:=least(capacity,coalesce((allowance->>'allowedCents')::bigint,0));
 end if;
 for seconds in reverse (case when public.icash_seller_limited_contact(p_account,p.screening_id) then 120 else 600 end)..120 by 60 loop
  parts:=public.icash_voice_bounded_costs(r.costs_micros,seconds);
  select sum(value::numeric) into total from jsonb_each_text(parts);
  price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
  if price<=capacity then
   insert into public.icash_voice_credit_bounds(operation_key,account_id,rate_id,max_seconds,charge_cents,costs_micros) values(operation,p_account,p_rate,seconds,price,parts);
   if public.icash_reserve_paced_voice(p_account,p_job,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible) then return jsonb_build_object('maxSeconds',seconds,'reservedCents',price);end if;
   delete from public.icash_voice_credit_bounds where operation_key=operation;
   return null;
  end if;
 end loop;
 update public.icash_voice_jobs set state='ready',due_at=now()+interval '1 minute',outcome='Waiting for available credits or daily allowance',updated_at=now() where id=p_job;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_reserve_paced_voice(p_account uuid, p_job uuid, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_voice_jobs;p public.icash_voice_contact_targets;r public.icash_operation_rates;a jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account for update;
 if not found or j.state<>'issued' then return false;end if;
 select * into p from public.icash_voice_contact_targets where id=coalesce(j.permission_id,j.operational_contact_id) and account_id=p_account;
 select * into r from public.icash_operation_rates where id=p_rate;
 if p.id is null or p.party is distinct from 'seller' or r.id is null then return false;end if;
 if public.icash_voice_credit_bound(p_account,'voice:'||j.id,p_rate) is not null then
  r.charge_cents:=(public.icash_voice_credit_bound(p_account,'voice:'||j.id,p_rate)->>'charge_cents')::bigint;
 end if;
 if p.party='seller' and j.callback_id is null and exists(select 1 from public.icash_daytime_pacing_settings where id=1 and enabled)
 and not public.icash_seller_voice_permission_current(p_account,p.id)
 and not exists(select 1 from public.icash_operation_spend where operation_key='voice:'||j.id and account_id=p_account) then
 a:=public.icash_voice_daytime_allowance(p_account,p.id);
 if coalesce((a->>'allowedCents')::bigint,0)<r.charge_cents then
 update public.icash_voice_jobs set state='ready',due_at=now()+interval '30 minutes',outcome='Waiting for daytime budget allocation',updated_at=now() where id=j.id;
 return false;
 end if;end if;

 if j.operational_contact_id is not null then
  if not public.icash_operational_contact_current(p_account,j.operational_contact_id,'voice',true)
   or not public.icash_claim_inventory(p_account,p.screening_id,p.phone) then return false;end if;
  p_permission_until:=least(p_permission_until,p.permission_until);
 end if;
 perform public.icash_reserve_operation(p_account,'voice:'||j.id,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
 return true;
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
  if r.party='buyer' and r.dial_claimed_at is null then return null;end if;
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
  and p.party='seller'
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

CREATE OR REPLACE FUNCTION public.icash_live_callback_tool(p_hash text, p_conversation text, p_due timestamp with time zone, p_timezone text, p_readback text, p_confirmation text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_live_conversations;result uuid;
begin
 select * into c from public.icash_live_conversations where tool_token_hash=p_hash and conversation_id=p_conversation and tool_expires_at>now() and state='waiting' for update;
 if not found or p_due<=now() or p_due>now()+interval '90 days' or not exists(select 1 from public.icash_timezone_names where name=p_timezone) or length(p_readback)<10 or length(p_confirmation)<2 then raise exception 'Callback not confirmed';end if;
 if c.party='buyer' then return jsonb_build_object('saved',false,'reason','buyer_outbound_calls_disabled','instruction','Buyer follow-up is by text or email. Do not promise an outbound call. The buyer may call us.');end if;
 if exists(select 1 from public.icash_contact_suppressions where account_id=c.account_id and contact_key=c.contact_key) or exists(select 1 from public.icash_handoffs where conversation_id=c.id and state<>'resolved') then raise exception 'Contact held';end if;
 insert into public.icash_live_callbacks(conversation_id,account_id,screening_id,due_at,timezone,evidence)
 values(c.id,c.account_id,c.screening_id,p_due,p_timezone,jsonb_build_object('readback',p_readback,'confirmation',p_confirmation,'source','live_tool_pending_transcript_verification'))
 on conflict(conversation_id) do update set due_at=excluded.due_at,timezone=excluded.timezone,evidence=excluded.evidence,state='pending_dispatch_review' where icash_live_callbacks.state in ('pending_dispatch_review','held_for_human') returning id into result;
 if result is null then raise exception 'Callback already handled';end if;
 return jsonb_build_object('saved',true,'callbackId',result,'dueAt',p_due,'timezone',p_timezone,'instruction','Callback request saved; it remains subject to contact permission and operating availability.');
end $function$;

-- Retire only jobs that have never reached a provider. The existing hold RPC
-- releases any unspent reservation and preserves uncertain or dispatched work.
do $$
declare j record;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 for j in select v.id,v.account_id from public.icash_voice_jobs v
 join public.icash_voice_contact_targets p on p.id=coalesce(v.permission_id,v.operational_contact_id) and p.account_id=v.account_id
 where p.party='buyer' and v.state in ('ready','issued')
 and v.provider_call_sid is null and v.conversation_id is null
 and not exists(select 1 from public.icash_operation_spend o where o.account_id=v.account_id and o.operation_key='voice:'||v.id and o.state not in ('reserved','cancelled'))
 for update of v loop
  update public.icash_voice_jobs set state='issued' where id=j.id and state='ready';
  perform public.icash_hold_voice_job(j.account_id,j.id,'buyer_outbound_calls_disabled');
 end loop;
end $$;
commit;
