-- Usage authorizations remain immutable/idempotent; they no longer withhold wallet credits.
-- Provider-cost ceilings and operation bindings remain intact.
begin;
set local lock_timeout='5s';
create table public.icash_usage_coverage (
 operation_key text primary key references public.icash_credit_reservations(operation_key),
 account_id uuid not null references public.icash_accounts(id),
 gross_cents bigint not null check(gross_cents>0),
 customer_cents bigint not null check(customer_cents>=0),
 covered_cents bigint not null check(covered_cents>0),
 evidence_ref text not null check(length(trim(evidence_ref))>0),
 created_at timestamptz not null default now(),
 check(gross_cents=customer_cents+covered_cents)
);
alter table public.icash_usage_coverage enable row level security;
revoke all on public.icash_usage_coverage from public,anon,authenticated,service_role;
grant select,insert on public.icash_usage_coverage to service_role;
-- Releasing authorizations is not a refund or a settlement. Historical provider
-- receipts and amounts are unchanged; actual costs still reconcile once.
do $$ begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 update public.icash_wallets set reserved_cents=0 where reserved_cents>0;
end $$;

CREATE OR REPLACE FUNCTION public.icash_reserve_credit(p_account uuid, p_operation text, p_amount bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.icash_wallets; r public.icash_credit_reservations; a public.icash_accounts; used bigint; result uuid; allowance jsonb;
begin
 if p_operation is null or trim(p_operation)='' or p_amount is null or p_amount<=0 then raise exception 'Invalid reservation'; end if;
 select * into a from public.icash_accounts where id=p_account for update;
 if not found then raise exception 'Account missing'; end if;
 if not public.icash_membership_work_allowed(p_account) then raise exception 'Software membership is inactive';end if;
 select * into w from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where operation_key=p_operation;
 if found then
  if r.account_id<>p_account or r.amount_cents<>p_amount then raise exception 'Idempotency conflict'; end if;
  if r.status<>'reserved' then raise exception 'Operation already resolved'; end if;
  if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) and not public.icash_customer_text_operation(p_account,p_operation) and not exists(select 1 from public.icash_question_usage q where q.account_id=p_account and 'question:'||q.question_id=p_operation and q.state='reserved' and p_amount=5) then raise exception 'Bot paused'; end if;
  return r.id;
 end if;
 if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) and not public.icash_customer_text_operation(p_account,p_operation) and not exists(select 1 from public.icash_question_usage q where q.account_id=p_account and 'question:'||q.question_id=p_operation and q.state='reserved' and p_amount=5) then raise exception 'Bot paused'; end if;
 if w.balance_cents<=0 then raise exception 'Insufficient credits'; end if;
 -- This row is an idempotent usage authorization, not a wallet hold.
 -- The work planner chooses affordable work; actual usage is deducted once.
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents)
 values(p_account,p_operation,p_amount) returning id into result;

 return result;
end; $function$;

CREATE OR REPLACE FUNCTION public.icash_finish_credit(p_account uuid, p_operation text, p_charge bigint, p_evidence text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.icash_credit_reservations; desired text; available bigint; covered bigint;
begin
 if p_charge is null or p_charge<0 or p_evidence is null or trim(p_evidence)='' then raise exception 'Invalid settlement'; end if;
 select balance_cents into available from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where account_id=p_account and operation_key=p_operation for update;
 if not found then raise exception 'Reservation missing'; end if;
 desired:=case when p_charge=0 then 'released' else 'settled' end;
 if r.status<>'reserved' then
  if r.status=desired and coalesce(r.settled_cents,0)=p_charge then return r.status; end if;
  raise exception 'Settlement conflict';
 end if;
 if p_charge>r.amount_cents then raise exception 'Charge exceeds reservation'; end if;
 -- Concurrent completed work may consume the last credits before this receipt.
 -- Record platform-covered overrun explicitly; never debit below zero or retry a charge.
 covered:=greatest(0,p_charge-available);
 if covered>0 then
  insert into public.icash_usage_coverage(account_id,operation_key,gross_cents,customer_cents,covered_cents,evidence_ref)
  values(p_account,p_operation,p_charge,p_charge-covered,covered,p_evidence);
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,'usage-coverage:'||p_operation,'grant',covered,'Platform-covered concurrent usage; no customer debt: '||p_evidence);
 end if;
 if p_charge>0 then
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,'usage:'||p_operation,'usage',-p_charge,p_evidence);
 end if;
 update public.icash_wallets set balance_cents=balance_cents+covered-p_charge,reserved_cents=0 where account_id=p_account;
 update public.icash_credit_reservations set status=desired,settled_cents=case when p_charge>0 then p_charge else null end where id=r.id;
 return desired;
