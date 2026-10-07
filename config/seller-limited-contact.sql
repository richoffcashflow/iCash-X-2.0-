begin;
alter table public.icash_seller_controls add column if not exists limited_contact_enabled boolean not null default false;
-- Mortgage-review leads remain financially ineligible. One bounded contact window only.
create or replace function public.icash_seller_limited_contact(p_account uuid,p_screening uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_seller_matches m join public.icash_seller_intakes l on l.id=m.lead_id join public.icash_screening_jobs s on s.id=m.screening_id and s.account_id=m.account_id
 where exists(select 1 from public.icash_seller_controls where id=1 and limited_contact_enabled) and m.account_id=p_account and m.screening_id=p_screening and l.state='assigned' and l.ai_consented and s.state='complete'
 and m.assigned_at between now()-interval '24 hours' and now() and s.completed_at between now()-interval '24 hours' and now()
 and s.snapshot->'sellerRequest'->>'id'=l.id::text and s.result->'financialCheck'->>'status'='hold'
 and s.result->'property'->'financialScreening'->>'status'='payoff_may_exceed_budget'
 and coalesce((s.result->>'offerAuthorized')::boolean,false)=false);
$$;
create or replace function public.icash_limited_seller_voice(p_account uuid,p_operation text) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_voice_jobs j join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id
 where j.account_id=p_account and 'voice:'||j.id=p_operation and j.callback_id is null and j.state in ('ready','issued','dispatching')
 and p.party='seller' and public.icash_seller_voice_permission_current(p_account,p.id) and public.icash_seller_limited_contact(p_account,p.screening_id));
$$;
create or replace function public.icash_claim_limited_seller_voice(p_job uuid,p_snapshot jsonb) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.icash_voice_jobs;
begin
 select * into j from public.icash_voice_jobs where id=p_job for update;
 if not found or not public.icash_limited_seller_voice(j.account_id,'voice:'||j.id) then return false;end if;
 if not exists(select 1 from public.icash_contact_permissions p join public.icash_screening_jobs s on s.id=p.screening_id and s.account_id=p.account_id where p.id=j.permission_id and s.snapshot=p_snapshot) then return false;end if;
 return public.icash_claim_reviewed_voice_job(p_job,null,null);
