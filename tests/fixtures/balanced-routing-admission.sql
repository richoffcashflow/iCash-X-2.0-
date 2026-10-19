-- Read-only production function snapshots, 2026-10-19, before balanced routing.
-- Local fixture only; no provider calls or production writes.
CREATE OR REPLACE FUNCTION public.icash_begin_customer_phone_call(p_actor uuid, p_account uuid, p_screening uuid, p_recipient text, p_callback text, p_id uuid, p_sender text, p_provider_account text, p_nonce_hash text, p_quote jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare old public.icash_customer_phone_calls;r uuid;costs jsonb;part record;total bigint:=0;hold bigint;cap bigint;reason text;manual jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Account owner required';end if;
 select * into old from public.icash_customer_phone_calls where id=p_id;
 if found then
  if old.account_id<>p_account or old.actor_id<>p_actor or old.screening_id<>p_screening or old.callback_phone<>p_callback or old.recipient_phone<>p_recipient then raise exception 'Call key conflict';end if;
  return jsonb_build_object('created',false,'call',to_jsonb(old));
 end if;
 if (case when p_quote->>'connectionType'='browser' then p_callback !~ '^client:icash_[a-f0-9]{64}$' else p_callback !~ '^\+1[2-9][0-9]{9}$' end) or p_callback=p_recipient or p_callback=p_sender or p_recipient=p_sender then return jsonb_build_object('error','Enter your own phone number, different from the seller and business number.');end if;
 if p_provider_account !~ '^AC[a-fA-F0-9]{32}$' or p_nonce_hash !~ '^[a-f0-9]{64}$' then raise exception 'Provider binding required';end if;
 if p_sender is null or p_sender is distinct from public.icash_customer_call_sender(p_account,p_screening,p_recipient) then return jsonb_build_object('error','Your business calling number is unavailable. Please try again.');end if;
 if exists(select 1 from public.icash_customer_phone_calls where account_id=p_account and ended_at is null) then return jsonb_build_object('error','A previous call is still active or being checked.');end if;
 if (select count(*) from public.icash_customer_phone_calls where (callback_phone=p_callback or account_id=p_account) and created_at>now()-interval '1 hour')>=5 then return jsonb_build_object('error','Too many call attempts. Try again later.');end if;
 reason:=public.icash_manual_contact_reason(p_account,p_screening,p_recipient,'voice');if reason is not null then return jsonb_build_object('error',reason);end if;
 if p_quote->>'currency' is distinct from 'USD' or p_quote->>'country' is distinct from 'US' or p_quote->>'from' is distinct from p_sender or p_quote->>'callback' is distinct from p_callback or p_quote->>'recipient' is distinct from p_recipient or p_quote->>'checkedAt' is null or p_quote->>'receiptHash' is null or p_quote->>'receiptHash' !~ '^[a-f0-9]{64}$' or (p_quote->>'checkedAt')::timestamptz<now()-interval '2 minutes' or (p_quote->>'checkedAt')::timestamptz>now()+interval '5 seconds' then raise exception 'Current bound pricing required';end if;
 if jsonb_typeof(p_quote->'callbackMicrosPerMinute') is distinct from 'number' or jsonb_typeof(p_quote->'recipientMicrosPerMinute') is distinct from 'number' or (p_quote->>'callbackMicrosPerMinute')::numeric not between 1 and 100000 or (p_quote->>'recipientMicrosPerMinute')::numeric not between 1 and 100000 then raise exception 'Call price unavailable';end if;
 if p_quote->>'connectionType'='browser' and (p_quote->>'recordingPolicy' is distinct from 'customer-phone-recorded-v1' or (p_quote->>'callbackMicrosPerMinute')::numeric<>4000) then raise exception 'Browser recording and rate required';end if;
 -- Retain approved platform allocations; record both legs once for new clients.
 if p_quote->>'recordingPolicy' is not null and p_quote->>'recordingPolicy'<>'customer-phone-recorded-v1' then raise exception 'Unknown recording policy';end if;
 select r.costs_micros into costs from public.icash_operation_rates r join public.icash_voice_configs c on c.seller_rate_id=r.id where c.account_id=p_account and c.enabled and r.operation='seller_call' and r.enabled and r.expires_at>now() order by r.verified_at desc limit 1;
 if costs is null then raise exception 'Operating cost review required';end if;
 costs:=costs||jsonb_build_object('twilio',ceil(((p_quote->>'callbackMicrosPerMinute')::numeric+(p_quote->>'recipientMicrosPerMinute')::numeric)*10),'elevenlabs',0,'llm',0,'other',case when p_quote->>'recordingPolicy'='customer-phone-recorded-v1' then 33000 else 0 end,'messaging',0,'email',0,'dealmachine',0,'title_and_signing',0,'acquisition',0);
 select sum(value::text::bigint) into total from jsonb_each(costs);
 hold:=ceil(total::numeric*2*1.2/10000);
 if hold not between 1 and 1000 or not exists(select 1 from public.icash_operating_budget where id=1 and enabled and standard_cost_multiplier=2 and elevenlabs_cost_multiplier=2) then raise exception '2x calling pricing required';end if;
 insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled,voice_max_duration_seconds)
 values('customer_phone_call',case when p_quote->>'recordingPolicy'='customer-phone-recorded-v1' then 'customer-phone-recorded-2x-v1:' else 'customer-phone-2x-v1:' end||p_id,hold,costs,2000,'Live Twilio number pricing: '||p_quote::text||'; 600s each leg; existing approved platform allocations are estimates; no AI. Recording when enabled: estimate 2500 micros/minute capture plus 500 micros/minute for 30-day storage; 11-minute bounded allowance.',now(),now()+interval '15 minutes',true,600) returning id into r;
 insert into public.icash_customer_phone_calls(id,account_id,actor_id,screening_id,callback_phone,recipient_phone,business_phone,provider_account_sid,nonce_hash,operation_key,rate_id,recording_required,recording_state,connection_type)
 values(p_id,p_account,p_actor,p_screening,p_callback,p_recipient,p_sender,p_provider_account,p_nonce_hash,'customer-phone:'||p_id,r,coalesce(p_quote->>'recordingPolicy'='customer-phone-recorded-v1',false),case when p_quote->>'recordingPolicy'='customer-phone-recorded-v1' then 'pending' else 'unrequested' end,case when p_quote->>'connectionType'='browser' then 'browser' else 'phone' end);
 perform public.icash_reserve_operation(p_account,'customer-phone:'||p_id,r,now()+interval '2 minutes');
 if not public.icash_claim_operation('customer-phone:'||p_id) then raise exception 'Call spending not available';end if;
 manual:=public.icash_start_manual_call(p_actor,p_account,p_screening,p_recipient);
 if manual->>'error' is not null then raise exception 'Contact state changed';end if;
 select * into old from public.icash_customer_phone_calls where id=p_id;
 return jsonb_build_object('created',true,'call',to_jsonb(old),'holdCents',hold);