end; $function$;

create or replace function public.icash_daily_allowance(p_account uuid)
returns jsonb language plpgsql set search_path='' as $$
declare w public.icash_wallets;spent bigint;day_start timestamptz;
begin
 select * into strict w from public.icash_wallets where account_id=p_account;
 day_start:=public.icash_spending_day()::timestamp at time zone 'America/Chicago';
 select coalesce(-sum(delta_cents),0) into spent from public.icash_credit_ledger
 where account_id=p_account and created_at>=day_start and (kind='usage' or event_key like 'usage-coverage:%');
 return jsonb_build_object('mode','available_balance','day',public.icash_spending_day(),'timezone','America/Chicago',
 'openingCents',w.balance_cents+spent,'limitCents',w.balance_cents+spent,'spentCents',spent,
 'reservedCents',0,'remainingCents',w.balance_cents,'availableCents',w.balance_cents,'extraCents',0,
 'resetsAt',(public.icash_spending_day()+1)::timestamp at time zone 'America/Chicago');
end $$;
CREATE OR REPLACE FUNCTION public.icash_reserve_before_membership(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cap bigint;used numeric;charge bigint;b public.icash_operating_budget;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.require_company_reserve then
 select customer_cap_cents into cap from public.icash_spend_activations where account_id=p_account and enabled;
 if cap is null or not exists(select 1 from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null) then raise exception 'Account spending not activated';end if;
 -- A paid, enabled account spends its current balance; no lifetime spending cap.
 end if;
 return public.icash_reserve_before_activation(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
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
 if r.operation='seller_call' and not public.icash_limited_seller_voice(p_account,p_operation) and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=b.standard_cost_multiplier;end if;
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

CREATE OR REPLACE FUNCTION public.icash_claim_operation(p_operation text)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare a uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select account_id into a from public.icash_operation_spend where operation_key=p_operation;
 if not public.icash_membership_work_allowed(a) then return false;end if;
 perform 1 from public.icash_wallets where account_id=a and balance_cents>0 for update;
 if not found then return false;end if;
 return public.icash_claim_before_membership(p_operation);
end $function$;

CREATE OR REPLACE FUNCTION public.icash_manual_text_reason(p_account uuid, p_thread uuid, p_exclude uuid DEFAULT NULL::uuid)
 RETURNS text
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;screening uuid;reason text;charge bigint;available bigint;cap bigint;used bigint;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found then return 'Conversation unavailable.';end if;
 select screening_id into screening from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 reason:=public.icash_manual_contact_reason(p_account,screening,t.recipient,'sms',p_exclude);
 if reason is not null then return reason;end if;
 if not exists(select 1 from public.icash_text_senders where phone=t.sender and enabled) then return 'Business texting number is unavailable.';end if;
 select greatest(r.charge_cents,ceil(p.customer_micros::numeric/10000)::bigint) into charge from public.icash_operation_rates r cross join public.icash_communication_prices p where r.id=t.sms_rate_id and r.enabled and r.expires_at>now() and r.operation='sms_send' and p.operation='sms_segment';
 if charge is null then return 'Texting setup needs a rate refresh. Your draft is saved.';end if;
 if not public.icash_membership_work_allowed(p_account) then return 'Update your subscription to send texts.';end if;
 select balance_cents-reserved_cents into available from public.icash_wallets where account_id=p_account;
 if coalesce(available,0)<charge then return 'Add credits to send. Your draft is saved.';end if;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_next_work(p_account uuid)
 RETURNS TABLE(candidate_id uuid, action text, deal_id uuid, charge_cents bigint, reason text)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with cfg as (
 select settings from icash_private.engine_configs where engine='deal' and enabled
 ), funding as (
 select a.id,a.daily_limit_cents,w.balance_cents-w.reserved_cents as available,
 w.balance_cents as remaining
 from public.icash_accounts a join public.icash_wallets w on w.account_id=a.id
 where a.id=p_account and not a.bot_paused
 )
 select c.id,c.action,c.deal_id,c.estimated_charge_cents,
 case when c.deadline_at<=now()+interval '48 hours' then 'Contract deadline'
 when d.seller_signed_at is not null then 'Protect active contract'
 when c.action='seller_callback' then 'Honor seller callback'
 else 'Verified opportunity within budget' end
 from icash_private.work_candidates c
 join public.icash_deals d on d.account_id=c.account_id and d.id=c.deal_id
 join funding f on f.id=c.account_id cross join cfg
 where c.status='pending' and c.due_at<=now() and c.permission_verified_until>now()
 and d.stage not in ('closed','stopped') and not d.needs_user
 and c.estimated_charge_cents<=least(f.available,f.remaining)
 and (c.action<>'prospect' or not exists (
 select 1 from icash_private.work_candidates urgent
 join public.icash_deals active on active.account_id=urgent.account_id and active.id=urgent.deal_id
 where urgent.account_id=c.account_id and urgent.status='pending' and active.seller_signed_at is not null
 and active.stage not in ('closed','stopped') and urgent.due_at<=now()+interval '48 hours'
 ))
 and (c.estimated_charge_cents/100.0-c.estimated_provider_cost_usd)/(c.estimated_charge_cents/100.0)
 >= coalesce((cfg.settings->>'minimum_gross_margin')::numeric,1)
 order by (c.deadline_at<=now()+interval '48 hours') desc nulls last,
 (d.seller_signed_at is not null) desc,
 (c.action='seller_callback') desc,
 c.deadline_at asc nulls last,c.quality_score desc,c.due_at,c.id
 limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.icash_research_purchase_allowed(p_account uuid, p_operation text, p_rate uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
 declare r public.icash_operation_rates;a public.icash_accounts;p public.icash_acquisition_policy;spent bigint;screen public.icash_screening_jobs;
 begin
  select * into r from public.icash_operation_rates where id=p_rate;
  if not found then return false;end if;
  if r.operation not in ('property_search','owner_enrichment') then return true;end if;
  select * into p from public.icash_acquisition_policy where id=1;
  if not found or p.mode='inbound' then return false;end if;
  select * into a from public.icash_accounts where id=p_account;
  if not found or a.bot_paused or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>0) then return false;end if;
  if r.operation='owner_enrichment' then
   select * into screen from public.icash_screening_jobs where account_id=p_account and 'owners:'||p_account||':'||id=p_operation;
   if not found or screen.snapshot->'sellerRequest' is not null or not public.icash_research_state_allowed(screen.snapshot->'raw'->'data'->>'state') then return false;end if;
   if exists(select 1 from public.icash_outbound_property_owners where property_id=screen.snapshot->>'propertyId' and account_id<>p_account) then return false;end if;
  elsif not exists(select 1 from public.icash_discovery_configs where account_id=p_account and public.icash_research_zip_known(zip)) then return false;
  end if;
  return true;
 end $function$;

CREATE OR REPLACE FUNCTION public.icash_outbound_search_due(p_account uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare a public.icash_accounts;c public.icash_discovery_configs;policy public.icash_acquisition_policy;capacity bigint;research_spend bigint;cost bigint;target integer;inbound_count integer;outbound_count integer;profile jsonb;
begin
 select * into policy from public.icash_acquisition_policy where id=1;
 if not found or policy.mode='inbound' then return false;end if;
 select * into a from public.icash_accounts where id=p_account;
 if not found or a.bot_paused then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 if not found or not c.enabled or not c.auto_enabled or c.exhausted or c.data_rights_until<=now() or not public.icash_research_zip_known(c.zip) then return false;end if;
 if exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null) then return false;end if;
 select charge_cents into cost from public.icash_operation_rates where id=c.rate_id and enabled and expires_at>now() and operation='property_search';
 if cost is null then return false;end if;
 select w.balance_cents into capacity from public.icash_wallets w where account_id=p_account;
 if capacity is null or capacity<cost then return false;end if;
 if exists(select 1 from public.icash_screening_jobs s where s.account_id=p_account and s.state in ('queued','running') and s.created_at>now()-interval '1 day') then return false;end if;
 if policy.mode='outbound' then return true;end if;
 select bs.profile into profile from public.icash_bot_setups bs where account_id=p_account;
 -- Let an affordable, due inbound request be delivered before buying a page.
 if public.icash_credit_acquisition_allowed(p_account) and exists(select 1 from public.icash_seller_intakes l where l.state in ('qualified','assigned') and l.next_assignment_at<=now() and l.data_rights_until>now() and l.checked_at>now()-interval '8 days'
 and public.icash_research_state_allowed(l.property->>'state') and (profile->>'marketMode'='nationwide' or lower(trim(profile->>'market')) in (lower(l.property->>'city'),lower(l.property->>'city')||', '||lower(l.property->>'state'),l.property->>'zip'))
 and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=p_account)
 and (select count(*) from public.icash_seller_matches m where m.lead_id=l.id)<3
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=l.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations lc on lc.account_id=sm.account_id and lc.screening_id=sm.screening_id join public.icash_contact_suppressions cs on cs.account_id=lc.account_id and cs.contact_key=lc.contact_key where sm.lead_id=l.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=l.id)
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=l.id)<=now()
 and not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>p_account)
 and ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,l.lookup_costs)))*3/10000)<=capacity) then return false;end if;
 target:=least(20,greatest(2,ceil(capacity::numeric/1000)::integer));
 select count(*) into inbound_count from public.icash_seller_matches where account_id=p_account and assigned_at>now()-interval '24 hours';
 select count(*) into outbound_count from public.icash_screening_jobs where account_id=p_account and state='complete' and completed_at>now()-interval '24 hours' and event_key like 'discovery:%' and result->'financialCheck'->>'status'='eligible';
 -- Refill a real shortfall. Never buy filler merely to create a daily charge.
 return inbound_count+outbound_count<target and outbound_count<case when inbound_count>=ceil(target*public.icash_hybrid_inbound_share(a.daily_limit_cents)) then ceil(target*(1-public.icash_hybrid_inbound_share(a.daily_limit_cents))) else greatest(1,target-inbound_count) end;
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
 if coalesce(capacity,0)<=0 then return null;end if;
 if public.icash_vip_active(p_account) then b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;end if;
 for seconds in reverse (case when public.icash_seller_limited_contact(p_account,p.screening_id) then 120 else 600 end)..120 by 60 loop
  parts:=public.icash_voice_bounded_costs(r.costs_micros,seconds);
  select sum(value::numeric) into total from jsonb_each_text(parts);
  price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
  if price<=capacity or seconds=120 then
   insert into public.icash_voice_credit_bounds(operation_key,account_id,rate_id,max_seconds,charge_cents,costs_micros) values(operation,p_account,p_rate,seconds,price,parts);
   if public.icash_reserve_paced_voice(p_account,p_job,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible) then return jsonb_build_object('maxSeconds',seconds,'reservedCents',price);end if;
   delete from public.icash_voice_credit_bounds where operation_key=operation;
   return null;
  end if;
 end loop;
 update public.icash_voice_jobs set state='ready',due_at=now()+interval '1 minute',outcome='Add credits to continue calling',updated_at=now() where id=p_job;
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

 if j.operational_contact_id is not null then
  if not public.icash_operational_contact_current(p_account,j.operational_contact_id,'voice',true)
   or not public.icash_claim_inventory(p_account,p.screening_id,p.phone) then return false;end if;
  p_permission_until:=least(p_permission_until,p.permission_until);
 end if;
 perform public.icash_reserve_operation(p_account,'voice:'||j.id,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
 return true;
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
 if public.icash_vip_active(c.account_id) then b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;end if;
 begin
  funded_seconds:=c.max_total_seconds;funded_price:=c.charge_cap_cents;funded_costs:=r.costs_micros;
  if c.call_profile='normal' and c.max_total_seconds=600 then
   capacity:=(public.icash_daily_allowance(c.account_id)->>'remainingCents')::bigint;
   if coalesce(capacity,0)<=0 then return jsonb_build_object('allowed',false,'reason','credits_exhausted');end if;
   if capacity<c.charge_cap_cents or public.icash_vip_active(c.account_id) then
    funded_seconds:=null;
    for seconds in reverse 600..120 by 60 loop
     -- Preserve fixed/recording estimates. Round carrier time up by one minute.
     parts:=public.icash_voice_bounded_costs(r.costs_micros,seconds);
     select sum(value::numeric) into total from jsonb_each_text(parts);
     price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
     if price>0 and price<=c.charge_cap_cents and (price<=capacity or seconds=120) then
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
  insert into icash_recorded_reception_private.sessions(entry_policy,cost_policy_id,cost_policy_snapshot,configuration,config_id,account_id,operation_key,provider_account_sid,call_sid,direction,from_phone,to_phone,caller_hash,contact_key,config_hash,agent_id,branch_id,version_id,call_profile,rate_id,rate_snapshot,reserved_micros,charge_cap_cents,max_total_seconds,standard_cost_multiplier,elevenlabs_cost_multiplier,nonce_hash,stop_token_hash,disclosure_version,pricing_policy,created_at,updated_at,call_deadline_at,consent_deadline_at,next_reconcile_at)
  values('direct_recorded_v1',c.cost_policy_id,c.cost_policy_snapshot,icash_recorded_reception_private.config_json(c),c.id,c.account_id,op,p_provider_account_sid,p_call_sid,p_direction,p_from_phone,p_to_phone,p_caller_hash,encode(sha256(convert_to(p_from_phone,'UTF8')),'hex'),c.config_hash,c.agent_id,c.branch_id,c.version_id,c.call_profile,c.rate_id,c.rate_snapshot,o.reserved_micros,funded_price,funded_seconds,o.standard_cost_multiplier,o.elevenlabs_cost_multiplier,p_nonce_hash,p_stop_token_hash,c.disclosure_version,c.pricing_policy,t,t,t+interval '60 seconds',t+interval '60 seconds',t+interval '30 seconds') returning * into s;
 exception when raise_exception or check_violation or unique_violation or no_data_found then return jsonb_build_object('allowed',false,'reason','customer_funding_denied');end;
 return jsonb_build_object('allowed',true,'reason','reserved','session',to_jsonb(s));
end $function$;

CREATE OR REPLACE FUNCTION public.icash_reserve_flexible_reception(p_config_id uuid, p_call_sid text, p_provider_account_sid text, p_from_phone text, p_to_phone text, p_direction text, p_caller_hash text, p_nonce_hash text, p_stop_token_hash text, p_config_hash text, p_version_id text)
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
 if public.icash_vip_active(c.account_id) then b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;end if;
 begin
  funded_seconds:=c.max_total_seconds;funded_price:=c.charge_cap_cents;funded_costs:=r.costs_micros;
  if c.call_profile='normal' and c.max_total_seconds=600 then
   capacity:=(public.icash_daily_allowance(c.account_id)->>'remainingCents')::bigint;
   if coalesce(capacity,0)<=0 then return jsonb_build_object('allowed',false,'reason','credits_exhausted');end if;
   if capacity<c.charge_cap_cents or public.icash_vip_active(c.account_id) then
    funded_seconds:=null;
    for seconds in reverse 600..120 by 60 loop
     -- Preserve fixed/recording estimates. Round carrier time up by one minute.
     parts:=public.icash_voice_bounded_costs(r.costs_micros,seconds);
     select sum(value::numeric) into total from jsonb_each_text(parts);
     price:=ceil((total*b.standard_cost_multiplier-(parts->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier))*(10000+r.buffer_bps)/100000000);
     if price>0 and price<=c.charge_cap_cents and (price<=capacity or seconds=120) then
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
  insert into icash_recorded_reception_private.sessions(cost_policy_id,cost_policy_snapshot,configuration,config_id,account_id,operation_key,provider_account_sid,call_sid,direction,from_phone,to_phone,caller_hash,contact_key,config_hash,agent_id,branch_id,version_id,call_profile,rate_id,rate_snapshot,reserved_micros,charge_cap_cents,max_total_seconds,standard_cost_multiplier,elevenlabs_cost_multiplier,nonce_hash,stop_token_hash,disclosure_version,pricing_policy,created_at,updated_at,call_deadline_at,consent_deadline_at,next_reconcile_at)
  values(c.cost_policy_id,c.cost_policy_snapshot,icash_recorded_reception_private.config_json(c),c.id,c.account_id,op,p_provider_account_sid,p_call_sid,p_direction,p_from_phone,p_to_phone,p_caller_hash,encode(sha256(convert_to(p_from_phone,'UTF8')),'hex'),c.config_hash,c.agent_id,c.branch_id,c.version_id,c.call_profile,c.rate_id,c.rate_snapshot,o.reserved_micros,funded_price,funded_seconds,o.standard_cost_multiplier,o.elevenlabs_cost_multiplier,p_nonce_hash,p_stop_token_hash,c.disclosure_version,c.pricing_policy,t,t,t+interval '60 seconds',t+interval '60 seconds',t+interval '30 seconds') returning * into s;
 exception when raise_exception or check_violation or unique_violation or no_data_found then return jsonb_build_object('allowed',false,'reason','customer_funding_denied');end;
 return jsonb_build_object('allowed',true,'reason','reserved','session',to_jsonb(s));
end $function$;

create function public.icash_call_credit_available(p_account uuid,p_operation text)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_operation_spend o join public.icash_wallets w on w.account_id=o.account_id
 where o.account_id=p_account and o.operation_key=p_operation and o.state='dispatched' and w.balance_cents>0)