end $$;
revoke all on function public.icash_seller_limited_contact(uuid,uuid),public.icash_limited_seller_voice(uuid,text),public.icash_claim_limited_seller_voice(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_seller_limited_contact(uuid,uuid),public.icash_limited_seller_voice(uuid,text),public.icash_claim_limited_seller_voice(uuid,jsonb) to service_role;
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
 select * into l from public.icash_seller_intakes where (state in ('qualified','assigned') or (state='numbers_review' and exists(select 1 from public.icash_seller_controls where id=1 and limited_contact_enabled) and result->'financialCheck'->>'status'='hold' and result->'property'->'financialScreening'->>'status'='payoff_may_exceed_budget')) and (p_lead is null or id=p_lead) and next_assignment_at<=now()
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
 -- eligibility remains bounded by wallet AND rolling daily usage.
 for a in select candidate.* from (select ac.id,least(w.balance_cents-w.reserved_cents,ac.daily_limit_cents-w.reserved_cents-coalesce((select sum(-delta_cents) from public.icash_credit_ledger where account_id=ac.id and kind='usage' and created_at>now()-interval '24 hours'),0)) capacity
 from public.icash_accounts ac join public.icash_wallets w on w.account_id=ac.id
 where not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>ac.id) and public.icash_credit_acquisition_allowed(ac.id) and not ac.bot_paused and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=ac.id)
 and not exists(select 1 from public.icash_billing_reviews where account_id=ac.id and resolved_at is null)
 ) candidate where capacity>=charge
 -- Larger available budgets receive more opportunities; a square-root weight
 -- keeps smaller funded accounts competitive. First access rotates separately.
 order by
 case when exists(select 1 from public.icash_seller_matches m where m.account_id=candidate.id and m.assigned_at>now()-interval '24 hours') then 1 else 0 end,
 (case when match_count=0 then (select count(*) from public.icash_seller_intakes i where i.assigned_account=candidate.id and i.assigned_at>now()-interval '7 days') else (select count(*) from public.icash_seller_matches m where m.account_id=candidate.id and m.assigned_at>now()-interval '7 days') end + 1)
 /power(greatest(candidate.capacity,charge)::numeric/charge,0.75) / public.icash_hybrid_inbound_share((select daily_limit_cents from public.icash_accounts where id=candidate.id))
 / (1+least(7,greatest(0,extract(epoch from(now()-coalesce((select max(m.assigned_at) from public.icash_seller_matches m where m.account_id=candidate.id),now()-interval '7 days')))/86400))),
 (select count(*) from public.icash_seller_matches m where m.account_id=candidate.id and m.assigned_at>now()-interval '7 days'),
 capacity desc,candidate.id limit 50 loop
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
end $function$
;
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
 if p_permission_until is null or p_permission_until<=now() then raise exception 'Permission expired'; end if;
 if r.operation='seller_call' and not public.icash_limited_seller_voice(p_account,p_operation) and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
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
 -- Protect 20% of daily credits from new search spending while follow-up work exists.
 if r.operation='property_search' and (
 exists(select 1 from public.icash_voice_jobs where account_id=p_account and callback_id is not null and state in ('ready','issued','dispatching','dispatched'))
 or exists(select 1 from public.icash_deal_files where account_id=p_account and stage in ('under_contract','buyer_selected','title_open','closing'))
 ) then
 perform 1 from public.icash_accounts where id=p_account for update;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 if (select w.balance_cents-w.reserved_cents-r.charge_cents<ceil(a.daily_limit_cents*0.20) from public.icash_wallets w join public.icash_accounts a on a.id=w.account_id where w.account_id=p_account)
 then raise exception 'Credits protected for active deals and callbacks'; end if;
 end if;
 cr:=public.icash_reserve_credit(p_account,p_operation,r.charge_cents);
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,financial_checked_at)
 values(p_operation,p_account,p_rate,cr,r.charge_cents,held,p_permission_until,p_financial_checked_at);
 update public.icash_operation_spend set standard_cost_multiplier=b.standard_cost_multiplier,elevenlabs_cost_multiplier=b.elevenlabs_cost_multiplier,required_revenue_micros=required where operation_key=p_operation;
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
end $function$
;
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
 insert into public.icash_voice_jobs(account_id,permission_id)
 select p.account_id,p.id from public.icash_contact_permissions p join public.icash_voice_configs c on c.account_id=p.account_id and c.enabled and c.buyer_rate_id is not null
 join public.icash_accounts a on a.id=p.account_id and not a.bot_paused
 where public.icash_outreach_voice_current(p.account_id) and p.party='buyer' and public.icash_buyer_voice_context(p.id) is not null
 and not exists(select 1 from public.icash_voice_jobs v where v.permission_id=p.id and v.callback_id is null)
 order by p.id limit 5 on conflict do nothing;
 insert into public.icash_voice_jobs(account_id,permission_id,callback_id,due_at)
 select b.account_id,p.id,b.id,b.due_at from public.icash_live_callbacks b join public.icash_live_conversations c on c.id=b.conversation_id join public.icash_contact_permissions p on p.account_id=b.account_id and p.screening_id=b.screening_id and p.contact_key=c.contact_key and p.party=c.party
 where public.icash_outreach_voice_current(b.account_id) and c.state='complete' and (c.result->>'callbackDueAt')::timestamptz=b.due_at and b.state='pending_dispatch_review' and b.due_at>now()-interval '15 minutes' and p.revoked_at is null and p.permission_until>b.due_at and not exists(select 1 from public.icash_voice_jobs v where v.callback_id=b.id) limit 100 on conflict do nothing;
 update public.icash_voice_jobs set state='held',outcome='Callback time passed; review required' where state='ready' and callback_id is not null and due_at<now()-interval '15 minutes';
 update public.icash_live_callbacks b set state='missed' where state='pending_dispatch_review' and due_at<now()-interval '15 minutes';
 -- An expired one-use ticket may be issued again only before provider dispatch was claimed.
 update public.icash_voice_jobs set state='ready' where state='issued' and updated_at<now()-interval '5 minutes';
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_text_before_owner_question(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare invitation public.icash_sms_inbound_invitations;t public.icash_text_threads;m public.icash_text_messages;d public.icash_deal_files;s public.icash_screening_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select th.* into t from public.icash_text_threads th join public.icash_text_messages msg on msg.thread_id=th.id and msg.account_id=th.account_id where msg.id=p_message and msg.account_id=p_account;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return null;end if;
 perform 1 from public.icash_outreach_campaigns where account_id=p_account for share;
 select * into t from public.icash_text_threads where id=t.id and account_id=p_account for update;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=t.id for update;
 if not found or m.state<>'ready' or m.direction<>'outgoing' then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete' for share;
 if not found then return null;end if;
 if t.party='buyer' then
  if public.icash_buyer_package_data(p_account,d.id) is null then return null;end if;
 else if not public.icash_customer_authored_text(p_account,p_message) and not (public.icash_seller_limited_contact(p_account,s.id) and (exists(select 1 from public.icash_sms_seller_openings opening where opening.thread_id=t.id and opening.owner_question_id=m.id) or m.body='Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?')) and (s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours') then return null;end if; end if;

 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
 and not (
  (public.icash_manual_handoff_reply(p_account,t.id) or public.icash_customer_authored_text(p_account,p_message))
  and not exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account)
  and not exists(select 1 from public.icash_seller_opener_assignments where message_id=p_message and account_id=p_account)
  and not exists(select 1 from public.icash_sms_inbound_invitations where message_id=p_message and account_id=p_account)
 ) then return null;end if;
 if exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account) then return null;end if;
 if t.dnc_checked_at>now() then return null;end if;
 if not public.icash_sms_thread_review_current(p_account,t.id,true) then return null;end if;
 if not public.icash_outreach_sms_current(p_account) then return null;end if;
 select * into invitation from public.icash_sms_inbound_invitations where message_id=p_message and account_id=p_account;
 if found then
  if not public.icash_sms_inbound_campaign_current(p_account) then return null;end if;
  select * into t from public.icash_text_threads where id=invitation.thread_id and account_id=p_account;
  if t.id is null or t.sender<>invitation.sender or t.recipient<>invitation.recipient or t.deal_id<>invitation.deal_id or invitation.expires_at<=now() then return null;end if;
  if not exists(select 1 from public.icash_inbound_voice_routes where called_number=invitation.called_number and business_number=p_sender and enabled and reviewed_until>now() and agent_config_hash is not null) then return null;end if;
  if exists(select 1 from public.icash_text_messages where thread_id=t.id and direction='incoming' and id<>invitation.reply_id and created_at>=(select created_at from public.icash_text_messages where id=invitation.reply_id)) then return null;end if;
 end if;
 return public.icash_claim_text_before_campaign(p_account,p_message,p_sender);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_text_property_context(p_account uuid, p_thread uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare prop jsonb;ceiling bigint; fetched timestamptz;t public.icash_text_threads;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or t.party<>'seller' then return null;end if;
 if exists(select 1 from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account and d.terms->>'practice'='true') then
 select c.result->'property',greatest(0,(c.result->'property'->>'screeningBuyerCeilingCents')::bigint-b.assignment_fee_cents)
 into prop,ceiling from public.icash_text_property_checks b join public.icash_property_checks c on c.id=b.check_id and c.account_id=b.account_id
 where b.thread_id=p_thread and b.account_id=p_account and c.state='complete' and c.result->>'addressMatched'='true';
 else
 select s.result->'property',(s.result->>'preliminarySellerCeilingCents')::bigint into prop,ceiling
 from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id and s.state='complete'
 where d.id=t.deal_id and d.account_id=p_account and d.stage='draft';
 end if;
 fetched:=(prop->>'fetchedAt')::timestamptz;
 if prop is null or fetched is null or fetched>now() or fetched<now()-interval '24 hours' then return null;end if;
 if exists(select 1 from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account and public.icash_seller_limited_contact(p_account,d.screening_id)) then return jsonb_build_object('address',prop->>'address','fetchedAt',fetched,'ceilingCents',null,'titleReview',true,'contactOnly',true);end if;
 return jsonb_build_object('address',prop->>'address','fetchedAt',fetched,'ceilingCents',ceiling,'titleReview',coalesce(prop->'financialScreening'->>'status'='title_review_needed',false));
end $function$

;
commit;

