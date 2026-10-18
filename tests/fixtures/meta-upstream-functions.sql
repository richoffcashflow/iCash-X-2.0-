-- Existing production prerequisites, schema only; no data or credentials.
CREATE OR REPLACE FUNCTION public.icash_assign_seller_lead_for(p_lead uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.icash_seller_intakes;a record;parts jsonb;total bigint;charge bigint;rate uuid;op text;screen uuid;evidence text;manifest jsonb;city_name text;state_code text;match_count integer;cost_quote jsonb;lead_multiplier integer;threshold_cents bigint;
begin
 -- Consistent lock order with all other paid operations.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_seller_controls where id=1 and enabled for share;if not found then return null;end if;
 select * into l from public.icash_seller_intakes where (state in ('qualified','assigned') or (state='numbers_review' and exists(select 1 from public.icash_seller_controls where id=1 and limited_contact_enabled) and result->'financialCheck'->>'status'='hold' and result->'property'->'financialScreening'->>'status' in ('payoff_may_exceed_budget','title_review_needed'))) and (p_lead is null or id=p_lead) and next_assignment_at<=now()
 and (numbers_passed or not exists(select 1 from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id))
 and (select count(*) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<case when contact_consent_scope='icash_x_demo' then 1 else 3 end
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<=now()
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=icash_seller_intakes.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations c on c.account_id=sm.account_id and c.screening_id=sm.screening_id join public.icash_contact_suppressions s on s.account_id=c.account_id and s.contact_key=c.contact_key where sm.lead_id=icash_seller_intakes.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=icash_seller_intakes.id)

 and exists(select 1 from public.icash_accounts ac where (icash_seller_intakes.contact_consent_scope is distinct from 'icash_x_demo' or icash_seller_intakes.attribution->>'demoAccountId'=ac.id::text) and public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused and not exists(select 1 from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id and m.account_id=ac.id))
 order by next_assignment_at,created_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 city_name:=lower(trim(l.property->>'city'));state_code:=upper(l.property->>'state');
 if not public.icash_research_state_allowed(state_code) then update public.icash_seller_intakes set state='review',hold_reason='State excluded from automatic acquisition' where id=l.id;return jsonb_build_object('status','state_excluded');end if;
 if l.data_rights_until is null or l.data_rights_until<=now() or not exists(select 1 from public.icash_seller_controls where id=1 and enabled and data_rights_until>now() and length(coalesce(review_ref,''))>=10) then
 update public.icash_seller_intakes set state='review',hold_reason='Current data-use configuration required' where id=l.id;return jsonb_build_object('status','review');end if;
 if l.checked_at is null or l.checked_at<now()-interval '8 days' then
  update public.icash_seller_intakes set state='review',hold_reason='Shared research window ended' where id=l.id;
  return jsonb_build_object('status','research_window_ended');
 end if;
 parts:=l.customer_costs;
 if parts is null then
  cost_quote:=public.icash_seller_acquisition_quote(l.id);
  if cost_quote is null then
   update public.icash_seller_intakes set next_assignment_at=now()+interval '15 minutes',hold_reason='Record ad cost or a source estimate in Lead costs' where id=l.id;
   return jsonb_build_object('status','acquisition_cost_required','leadId',l.id);
  end if;
  parts:=l.lookup_costs||jsonb_build_object('acquisition',(cost_quote->>'costMicros')::bigint);
 end if;
 if parts is null or jsonb_typeof(parts)<>'object' or nullif(l.lookup_cost_basis,'') is null then return jsonb_build_object('status','research_cost_required');end if;select sum(value::numeric)::bigint into total from jsonb_each_text(parts);select s.threshold_cents into threshold_cents from public.icash_seller_cost_settings s where id=1;
 lead_multiplier:=coalesce(l.customer_lead_multiplier,case when l.customer_costs is not null then 3 else 2 end);
 charge:=ceil(total::numeric*lead_multiplier/10000);
 if charge<=0 then raise exception 'Positive cost-based lead price required';end if;
 evidence:=coalesce(l.customer_cost_basis,'lead_acquisition_v1: '||(cost_quote||jsonb_build_object('multiplier',lead_multiplier,'pricingPolicy','all-usage-2x-20261018'))::text||'; recorded research and operating allocations: '||l.lookup_cost_basis);
 select count(*) into match_count from public.icash_seller_matches where lead_id=l.id;
 -- Weighted distribution at the same recorded cost-based price;
 -- Preserve deployed any-market allocation; wallet and daily allowance still apply.
 for a in select candidate.* from (select ac.id,(public.icash_daily_allowance(ac.id)->>'remainingCents')::bigint capacity
 from public.icash_accounts ac join public.icash_wallets w on w.account_id=ac.id
 where (l.contact_consent_scope is distinct from 'icash_x_demo' or l.attribution->>'demoAccountId'=ac.id::text) and not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>ac.id) and public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=ac.id)
 and not exists(select 1 from public.icash_billing_reviews where account_id=ac.id and resolved_at is null)
 ) candidate where capacity>=case when public.icash_vip_active(candidate.id) then ceil(charge*0.8) else charge end
 -- Larger available budgets receive more opportunities; a square-root weight
 -- keeps smaller funded accounts competitive. First access rotates separately.
 order by
 public.icash_vip_active(candidate.id) desc,
 case when exists(select 1 from public.icash_seller_matches m where m.account_id=candidate.id and m.assigned_at>now()-interval '24 hours') then 1 else 0 end,
 (case when match_count=0 then (select count(*) from public.icash_seller_intakes i where i.assigned_account=candidate.id and i.assigned_at>now()-interval '7 days') else (select count(*) from public.icash_seller_matches m where m.account_id=candidate.id and m.assigned_at>now()-interval '7 days') end + 1)
 /power(greatest(candidate.capacity,charge)::numeric/charge,0.75) / public.icash_hybrid_inbound_share((select daily_limit_cents from public.icash_accounts where id=candidate.id))
 / (1+least(7,greatest(0,extract(epoch from(now()-coalesce((select max(m.assigned_at) from public.icash_seller_matches m where m.account_id=candidate.id),now()-interval '7 days')))/86400))),
 (select count(*) from public.icash_seller_matches m where m.account_id=candidate.id and m.assigned_at>now()-interval '7 days'),
 capacity desc,candidate.id limit 50 loop
  select s.threshold_cents into threshold_cents from public.icash_seller_cost_settings s where id=1;
 lead_multiplier:=coalesce(l.customer_lead_multiplier,case when l.customer_costs is not null then 3 else 2 end);
 charge:=ceil(total::numeric*lead_multiplier/10000);
  if public.icash_vip_active(a.id) then charge:=ceil(charge*0.8);end if;
  if a.capacity<charge then continue;end if;
  op:='seller-lead:'||l.id||':'||a.id;
  begin
   insert into public.icash_operation_rates(operation,version,charge_cents,costs_micros,buffer_bps,evidence_ref,verified_at,expires_at,enabled)
   values('seller_lead',op,charge,parts,0,evidence,now(),least(now()+interval '24 hours',l.checked_at+interval '8 days',l.data_rights_until),true) returning id into rate;
   perform public.icash_reserve_operation(a.id,op,rate,l.data_rights_until,l.checked_at,l.numbers_passed);
   if not public.icash_claim_operation(op) then raise exception 'Lead reservation held';end if;
   select jsonb_object_agg(key,jsonb_build_object('amountMicros',value,'evidenceRef',evidence)) into manifest from jsonb_each(parts);
   perform public.icash_settle_complete_costs(op,charge,manifest,evidence);
   update public.icash_operation_spend set cost_basis='estimated' where operation_key=op;
   insert into public.icash_screening_jobs(account_id,event_key,snapshot,state,result,completed_at)
   values(a.id,op,jsonb_build_object('propertyId',l.property->>'id','propertyType','house','fetchedAt',l.property->>'fetchedAt','raw',l.property->'raw','sellerCostReserveCents',l.property->'sellerCostReserveCents','sellerRequest',jsonb_build_object('id',l.id,'ownerName',l.name,'phone',l.phone,'aiConsented',l.ai_consented,'consentVersion',l.consent_version,'consentText',l.consent_text,'consentScope',l.contact_consent_scope,'email',l.email,'emailConsented',l.email_consented,'shared',l.contact_consent_scope is distinct from 'icash_x_demo','maximumBuyers',case when l.contact_consent_scope='icash_x_demo' then 1 else 3 end)), 'complete',l.result,l.checked_at) returning id into screen;
   insert into public.icash_seller_matches(lead_id,account_id,screening_id,operation_key,charge_cents) values(l.id,a.id,screen,op,charge);
   -- One immediate user, second after 24 hours, third after 72 hours.
   -- Cap at three distinct users. This never simulates buyers or contact.
   update public.icash_seller_intakes set customer_costs=parts,customer_cost_basis=evidence,customer_lead_multiplier=lead_multiplier,state='assigned',assigned_account=coalesce(assigned_account,a.id),screening_id=coalesce(screening_id,screen),operation_key=coalesce(operation_key,op),assigned_at=coalesce(assigned_at,now()),
    next_assignment_at=public.icash_seller_assignment_due(match_count+1,coalesce(assigned_at,now()),now()),hold_reason=null where id=l.id;
   return jsonb_build_object('status','assigned','leadId',l.id,'accountId',a.id,'chargeCents',charge);
  exception when others then
   -- The subtransaction rolls back rate, reservation, charge and assignment together.
   null;
  end;
 end loop;
 update public.icash_seller_intakes set next_assignment_at=now()+interval '15 minutes',hold_reason='Waiting for a funded bot whose market and available credits fit this lead' where id=l.id;
 return jsonb_build_object('status','waiting_for_budget');