$$;
revoke all on function public.icash_call_credit_available(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_call_credit_available(uuid,text) to service_role;
CREATE OR REPLACE FUNCTION public.icash_seller_demand_summary()
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with active as (
 select ac.id,w.balance_cents capacity
 from public.icash_accounts ac join public.icash_wallets w on w.account_id=ac.id
 where public.icash_credit_acquisition_allowed(ac.id)
 and not exists(select 1 from public.icash_billing_reviews b where b.account_id=ac.id and b.resolved_at is null)
 ), mature as (
 select i.id,(select count(*) from public.icash_seller_matches m where m.lead_id=i.id) deliveries
 from public.icash_seller_intakes i where i.market_qualified and i.created_at between now()-interval '38 days' and now()-interval '8 days'
 ), due as (
 select i.id from public.icash_seller_intakes i where i.state in ('qualified','assigned') and i.next_assignment_at<now()+interval '24 hours'
 and i.checked_at>now()-interval '8 days' and i.data_rights_until>now()
 and (select case when count(*)=0 then now() else public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) end from public.icash_seller_matches m where m.lead_id=i.id)<now()+interval '24 hours'
 and (select count(*) from public.icash_seller_matches m where m.lead_id=i.id)<3
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=i.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations c on c.account_id=sm.account_id and c.screening_id=sm.screening_id join public.icash_contact_suppressions s on s.account_id=c.account_id and s.contact_key=c.contact_key where sm.lead_id=i.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=i.id)
 )
 select jsonb_build_object(
 'activeAccounts',(select count(*) from active),
 'budgetAvailableAccounts',(select count(*) from active where capacity>0),
 'accountsWithoutLead24h',(select count(*) from active a where not exists(select 1 from public.icash_seller_matches m where m.account_id=a.id and m.assigned_at>now()-interval '24 hours')),
 'deliveries24h',(select count(*) from public.icash_seller_matches where assigned_at>now()-interval '24 hours'),
 'deliveries7d',(select count(*) from public.icash_seller_matches where assigned_at>now()-interval '7 days'),
 'qualified7d',(select count(*) from public.icash_seller_intakes where market_qualified and created_at>now()-interval '7 days'),
 'requests7d',(select count(*) from public.icash_seller_intakes where state<>'duplicate' and created_at>now()-interval '7 days'),
 'scheduledLeads24h',(select count(*) from due),
 'matureLeads',(select count(*) from mature),
 'observedRecipientsPerLead',(select avg(deliveries) from mature)
 )
