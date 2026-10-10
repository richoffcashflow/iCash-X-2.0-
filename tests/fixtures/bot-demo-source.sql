-- Exact pre-demo production definitions captured October 10, 2026.
CREATE OR REPLACE FUNCTION public.icash_assign_seller_lead_for(p_lead uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.icash_seller_intakes;a record;parts jsonb;total bigint;charge bigint;rate uuid;op text;screen uuid;evidence text;manifest jsonb;city_name text;state_code text;match_count integer;
begin
 -- Consistent lock order with all other paid operations.
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_seller_controls where id=1 and enabled for share;if not found then return null;end if;
 select * into l from public.icash_seller_intakes where (state in ('qualified','assigned') or (state='numbers_review' and exists(select 1 from public.icash_seller_controls where id=1 and limited_contact_enabled) and result->'financialCheck'->>'status'='hold' and result->'property'->'financialScreening'->>'status' in ('payoff_may_exceed_budget','title_review_needed'))) and (p_lead is null or id=p_lead) and next_assignment_at<=now()
 and (numbers_passed or not exists(select 1 from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id))
 and (select count(*) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<3
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id)<=now()
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=icash_seller_intakes.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations c on c.account_id=sm.account_id and c.screening_id=sm.screening_id join public.icash_contact_suppressions s on s.account_id=c.account_id and s.contact_key=c.contact_key where sm.lead_id=icash_seller_intakes.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=icash_seller_intakes.id)

 and exists(select 1 from public.icash_accounts ac where public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused and not exists(select 1 from public.icash_seller_matches m where m.lead_id=icash_seller_intakes.id and m.account_id=ac.id))
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
 parts:=coalesce(l.customer_costs,l.lookup_costs||jsonb_build_object('acquisition',0));
 if parts is null or jsonb_typeof(parts)<>'object' or nullif(l.lookup_cost_basis,'') is null then return jsonb_build_object('status','research_cost_required');end if;select sum(value::numeric)::bigint into total from jsonb_each_text(parts);charge:=ceil(total::numeric*3/10000);
 if charge<=0 then raise exception 'Positive cost-based lead price required';end if;
 evidence:=coalesce(l.customer_cost_basis,'ESTIMATE: recorded property research and operating allocations; advertising tracked separately; '||l.lookup_cost_basis);
 select count(*) into match_count from public.icash_seller_matches where lead_id=l.id;
 -- Weighted distribution at the same recorded cost-based price;
 -- Preserve deployed any-market allocation; wallet and daily allowance still apply.
 for a in select candidate.* from (select ac.id,(public.icash_daily_allowance(ac.id)->>'remainingCents')::bigint capacity
 from public.icash_accounts ac join public.icash_wallets w on w.account_id=ac.id
 where not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>ac.id) and public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=ac.id)
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
  charge:=ceil(total::numeric*3/10000);
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
   values(a.id,op,jsonb_build_object('propertyId',l.property->>'id','propertyType','house','fetchedAt',l.property->>'fetchedAt','raw',l.property->'raw','sellerCostReserveCents',l.property->'sellerCostReserveCents','sellerRequest',jsonb_build_object('id',l.id,'ownerName',l.name,'phone',l.phone,'aiConsented',l.ai_consented,'consentVersion',l.consent_version,'consentText',l.consent_text,'consentScope',l.contact_consent_scope,'email',l.email,'emailConsented',l.email_consented,'shared',true,'maximumBuyers',3)), 'complete',l.result,l.checked_at) returning id into screen;
   insert into public.icash_seller_matches(lead_id,account_id,screening_id,operation_key,charge_cents) values(l.id,a.id,screen,op,charge);
   -- One immediate user, second after 24 hours, third after 72 hours.
   -- Cap at three distinct users. This never simulates buyers or contact.
   update public.icash_seller_intakes set customer_costs=parts,customer_cost_basis=evidence,state='assigned',assigned_account=coalesce(assigned_account,a.id),screening_id=coalesce(screening_id,screen),operation_key=coalesce(operation_key,op),assigned_at=coalesce(assigned_at,now()),
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


CREATE OR REPLACE FUNCTION public.icash_seller_contact_evidence(p_account uuid, p_screening uuid, p_lead uuid, p_phone text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare l public.icash_seller_intakes;principal text;tz text;expiry timestamptz;binding jsonb;
begin
 select * into l from public.icash_seller_intakes where id=p_lead for share;
 if not found or l.phone is distinct from p_phone or not l.ai_consented or l.state<>'assigned'
  or l.consent_version is distinct from 'homeoffer-seller-contact-2026-10-05.4'
  or l.contact_consent_scope is distinct from 'homeoffer_network_and_matched_buyers'
  or l.consent_text is distinct from 'I agree to marketing calls, texts and emails about my property from HomeOffer Network and its matched buyers, including automated texts and AI-generated voice calls. Consent is not a condition of buying or selling. Message/data rates may apply. Reply STOP to texts or unsubscribe from emails.'
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