end $function$;

CREATE OR REPLACE FUNCTION public.icash_finish_seller_lookup(p_id uuid, p_token uuid, p_output jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.icash_seller_intakes;parts jsonb;cost bigint;numbers boolean;market boolean;city_name text;st text;used integer;duplicate_property uuid;
begin
 perform 1 from public.icash_seller_controls where id=1 for update;
 select * into l from public.icash_seller_intakes where id=p_id for update;
 if not found or l.state<>'checking' or l.claim_token<>p_token or l.claimed_at<now()-interval '2 minutes' then return false;end if;
 used:=(p_output->>'creditsUsed')::integer;
 if used not between 0 and 1 or used is null or octet_length(p_output::text)>64000 then raise exception 'Invalid lookup receipt';end if;
 numbers:=coalesce((p_output->>'numbersPassed')::boolean,false) and p_output->'result'->'financialCheck'->>'status'='eligible' and (p_output->'result'->>'preliminarySellerCeilingCents')::bigint>0;
 city_name:=lower(trim(p_output->'property'->>'city'));st:=upper(p_output->'property'->>'state');
 market:=numbers;
 parts:=l.lookup_costs||jsonb_build_object('dealmachine',(l.lookup_costs->>'dealmachine')::bigint*used);
 select sum(value::numeric)::bigint into cost from jsonb_each_text(parts);
 update public.icash_seller_controls set lookup_reserved_micros=lookup_reserved_micros-l.lookup_cap_micros,lookup_used_micros=lookup_used_micros+cost where id=1;
 if p_output->'property'->>'id' is not null then
  perform pg_advisory_xact_lock(hashtextextended('seller-property:'||(p_output->'property'->>'id'),0));
  select candidate.id into duplicate_property from public.icash_seller_intakes candidate
  where candidate.id<>l.id and candidate.property->>'id'=p_output->'property'->>'id'
   and candidate.state<>'duplicate' and candidate.checked_at is not null and candidate.created_at>now()-interval '90 days'
   and case when l.contact_consent_scope='icash_x_demo'
    then public.icash_demo_intake_current(candidate.id,(l.attribution->>'demoAccountId')::uuid)
    else candidate.contact_consent_scope is distinct from 'icash_x_demo' end
  order by candidate.created_at,candidate.id limit 1;
 end if;
 if duplicate_property is not null then
  update public.icash_seller_intakes set state='duplicate',canonical_id=duplicate_property,lookup_costs=parts,result=p_output->'result',property=p_output->'property',checked_at=now(),numbers_passed=false,market_qualified=false where id=l.id;
  return true;
 end if;
 update public.icash_seller_intakes set lookup_costs=parts,result=p_output->'result',property=p_output->'property',numbers_passed=coalesce(numbers,false),market_qualified=coalesce(market,false),checked_at=now(),state=case when market then 'qualified' when p_output->>'status'='unmatched' then 'unmatched' else 'numbers_review' end where id=l.id;
 if market then insert into public.icash_seller_events(lead_id,event_name,evidence_ref) values(l.id,'Lead','inbound-address:screening:'||l.id) on conflict do nothing;end if;
 return true;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_prepare_seller_contacts(p_account uuid, p_lead uuid, p_screening uuid, p_deal uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.icash_seller_intakes;e jsonb;r public.icash_operation_rates;chosen_sender text;price bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;
 if not found then return;end if;
 perform 1 from public.icash_deal_files where id=p_deal and account_id=p_account and screening_id=p_screening and stage='draft' and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return;end if;
 select * into l from public.icash_seller_intakes where id=p_lead;
 e:=public.icash_seller_contact_evidence(p_account,p_screening,p_lead,l.phone);
 if e is null then return;end if;
 if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=p_screening and s.account_id=p_account and pc.manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=p_screening and state<>'resolved') then return;end if;
 if public.icash_outreach_voice_current(p_account) then
  insert into public.icash_contact_permissions(account_id,screening_id,party,phone,contact_key,timezone,local_start_hour,local_end_hour,permission_evidence,permission_until,dnc_checked_at,dnc_clear,seller_intake_id)
  values(p_account,p_screening,'seller',l.phone,encode(sha256(convert_to(l.phone,'UTF8')),'hex'),e->>'timezone',9,20,e->>'evidence',(e->>'until')::timestamptz,null,false,l.id)
  on conflict(account_id,screening_id,party,contact_key) do nothing;
 end if;
 if not public.icash_outreach_sms_current(p_account) then return;end if;
 -- Ambiguous sender configuration must not silently select a different business number.
 chosen_sender:=public.icash_property_text_sender(p_account,p_deal,l.phone);if chosen_sender is null then return;end if;
 select * into r from public.icash_operation_rates where operation='sms_send' and public.icash_sms_intake_rate_current(id) order by verified_at desc,charge_cents,id limit 1 for share;
 if not found then return;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 perform public.icash_retire_expired_practice_threads(p_account,chosen_sender,l.phone);
 insert into public.icash_text_threads(sender_pool_assigned,account_id,deal_id,sender,recipient,permission_until,permission_evidence,timezone,dnc_checked_at,dnc_clear,sms_rate_id,paused,ai_mode,party,seller_intake_id,seller_sms_rate_hash,seller_sms_price_micros)
 values(true,p_account,p_deal,chosen_sender,l.phone,(e->>'until')::timestamptz,e->>'evidence',e->>'timezone',null,false,r.id,false,'auto','seller',l.id,encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex'),price)
 on conflict(account_id,deal_id,sender,recipient) where retired_at is null and owner_buyer_test_id is null do nothing;
 -- Never reassign, unpause, renew or overwrite an existing contact on a retry.
end $function$;

CREATE OR REPLACE FUNCTION public.icash_queue_text(p_account uuid, p_thread uuid, p_key uuid, p_body text, p_assets uuid[])
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;m public.icash_text_messages;urls jsonb;total bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or t.retired_at is not null or not exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=p_account) then raise exception 'Thread not available';end if;
 if length(trim(p_body))=0 and cardinality(p_assets)=0 then raise exception 'Message required';end if;
 if length(p_body)>1000 or cardinality(p_assets)>3 then raise exception 'Message too large';end if;
 -- One SMS segment per reviewed rate; MMS has its own independent rate.
 if cardinality(p_assets)=0 and not public.icash_sms_single_segment(p_body) then raise exception 'Shorten the message';end if;
 select coalesce(jsonb_agg(url order by id),'[]'),coalesce(sum(bytes),0) into urls,total from public.icash_text_assets where id=any(p_assets) and account_id=p_account and deal_id=t.deal_id and verified_until>now();
 if jsonb_array_length(urls)<>cardinality(p_assets) or total>5000000 then raise exception 'Verified attachments required';end if;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,asset_ids,attachments,state,request_key) values(t.id,p_account,'outgoing',p_body,p_assets,urls,'ready',p_key) on conflict(request_key) do nothing;
 select * into m from public.icash_text_messages where request_key=p_key;
 -- Insert uses the caller's idempotency key below; no cross-account lookup may return an ID.
 if m.id is null then raise exception 'Message key missing';end if;
 if m.account_id<>p_account or m.thread_id<>p_thread or m.body<>p_body or m.asset_ids<>p_assets then raise exception 'Message key conflict';end if;
 return m.id;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_recorded_reception_property_context(p_id uuid, p_nonce_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context jsonb;s icash_recorded_reception_private.sessions;ids uuid[];t public.icash_text_threads;focus uuid;package jsonb;
begin
 context:=public.icash_reception_context_before_buyer_binding(p_id,p_nonce_hash);
 if context is null or context->>'status'<>'buyer' then return context;end if;
 select * into s from icash_recorded_reception_private.sessions where id=p_id and nonce_hash=p_nonce_hash
 and state='recording' and register_claimed_at is null and conversation_id is null and call_ended_at is null and end_requested_at is null and call_deadline_at>now();
 if not found then return null;end if;
 focus:=icash_recorded_reception_private.return_call_focus(s.account_id,s.from_phone,now());
 select array_agg(th.id) into ids from public.icash_text_threads th join public.icash_deal_files d on d.id=th.deal_id and d.account_id=th.account_id
 where th.account_id=s.account_id and th.party='buyer' and th.recipient=s.from_phone and th.retired_at is null and not th.paused and not th.manual_only
 and (focus is null or th.id=focus) and (th.owner_buyer_test_id is null or public.icash_owner_buyer_test_current(th.owner_buyer_test_id))
 and d.terms->>'address'=context->>'address'
 and exists(select 1 from public.icash_text_messages m where m.thread_id=th.id and m.account_id=th.account_id and m.direction='outgoing' and m.state in ('accepted','delivered') and m.provider_id is not null and m.created_at between now()-interval '30 days' and now());
 if cardinality(ids) is distinct from 1 then return null;end if;
 select * into t from public.icash_text_threads where id=ids[1];
 package:=public.icash_buyer_package_data(s.account_id,t.deal_id);
 if package is null then return null;end if;
 insert into icash_recorded_reception_private.buyer_bindings(session_id,account_id,deal_id,thread_id) values(s.id,s.account_id,t.deal_id,t.id) on conflict do nothing;
 if not exists(select 1 from icash_recorded_reception_private.buyer_bindings where session_id=s.id and account_id=s.account_id and deal_id=t.deal_id and thread_id=t.id) then return null;end if;
 return context||jsonb_build_object('closingDate',package->'closingDate','viewingStatus','request_confirmation');
end $function$;

CREATE OR REPLACE FUNCTION public.icash_reserve_before_activation(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare op text;screen uuid;phone text;party text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select operation into op from public.icash_operation_rates where id=p_rate;
 if op='owner_enrichment' then
 select id into screen from public.icash_screening_jobs where account_id=p_account and 'owners:'||p_account||':'||id=p_operation;
 elsif op='seller_call' then
 select p.screening_id,p.phone into screen,phone from public.icash_voice_jobs j join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id where j.account_id=p_account and 'voice:'||j.id=p_operation and p.party='seller';
 elsif op in ('sms_send','mms_send') then
 select d.screening_id,t.recipient,t.party into screen,phone,party from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id where m.account_id=p_account and 'text:'||m.id=p_operation;
 end if;
 if op in ('owner_enrichment','seller_call') or (op in ('sms_send','mms_send') and party='seller') then
 if screen is null or not public.icash_claim_inventory(p_account,screen,phone) then raise exception 'Seller inventory assigned or suppressed';end if;
 end if;
 return public.icash_reserve_before_inventory(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_reserve_before_fractional(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; r public.icash_operation_rates; o public.icash_operation_spend; cat text; n numeric; total numeric:=0; held bigint; daily numeric; cr uuid; required numeric; price numeric;
begin
 if p_operation is null or length(p_operation) not between 1 and 160 then raise exception 'Invalid operation'; end if;
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.enabled then raise exception 'Automation on hold'; end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation;
 if found then
  if o.account_id<>p_account or o.rate_id<>p_rate then raise exception 'Operation conflict'; end if;
  return jsonb_build_object('operationKey',o.operation_key,'state',o.state,'reservedMicros',o.reserved_micros);
 end if;
 select * into r from public.icash_operation_rates where id=p_rate for share;
 if not found or not r.enabled or r.verified_at>now() or r.expires_at<=now() then raise exception 'Verified rate required'; end if;
 if public.icash_voice_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_voice_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_voice_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
 if public.icash_reception_credit_bound(p_account,p_operation,p_rate) is not null then
  r.charge_cents:=(public.icash_reception_credit_bound(p_account,p_operation,p_rate)->>'charge_cents')::bigint;
  r.costs_micros:=public.icash_reception_credit_bound(p_account,p_operation,p_rate)->'costs_micros';
 end if;
 if p_permission_until is null or p_permission_until<=now() then raise exception 'Permission expired'; end if;
 if r.operation='seller_call' and not public.icash_limited_seller_voice(p_account,p_operation) and not public.icash_cancellation_voice_current(p_account,p_operation) and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=b.standard_cost_multiplier*0.8;b.elevenlabs_cost_multiplier:=b.elevenlabs_cost_multiplier*0.8;end if;
 if r.operation='seller_lead' then
  b.standard_cost_multiplier:=public.icash_seller_lead_rate_multiplier(p_account,p_operation,p_rate)*case when public.icash_vip_active(p_account) then 0.8 else 1 end;
  b.elevenlabs_cost_multiplier:=b.standard_cost_multiplier;
 end if;
 -- Match JS: round reserve up to a cent after adding buffer.
 held:=ceil(total*(10000+r.buffer_bps)/10000);
 required:=ceil((total*b.standard_cost_multiplier-(r.costs_micros->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/10000);
 price:=r.charge_cents::numeric*10000;
 if r.operation='sms_send' then
 select customer_price_micros into price from public.icash_text_messages where 'text:'||id=p_operation and account_id=p_account;
 end if;

 if r.flat_customer_price_cents is not null then
  if r.operation<>'sms_send' or price is distinct from r.flat_customer_price_cents::numeric*10000 then raise exception 'SMS flat price snapshot mismatch';end if;
  -- Snapshot cost-coverage accounting only for this explicit flat-price operation.
  -- The existing fractional ledger charges the immutable customer_price_micros.
  required:=held;b.standard_cost_multiplier:=1;b.elevenlabs_cost_multiplier:=1;
 end if;
 if price is null or price<required then raise exception 'Price below provider cost multiplier';end if;
 if b.require_company_reserve and b.funded_micros::numeric-b.spent_micros-b.reserved_micros-b.protected_micros<held then raise exception 'Company budget exhausted'; end if;
 select coalesce(sum(actual_micros),0) into daily from public.icash_operation_spend where settled_at>now()-interval '24 hours';
 if b.require_company_reserve and daily+b.reserved_micros+held>b.daily_limit_micros then raise exception 'Company daily limit'; end if;
 cr:=public.icash_reserve_credit(p_account,p_operation,r.charge_cents);
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,financial_checked_at)
 values(p_operation,p_account,p_rate,cr,r.charge_cents,held,p_permission_until,p_financial_checked_at);
 update public.icash_operation_spend set standard_cost_multiplier=b.standard_cost_multiplier,elevenlabs_cost_multiplier=b.elevenlabs_cost_multiplier,required_revenue_micros=required where operation_key=p_operation;
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_seller_contact_evidence(p_account uuid, p_screening uuid, p_lead uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.icash_seller_intakes;principal text;tz text;expiry timestamptz;binding jsonb;
begin
 select * into l from public.icash_seller_intakes where id=p_lead for share;
 if not found or l.phone is distinct from p_phone or not l.ai_consented or l.state<>'assigned'
  or (
   (l.consent_version='homeoffer-seller-contact-2026-10-05.4' and l.contact_consent_scope='homeoffer_network_and_matched_buyers'
    and l.consent_text='I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.')
   or (l.consent_version='icash-x-demo-contact-2026-10-10.1' and l.contact_consent_scope='icash_x_demo'
    and l.consent_text='I agree to calls and texts from iCash X about this property demo, including automated texts and AI-generated voice calls. I have permission to use this number. Consent is not a condition of purchase. Message/data rates may apply. Reply STOP to end texts.' and l.attribution->>'demoAccountId'=p_account::text)
  ) is not true
  or l.consent_version is null or l.consent_text is null or l.contact_consent_scope is null
  or l.created_at>now() or l.created_at<=now()-interval '30 days' or l.data_rights_until is null or l.data_rights_until<=now() then return null;end if;
 perform 1 from public.icash_seller_matches where lead_id=p_lead and account_id=p_account and screening_id=p_screening for share;
 if not found then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account for share;
 if nullif(trim(principal),'') is null then return null;end if;
 tz:=l.attribution->>'contactTimezone';
 if l.attribution->>'contactTimezoneSource' not in ('seller_browser','owner_test_context') or l.attribution->>'contactTimezoneSource' is null
  or not exists(select 1 from public.icash_timezone_names where name=tz)
  or exists(select 1 from public.icash_text_suppressions where phone=p_phone)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')) then return null;end if;
 expiry:=least(l.created_at+interval '30 days',l.data_rights_until);
 binding:=jsonb_build_object('lead',l.id,'account',p_account,'screening',p_screening,'phone',l.phone,'principal',principal,'consentVersion',l.consent_version,'consentText',l.consent_text,'scope',l.contact_consent_scope,'receivedAt',l.created_at,'timezone',tz,'timezoneSource',l.attribution->>'contactTimezoneSource');
 return jsonb_build_object('timezone',tz,'until',expiry,'evidence','seller-intake:'||l.id||':'||encode(sha256(convert_to(binding::text,'UTF8')),'hex'));
end $function$;

CREATE OR REPLACE FUNCTION public.icash_seller_human_answer(p_transcript jsonb)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 with turns as (
  select trim(t->>'message') as message from jsonb_array_elements(case when jsonb_typeof(p_transcript)='array' then p_transcript else '[]'::jsonb end) t
  where t->>'role'='user' and jsonb_typeof(t->'message')='string'
 ) select exists(select 1 from turns where length(message)>0)
 and not exists(select 1 from turns where message ~* '(voice[ -]?mail|mailbox|leave.{0,25}(message|name|number)|after.{0,12}(tone|beep)|you.{0,8}(have reached|ve reached)|call.{0,20}(forwarded|not available)|automated.{0,20}(system|assistant)|not available.{0,25}(call|message)|press [0-9]|disconnected|number.{0,20}not in service)');
$function$;

CREATE OR REPLACE FUNCTION public.icash_seller_sms_permission_current(p_account uuid, p_thread uuid, p_check_hour boolean DEFAULT true)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;r public.icash_operation_rates;e jsonb;price bigint;h integer;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account for share;
 if not found or t.seller_intake_id is null or t.party<>'seller' or t.paused or t.manual_only or t.ai_mode<>'auto'
  or t.dnc_clear or t.dnc_checked_at is not null or t.sms_review_request_id is not null or t.operational_contact_id is not null then return false;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return false;end if;
 e:=public.icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient);
 if e is null or t.permission_evidence is distinct from e->>'evidence' or t.timezone is distinct from e->>'timezone'
  or t.permission_until is distinct from (e->>'until')::timestamptz or not public.icash_outreach_sms_current(p_account) then return false;end if;
 perform 1 from public.icash_text_senders where phone=t.sender and enabled for share;
 if not found then return false;end if;
 select * into r from public.icash_operation_rates where id=t.sms_rate_id for share;
 if not found or not public.icash_sms_intake_rate_current(r.id)
  or encode(sha256(convert_to(to_jsonb(r)::text,'UTF8')),'hex') is distinct from t.seller_sms_rate_hash then return false;end if;
 select customer_micros into price from public.icash_communication_prices where operation='sms_segment' for share;
 if not found or price is null or t.seller_sms_price_micros is null or price>t.seller_sms_price_micros then return false;end if;
 if exists(select 1 from public.icash_property_controls pc join public.icash_screening_jobs s on s.account_id=pc.account_id and s.snapshot->>'propertyId'=pc.property_id where s.id=d.screening_id and s.account_id=p_account and pc.manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=d.screening_id and state<>'resolved') then return false;end if;
 h:=extract(hour from now() at time zone t.timezone);
 return not p_check_hour or (h>=9 and h<20) or public.icash_seller_sms_inquiry_window(p_account,t.id);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_seller_voice_permission_current(p_account uuid, p_permission uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p public.icash_contact_permissions;e jsonb;
begin
 select * into p from public.icash_contact_permissions where id=p_permission and account_id=p_account for share;
 if not found or p.seller_intake_id is null or p.party<>'seller' or p.revoked_at is not null or p.permission_until<=now()
  or p.dnc_clear or p.dnc_checked_at is not null or p.review_request_id is not null or p.buyer_id is not null
  or p.contact_key is distinct from encode(sha256(convert_to(p.phone,'UTF8')),'hex') then return false;end if;
 e:=public.icash_seller_contact_evidence(p.account_id,p.screening_id,p.seller_intake_id,p.phone);
 return e is not null and p.permission_evidence is not distinct from e->>'evidence'
  and p.timezone is not distinct from e->>'timezone' and p.permission_until is not distinct from (e->>'until')::timestamptz
  and p.local_start_hour=9 and p.local_end_hour=20;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_claim_seller_lookup_for(p_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_seller_controls;l public.icash_seller_intakes;r public.icash_operation_rates;u public.icash_data_cost_settings;parts jsonb;cap bigint;token uuid:=gen_random_uuid();
begin
 select * into c from public.icash_seller_controls where id=1 for update;
 if not c.enabled or c.data_rights_until is null or c.data_rights_until<=now() or length(coalesce(c.review_ref,''))<10 then return null;end if;
 -- An ambiguous lookup is held permanently until an operator reconciles it.
 update public.icash_seller_intakes set state='review',hold_reason='Lookup outcome unknown; do not repeat automatically' where state='checking' and claimed_at<now()-interval '2 minutes';
 select * into r from public.icash_operation_rates where operation='property_search' and enabled and verified_at<=now() and expires_at>now() order by verified_at desc,id limit 1;
 select * into u from public.icash_data_cost_settings where provider='dealmachine';
 if r.id is null or u.credit_micros is null then return null;end if;
 parts:=r.costs_micros||jsonb_build_object('dealmachine',u.credit_micros,'acquisition',0);
 select sum(value::numeric)::bigint into cap from jsonb_each_text(parts);
 if cap<=0 or c.lookup_used_micros+c.lookup_reserved_micros+cap>c.lookup_allowance_micros then return null;end if;
 update public.icash_seller_intakes set state='review',hold_reason='Property state is excluded or needs an exact postal address; no paid research started' where state='received' and (p_id is null or id=p_id) and not public.icash_research_state_allowed(public.icash_address_state(address));
 select * into l from public.icash_seller_intakes where state='received' and (p_id is null or id=p_id) order by created_at,id limit 1 for update skip locked;
 if not found then return null;end if;
 update public.icash_seller_controls set lookup_reserved_micros=lookup_reserved_micros+cap where id=1;
 update public.icash_seller_intakes set state='checking',claim_token=token,claimed_at=now(),lookup_costs=parts,lookup_cap_micros=cap,lookup_cost_basis=u.cost_basis||'; '||u.source_ref||'; non-data allocations: '||r.evidence_ref,data_rights_until=c.data_rights_until where id=l.id;
 return jsonb_build_object('id',l.id,'token',token,'address',l.address,'assignmentFeeCents',c.assignment_fee_cents,'sellerCostReserveCents',c.seller_cost_reserve_cents);
end $function$;