$function$;
;

CREATE OR REPLACE FUNCTION public.icash_arm_owner_inbound_acceptance(p_account uuid, p_user uuid, p_config uuid, p_hash text, p_version text, p_expected jsonb, p_challenge_salt text, p_challenge_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_owner_inbound_acceptance_config;r public.icash_owner_inbound_acceptance_runs;a public.icash_accounts;w public.icash_wallets;used numeric;cr uuid;rid uuid:=gen_random_uuid();op text;
begin
 select * into c from public.icash_owner_inbound_acceptance_config where id=p_config and account_id=p_account and owner_user_id=p_user for update;
 if not found or not c.enabled or not c.all_in_cost_reviewed or not c.forwarding_no_incremental_cost or not c.provider_extras_disabled or c.expires_at<=now() or c.rate_reviewed_at>now() or c.rate_expires_at<=least(now()+interval '5 minutes',c.expires_at)+interval '60 seconds'
  or c.reviewed_config_hash is distinct from p_hash or c.reviewed_version_id is distinct from p_version
  or p_expected is null or to_jsonb(c) is distinct from p_expected then return null;end if;
 if p_challenge_salt is null or p_challenge_salt !~ '^[a-f0-9]{64}$' or p_challenge_hash is null or p_challenge_hash !~ '^[a-f0-9]{64}$' then return null;end if;
 if exists(select 1 from public.icash_owner_inbound_acceptance_runs where config_id=c.id) then return null;end if;
 -- Serialize wallet admission with the existing credit reservation path. The
 -- owner-only test is allowed while business work stays paused; budget is not.
 select * into a from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then return null;end if;
 if exists(select 1 from public.icash_owner_inbound_acceptance_runs where account_id=p_account and settled_at is null) then return null;end if;
 select * into w from public.icash_wallets where account_id=p_account for update;
 if not found or w.currency<>'USD' then raise exception 'Owner inbound wallet missing';end if;
 if w.balance_cents<=0 then raise exception 'Insufficient owner inbound credits';end if;
 op:='owner-inbound-test:'||rid;
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents) values(p_account,op,c.quote_cap_cents) returning id into cr;
 insert into public.icash_owner_inbound_acceptance_runs(id,config_id,account_id,owner_user_id,configuration,challenge_salt,challenge_hash,operation_key,credit_reservation_id,quote_cap_cents,expires_at)
 values(rid,c.id,p_account,p_user,to_jsonb(c),p_challenge_salt,p_challenge_hash,op,cr,c.quote_cap_cents,least(now()+interval '5 minutes',c.expires_at)) returning * into r;
 update public.icash_owner_inbound_acceptance_config set enabled=false where id=c.id;
 insert into public.icash_owner_inbound_acceptance_audit(run_id,account_id,event,state) values(r.id,r.account_id,'armed',r.state);
 return to_jsonb(r);