end $function$
;

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
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_project_operational_sms_contacts(p_account uuid DEFAULT NULL::uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_operational_contacts;r public.icash_operation_rates;v_sender text;deal uuid;price bigint;checked timestamptz;inserted integer;total integer:=0;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not found then return 0;end if;
 perform public.icash_prepare_operational_contacts(p_account);
 -- Ambiguous sender configuration is a setup problem, never a reason to guess.
 if not exists(select 1 from public.icash_text_senders where enabled) then return 0;end if;
 select * into r from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id)
  order by verified_at desc,id limit 1 for share;
 if not found then return 0;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 if not found then return 0;end if;
 for c in select oc.* from public.icash_operational_contacts oc
  join public.icash_accounts a on a.id=oc.account_id and not a.bot_paused
  where oc.channel='sms' and (p_account is null or oc.account_id=p_account) and oc.revoked_at is null and oc.eligibility_until>now()
   and (not exists(select 1 from public.icash_dnc_verification_receipts receipt where receipt.id=oc.dnc_receipt_id and receipt.evidence_kind='national_provider_observation')
    or public.icash_operational_contact_current(oc.account_id,oc.id,'sms',false))
   and not exists(select 1 from public.icash_text_threads th join public.icash_deal_files df on df.id=th.deal_id and df.account_id=th.account_id where th.retired_at is null and th.account_id=oc.account_id and df.screening_id=oc.screening_id and th.recipient=oc.phone)
   and public.icash_prospect_sms_route_available(oc.account_id,oc.screening_id,oc.phone,public.icash_property_text_sender(oc.account_id,(select existing.id from public.icash_deal_files existing where existing.account_id=oc.account_id and existing.screening_id=oc.screening_id),oc.phone))
  order by oc.account_id,oc.phone,oc.id limit 100
 loop
  perform pg_advisory_xact_lock(hashtextextended(c.phone,74));
  perform 1 from public.icash_accounts where id=c.account_id and not bot_paused for update;
  if not found then continue;end if;
  perform 1 from public.icash_outreach_campaigns where account_id=c.account_id for share;
  if not public.icash_outreach_sms_current(c.account_id)
   or not public.icash_operational_contact_current(c.account_id,c.id,'sms',false) then continue;end if;

  select id into deal from public.icash_deal_files where account_id=c.account_id and screening_id=c.screening_id;
  v_sender:=public.icash_property_text_sender(c.account_id,deal,c.phone);
  if v_sender is null or not public.icash_prospect_sms_route_available(c.account_id,c.screening_id,c.phone,v_sender) then continue;end if;
  -- Automatic prospect draft handoff. No user save is needed to prepare the
  -- existing SMS workflow. This does not send, charge, record seller consent,
  -- accept an offer, or replace any existing draft or executed deal.
  if not public.icash_membership_work_allowed(c.account_id)
   or not exists(select 1 from public.icash_wallets w where w.account_id=c.account_id and w.balance_cents>0)
   or exists(select 1 from public.icash_billing_reviews b where b.account_id=c.account_id and b.resolved_at is null)
   then continue;end if;
  insert into public.icash_deal_files(account_id,screening_id,terms)
  select s.account_id,s.id,jsonb_build_object(
   'address',s.result->'property'->>'address','state',s.snapshot->'raw'->'data'->>'state',
   'buyer',i.principal,'seller','','priceCents',null,'priceSource','proposed')
  from public.icash_screening_jobs s
  join public.icash_customer_identities i on i.account_id=s.account_id and nullif(trim(i.principal),'') is not null
  where s.id=c.screening_id and s.account_id=c.account_id and s.state='complete'
   and s.snapshot->>'propertyType'='house' and s.snapshot->'sellerRequest' is null
   and coalesce(s.snapshot->>'practice','false')<>'true'
   and s.snapshot->>'propertyId'=s.result->'property'->>'propertyId'
   and nullif(trim(s.result->'property'->>'address'),'') is not null
   and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state')
   and s.result->'financialCheck'->>'status'='eligible'
   and s.completed_at between now()-interval '24 hours' and now()
   and case when pg_catalog.pg_input_is_valid(s.snapshot->>'fetchedAt','timestamp with time zone')
    then (s.snapshot->>'fetchedAt')::timestamptz between now()-interval '24 hours' and now() else false end
   and not exists(select 1 from public.icash_property_controls pc
    where pc.account_id=s.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   and not exists(select 1 from public.icash_handoffs h
    where h.account_id=s.account_id and h.screening_id=s.id and h.state<>'resolved')
   and not exists(select 1 from public.icash_deal_files existing
    where existing.account_id=s.account_id and existing.screening_id=s.id)
  -- A concurrent manual save wins unchanged. Never use the draft UPSERT here:
  -- it would replace customer terms if a save raced the missing-row check.
  on conflict(account_id,screening_id) do nothing;
  -- A source with two live property bindings must be resolved rather than picked.
  if (select count(*) from public.icash_deal_files d where d.account_id=c.account_id and d.screening_id=c.screening_id
   and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true')<>1 then continue;end if;
  select d.id into deal from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
   where d.account_id=c.account_id and d.screening_id=c.screening_id and d.stage='draft' and coalesce(d.terms->>'practice','false')<>'true'
    and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at between now()-interval '24 hours' and now()
    and not exists(select 1 from public.icash_property_controls pc where pc.account_id=c.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
   for share of d,s;
  if not found then continue;end if;
  checked:=clock_timestamp();
  if least(c.eligibility_until,r.expires_at)<=checked or r.verified_at>checked then continue;end if;
  insert into public.icash_text_threads(sender_pool_assigned,account_id,deal_id,sender,recipient,timezone,dnc_checked_at,dnc_clear,sms_rate_id,
   paused,party,ai_mode,sms_intake_pending,operational_contact_id,eligibility_until,operational_sms_sender,operational_sms_rate_hash,operational_sms_price_micros)
  select true,c.account_id,deal,v_sender,c.phone,c.timezone,dr.checked_at,dr.clear,r.id,false,'seller','auto',false,c.id,
   least(c.eligibility_until,r.expires_at),v_sender,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),price
  from public.icash_dnc_verification_receipts dr where dr.id=c.dnc_receipt_id and dr.phone=c.phone
  on conflict(account_id,deal_id,sender,recipient) where retired_at is null and owner_buyer_test_id is null do nothing;
  get diagnostics inserted=row_count;total:=total+inserted;
 end loop;
 return total;
end $function$
;