end $function$;
;
CREATE OR REPLACE FUNCTION public.icash_work_summary(p_account uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object(
 'generatedAt',now(),'scope','All recorded account activity',
 'balanceCents',w.balance_cents,'reservedCents',w.reserved_cents,
 'fundedCents',(select coalesce(sum(credit_cents),0) from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null),
 'spentCents',(select coalesce(sum(o.charged_cents-coalesce(c.covered_cents,0)),0) from public.icash_operation_spend o left join public.icash_usage_coverage c on c.operation_key=o.operation_key and c.account_id=o.account_id where o.account_id=p_account and o.state='settled'),
 'coveredUsageCents',(select coalesce(sum(covered_cents),0) from public.icash_usage_coverage where account_id=p_account),
 'analyzed',(select count(*) from public.icash_screening_jobs where account_id=p_account and state='complete'),
 'screeningCandidates',(select count(*) from public.icash_screening_jobs where account_id=p_account and state='complete' and result->'financialCheck'->>'status'='eligible'),
 'ownerRecords',(select count(*) from public.icash_owner_contacts where account_id=p_account),
 'contracts',(select count(*) from public.icash_deal_files where account_id=p_account and seller_signed_at is not null),
 'activeContracts',(select count(*) from public.icash_deal_files where account_id=p_account and seller_signed_at is not null and stage<>'closed'),
 'closed',(select count(*) from public.icash_deal_files where account_id=p_account and stage='closed' and funded_at is not null),
 'pending',(select count(*) from public.icash_operation_spend where account_id=p_account and state in ('reserved','dispatched')),
 'reasons',coalesce((select jsonb_agg(r) from (select left(result->'financialCheck'->>'reason',300) as reason,count(*) as count from public.icash_screening_jobs where account_id=p_account and state='complete' and result->'financialCheck'->>'status'<>'eligible' group by 1 order by count(*) desc limit 5) r),'[]'::jsonb),
 'lastPack',(select pack_code from public.icash_funding_orders where account_id=p_account and mode='live' and state='paid' and credited_at is not null order by created_at desc limit 1)
 ) from public.icash_wallets w where w.account_id=p_account;
$function$;
;
-- The session's immutable customer multipliers retain the VIP discount even
-- if membership changes later. Provider cost evidence stays at the reviewed rate.
CREATE OR REPLACE FUNCTION icash_recorded_reception_private.automatic_components(r icash_recorded_reception_private.sessions, a jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare result jsonb:='{}';cat text;rule jsonb;n numeric;basis text;evidence text;p jsonb:=r.cost_policy_snapshot;
begin
 -- Frozen dispatch authority is intentional: later pause/disable/review expiry
 -- cannot strand a previously admitted call's truthful debit or media deletion.
 if r.cost_policy_id is null or p->>'id' is distinct from r.cost_policy_id::text or p->>'account_id' is distinct from r.account_id::text
  or p->>'rate_id' is distinct from r.rate_id::text or p->'rate_snapshot' is distinct from r.rate_snapshot
  or not (
   row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row((p->>'standard_cost_multiplier')::numeric,(p->>'elevenlabs_cost_multiplier')::numeric)
   or (row((p->>'standard_cost_multiplier')::numeric,(p->>'elevenlabs_cost_multiplier')::numeric) is not distinct from row(3::numeric,3::numeric)
    and row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row(2.4::numeric,2.4::numeric))
  )
  or p->'components'->'other'->'pricingPolicy' is distinct from r.pricing_policy then raise exception 'Frozen standing policy binding required';end if;
 for cat,rule in select key,value from jsonb_each(p->'components') loop
  evidence:=rule->>'evidenceRef';basis:='verified';
  if cat='twilio' or (cat='elevenlabs' and a->>'mode'='recorded') then
   if rule->>'source' is distinct from 'provider_receipt' or not icash_recorded_reception_private.micros(a->'providers'->cat->'amountMicros') then raise exception 'Real provider cost required';end if;
   if cat='twilio' and a->'providers'->cat->>'basis'='estimated' then
    if not icash_recorded_reception_private.carrier_estimate_allowed(r,a->'providers'->cat,(a->>'durationSeconds')::numeric) then raise exception 'Approved exact carrier tariff estimate required';end if;
    basis:='estimated';
   end if;
   n:=(a->'providers'->cat->>'amountMicros')::numeric;evidence:=cat||':receipt-sha256:'||coalesce(a->'providers'->cat->>'receiptHash','')||case when basis='estimated' then ':tariff:us-local-inbound-20261007; final carrier price pending' else '' end;
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
end $function$;
commit;
