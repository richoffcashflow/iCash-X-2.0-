begin;
alter table public.icash_memberships add column vip_until timestamptz;
alter table public.icash_memberships add column initial_price_cents bigint;
update public.icash_memberships set initial_price_cents=price_cents;
create table public.icash_plan_changes(
 id uuid primary key default gen_random_uuid(), membership_id uuid not null references public.icash_memberships(id),
 account_id uuid not null references public.icash_accounts(id), action text not null check(action in ('upgrade','downgrade','keep_vip')),
 state text not null default 'pending' check(state in ('pending','paid','applied','expired')),
 period_end timestamptz not null, from_price bigint not null, to_price bigint not null check(to_price in (5000,10000)),
 session_id text unique, payment_id text unique, price_id text, created_at timestamptz not null default now(),
 applied_at timestamptz
);
alter table public.icash_plan_changes enable row level security;
revoke all on public.icash_plan_changes from public,anon,authenticated;
grant all on public.icash_plan_changes to service_role;
create function public.icash_vip_active(p_account uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_memberships m where m.account_id=p_account and m.mode='live' and m.state='active' and m.paid_through>now() and m.vip_until>now());
$$;
create table public.icash_daily_allowances(
 account_id uuid not null references public.icash_accounts(id), day date not null,
 opening_cents bigint not null check(opening_cents>=0), base_cents bigint not null check(base_cents>=0),
 extra_cents bigint not null default 0 check(extra_cents>=0), updated_at timestamptz not null default now(),
 primary key(account_id,day)
);
alter table public.icash_daily_allowances enable row level security;
revoke all on public.icash_daily_allowances from public,anon,authenticated;
grant all on public.icash_daily_allowances to service_role;
create function public.icash_spending_day(p_clock timestamptz default now()) returns date language sql stable set search_path='' as $$ select (p_clock at time zone 'America/Chicago')::date $$;
create function public.icash_daily_allowance(p_account uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.icash_accounts;w public.icash_wallets;d public.icash_daily_allowances;spent bigint;available bigint;cap bigint;opening bigint;day_start timestamptz;reserved_today bigint;
begin
 select * into strict a from public.icash_accounts where id=p_account for update;
 select * into strict w from public.icash_wallets where account_id=p_account for update;
 day_start:=public.icash_spending_day()::timestamp at time zone 'America/Chicago';
 select coalesce(sum(-delta_cents),0) into spent from public.icash_credit_ledger where account_id=p_account and kind='usage' and created_at>=day_start and not exists(select 1 from public.icash_credit_reservations r where r.account_id=p_account and 'usage:'||r.operation_key=icash_credit_ledger.event_key and r.created_at<day_start);
 select coalesce(sum(amount_cents),0) into reserved_today from public.icash_credit_reservations where account_id=p_account and status='reserved' and created_at>=day_start;
 available:=greatest(0,w.balance_cents-w.reserved_cents);
 -- Lazy initialization is before the first new reservation. Restore today's settled
 -- spend so repeated reads cannot shrink or replenish today's allowance.
 opening:=greatest(0,available+spent+reserved_today);
 insert into public.icash_daily_allowances(account_id,day,opening_cents,base_cents)
 values(p_account,public.icash_spending_day(),opening,least(a.daily_limit_cents,opening/2)) on conflict do nothing;
 select * into strict d from public.icash_daily_allowances where account_id=p_account and day=public.icash_spending_day();
 -- First funding after an empty morning starts the bot without a manual override.
 if d.opening_cents=0 and opening>0 then
  update public.icash_daily_allowances set opening_cents=opening,base_cents=least(a.daily_limit_cents,opening/2),updated_at=now() where account_id=p_account and day=d.day returning * into d;
 end if;
 cap:=least(d.base_cents,a.daily_limit_cents)+d.extra_cents;
 return jsonb_build_object('day',d.day,'timezone','America/Chicago','openingCents',d.opening_cents,'limitCents',cap,'spentCents',spent,'reservedCents',reserved_today,'remainingCents',greatest(0,least(available,cap-spent-reserved_today)),'availableCents',available,'extraCents',d.extra_cents,'resetsAt',(d.day+1)::timestamp at time zone 'America/Chicago');
end $$;
create function public.icash_allow_more_today(p_user uuid,p_account uuid,p_day date,p_extra_total bigint) returns jsonb language plpgsql security invoker set search_path='' as $$
declare s jsonb;d public.icash_daily_allowances;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) or not public.icash_membership_work_allowed(p_account) then raise exception 'Account access required';end if;
 s:=public.icash_daily_allowance(p_account);
 select * into strict d from public.icash_daily_allowances where account_id=p_account and day=public.icash_spending_day() for update;
 if p_day is distinct from d.day or p_extra_total is null or p_extra_total<d.extra_cents or p_extra_total>d.extra_cents+greatest(0,(s->>'availableCents')::bigint-(s->>'remainingCents')::bigint) then raise exception 'Refresh today allowance';end if;
 update public.icash_daily_allowances set extra_cents=p_extra_total,updated_at=now() where account_id=p_account and day=d.day;
 return public.icash_daily_allowance(p_account);
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
 if w.balance_cents-w.reserved_cents<p_amount then raise exception 'Insufficient credits'; end if;
 allowance:=public.icash_daily_allowance(p_account);
 if p_amount>(allowance->>'remainingCents')::bigint then raise exception 'Daily allowance reached: allow more spending today';end if;
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents)
 values(p_account,p_operation,p_amount) returning id into result;
 update public.icash_wallets set reserved_cents=reserved_cents+p_amount where account_id=p_account;
 return result;
end; $function$;
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
end $function$;

alter function public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) rename to icash_reserve_before_vip;
create function public.icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;existed boolean; prior public.icash_operation_spend;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into prior from public.icash_operation_spend where operation_key=p_operation;existed:=found;
 if existed then
  if prior.account_id<>p_account or prior.rate_id<>p_rate or not public.icash_membership_work_allowed(p_account) then raise exception 'Operation conflict';end if;
  return jsonb_build_object('operationKey',prior.operation_key,'state',prior.state,'reservedMicros',prior.reserved_micros);
 end if;
 result:=public.icash_reserve_before_vip(p_account,p_operation,p_rate,p_permission_until,p_financial_checked_at,p_financial_eligible);
 if not existed and public.icash_vip_active(p_account) then
  -- Flat SMS is already an explicit retail price; apply the 20% usage reduction
  -- to the operation snapshot only. No re-pricing after dispatch or on retries.
  update public.icash_operation_spend set customer_price_micros=ceil(customer_price_micros::numeric*0.8)
   where operation_key=p_operation and customer_price_micros is not null;
 end if;
 return result;
end $$;
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
CREATE OR REPLACE FUNCTION public.icash_settle_membership_invoice_v2(p_membership uuid, p_subscription text, p_customer text, p_invoice text, p_payment text, p_amount bigint, p_email text, p_phone text, p_period_end timestamp with time zone, p_period_start timestamp with time zone, p_discount text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.icash_memberships;i public.icash_membership_invoices;
begin
 select * into m from public.icash_memberships where id=p_membership for update;
 if p_subscription is null or p_customer is null or p_invoice is null or p_payment is null or m.id is null or p_amount is distinct from (case when p_discount is null then m.price_cents else m.price_cents-round(m.price_cents*0.5)::bigint end) or p_subscription !~ '^sub_[A-Za-z0-9]+$' or p_customer !~ '^cus_[A-Za-z0-9]+$' or p_invoice !~ '^in_[A-Za-z0-9]+$' or p_payment !~ '^pi_[A-Za-z0-9]+$' or p_period_end is null or p_email is null or position('@' in p_email)<2 or length(p_email)>320
 or (m.stripe_subscription_id is not null and m.stripe_subscription_id<>p_subscription) or (m.stripe_customer_id is not null and m.stripe_customer_id<>p_customer) then raise exception 'Membership invoice mismatch';end if;
 if p_period_start is null or p_period_end<=p_period_start or p_period_end>p_period_start+interval '32 days' then raise exception 'Invalid invoice period';end if;
 if p_discount is not null and (m.retention_requested_at is null or m.retention_discount_id is distinct from p_discount or m.retention_started_at is null or m.retention_ends_at is null or p_period_start<m.retention_started_at or p_period_start>=m.retention_ends_at) then raise exception 'Unauthorized retention invoice';end if;
 select * into i from public.icash_membership_invoices where stripe_invoice_id=p_invoice;
 if found then if i.membership_id<>m.id or i.stripe_payment_id<>p_payment or i.amount_cents<>p_amount or i.period_end<>p_period_end then raise exception 'Invoice replay mismatch';end if;return;end if;
 insert into public.icash_membership_invoices(stripe_invoice_id,membership_id,stripe_payment_id,amount_cents,period_end) values(p_invoice,m.id,p_payment,p_amount,p_period_end);
 update public.icash_memberships set stripe_subscription_id=p_subscription,stripe_customer_id=p_customer,payer_email=lower(trim(p_email)),payer_phone=left(p_phone,40),paid_through=greatest(paid_through,p_period_end),vip_until=case when price_cents=10000 then greatest(vip_until,p_period_end) else vip_until end,updated_at=now() where id=m.id;
 if exists(select 1 from public.icash_billing_reviews where payment_id=p_payment and resolved_at is null) then
 update public.icash_memberships set state='needs_review' where id=m.id;
 update public.icash_accounts set bot_paused=true where id=m.account_id;
 end if;
 -- Software payments never post to the work-credit wallet.
end $function$;

revoke all on function public.icash_vip_active(uuid),public.icash_spending_day(timestamptz),public.icash_daily_allowance(uuid),public.icash_allow_more_today(uuid,uuid,date,bigint),public.icash_reserve_before_vip(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) from public,anon,authenticated;
grant execute on function public.icash_vip_active(uuid),public.icash_spending_day(timestamptz),public.icash_daily_allowance(uuid),public.icash_allow_more_today(uuid,uuid,date,bigint),public.icash_reserve_before_vip(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean) to service_role;
create unique index icash_one_pending_plan_change on public.icash_plan_changes(membership_id) where state in ('pending','paid');
create function public.icash_begin_plan_change(p_membership uuid,p_account uuid,p_action text,p_period_end timestamptz) returns public.icash_plan_changes language plpgsql security invoker set search_path='' as $$
declare m public.icash_memberships;c public.icash_plan_changes;
begin
 select * into strict m from public.icash_memberships where id=p_membership and account_id=p_account for update;
 if m.state<>'active' or m.paid_through<=now() or m.cancel_at_period_end or m.stripe_subscription_id is null or p_period_end is distinct from m.paid_through then raise exception 'Active paid period required';end if;
 select * into c from public.icash_plan_changes where membership_id=m.id and state in ('pending','paid');
 if found then if c.action<>p_action then raise exception 'Finish the pending plan change first';end if;return c;end if;
 if p_action='upgrade' and (m.price_cents<>5000 or m.vip_until>now()) or p_action='downgrade' and (m.price_cents<>10000 or coalesce(m.vip_until<=now(),true)) or p_action='keep_vip' and (m.price_cents<>5000 or coalesce(m.vip_until<=now(),true)) or p_action not in ('upgrade','downgrade','keep_vip') then raise exception 'Plan changed; refresh';end if;
 insert into public.icash_plan_changes(membership_id,account_id,action,period_end,from_price,to_price) values(m.id,m.account_id,p_action,p_period_end,m.price_cents,case when p_action='downgrade' then 5000 else 10000 end) returning * into c;
 return c;
end $$;
create function public.icash_mark_plan_change_paid(p_change uuid,p_session text,p_payment text) returns void language plpgsql security invoker set search_path='' as $$
declare c public.icash_plan_changes;
begin
 select * into strict c from public.icash_plan_changes where id=p_change for update;
 if c.action<>'upgrade' or c.session_id is distinct from p_session or p_payment !~ '^pi_[A-Za-z0-9]+$' or c.payment_id is not null and c.payment_id<>p_payment then raise exception 'Upgrade payment binding mismatch';end if;
 if exists(select 1 from public.icash_billing_reviews where payment_id=p_payment and resolved_at is null) then raise exception 'Upgrade payment is under review';end if;
 if c.state='applied' then return;end if;
 update public.icash_plan_changes set state='paid',payment_id=p_payment where id=c.id;
end $$;
create function public.icash_apply_plan_change(p_change uuid,p_subscription text,p_price text) returns void language plpgsql security invoker set search_path='' as $$
declare c public.icash_plan_changes;m public.icash_memberships;
begin
 select * into strict c from public.icash_plan_changes where id=p_change;
 select * into strict m from public.icash_memberships where id=c.membership_id for update;
 select * into strict c from public.icash_plan_changes where id=p_change for update;
 if c.state='applied' then return;end if;
 if m.account_id<>c.account_id or m.state<>'active' or m.cancel_at_period_end or m.paid_through<=now() or m.price_cents<>c.from_price or m.stripe_subscription_id is distinct from p_subscription or c.price_id is distinct from p_price or (c.action='upgrade' and (c.state<>'paid' or c.payment_id is null)) then raise exception 'Plan settlement conflict';end if;
 update public.icash_memberships set price_cents=c.to_price,vip_until=case when c.action='upgrade' then greatest(vip_until,c.period_end) else vip_until end,updated_at=now() where id=m.id;
 update public.icash_plan_changes set state='applied',applied_at=now() where id=c.id;
end $$;
revoke all on function public.icash_begin_plan_change(uuid,uuid,text,timestamptz),public.icash_mark_plan_change_paid(uuid,text,text),public.icash_apply_plan_change(uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_begin_plan_change(uuid,uuid,text,timestamptz),public.icash_mark_plan_change_paid(uuid,text,text),public.icash_apply_plan_change(uuid,text,text) to service_role;

create function public.icash_save_vip_bot_name(p_user uuid,p_account uuid,p_name text) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) or not public.icash_vip_active(p_account) then raise exception 'VIP required';end if;
 if p_name is null or length(trim(p_name)) not between 1 and 64 or p_name ~ '[<>{}[:cntrl:]]' then raise exception 'Invalid bot name';end if;
 update public.icash_accounts set assistant_name=trim(p_name) where id=p_account;
 update public.icash_bot_setups set profile=jsonb_set(profile,'{displayName}',to_jsonb(trim(p_name))),revision=revision+1,updated_at=now() where account_id=p_account;
end $$;
revoke all on function public.icash_save_vip_bot_name(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_save_vip_bot_name(uuid,uuid,text) to service_role;
create table public.icash_question_usage(
 question_id uuid primary key references public.icash_workspace_questions(id),account_id uuid not null references public.icash_accounts(id),
 model text not null check(model='gpt-4.1-mini'),multiplier numeric not null check(multiplier in (3,2.4)),
 state text not null default 'reserved' check(state in ('reserved','settled','unverified')),
 provider_id text unique,input_tokens bigint,cached_tokens bigint,output_tokens bigint,cost_micros bigint,price_micros bigint,charged_cents bigint,
 created_at timestamptz not null default now(),settled_at timestamptz
);
alter table public.icash_question_usage enable row level security;
revoke all on public.icash_question_usage from public,anon,authenticated;
grant all on public.icash_question_usage to service_role;
create function public.icash_reserve_question(p_account uuid,p_question uuid,p_model text) returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 if p_model is distinct from 'gpt-4.1-mini' or not exists(select 1 from public.icash_workspace_questions where id=p_question and account_id=p_account and state='pending') then raise exception 'Question binding required';end if;
 if exists(select 1 from public.icash_question_usage where question_id=p_question) then return false;end if;
 insert into public.icash_question_usage(question_id,account_id,model,multiplier) values(p_question,p_account,p_model,case when public.icash_vip_active(p_account) then 2.4 else 3 end);
 perform public.icash_reserve_credit(p_account,'question:'||p_question,5);
 return true;
end $$;
create function public.icash_settle_question(p_account uuid,p_question uuid,p_provider text,p_input bigint,p_cached bigint,p_output bigint) returns bigint language plpgsql security invoker set search_path='' as $$
declare q public.icash_question_usage;cost bigint;price bigint;carry bigint;charge bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 select * into strict q from public.icash_question_usage where question_id=p_question and account_id=p_account for update;
 if q.state<>'reserved' then
  if row(q.provider_id,q.input_tokens,q.cached_tokens,q.output_tokens) is distinct from row(p_provider,p_input,p_cached,p_output) then raise exception 'Question settlement changed';end if;return q.charged_cents;
 end if;
 if p_provider is null then
  perform public.icash_finish_credit(p_account,'question:'||p_question,0,'AI response has no verified usage; customer not charged');
  update public.icash_question_usage set state='unverified',charged_cents=0,settled_at=now() where question_id=q.question_id;return 0;
 end if;
 if p_provider !~ '^chatcmpl-[A-Za-z0-9_-]+$' or p_input is null or p_input not between 0 and 32000 or p_cached is null or p_cached not between 0 and p_input or p_output is null or p_output not between 0 and 150 then raise exception 'Invalid provider token receipt';end if;
 -- GPT-4.1 mini standard tier: $0.40 input / $0.10 cached / $1.60 output per 1M tokens.
 -- Official model pricing checked 2026-10-07. No tools, images or batch calls.
 cost:=ceil((p_input-p_cached)*0.4+p_cached*0.1+p_output*1.6);
 price:=ceil(cost*q.multiplier);
 insert into public.icash_fractional_credit_carry(account_id) values(p_account) on conflict do nothing;
 select remaining_micros into carry from public.icash_fractional_credit_carry where account_id=p_account for update;
 charge:=(carry+price)/10000;
 if charge>5 then raise exception 'Question price exceeds its reservation';end if;
 perform public.icash_finish_credit(p_account,'question:'||p_question,charge,'OpenAI token receipt '||p_provider);
 update public.icash_fractional_credit_carry set remaining_micros=mod(carry+price,10000) where account_id=p_account;
 update public.icash_question_usage set state='settled',provider_id=p_provider,input_tokens=p_input,cached_tokens=p_cached,output_tokens=p_output,cost_micros=cost,price_micros=price,charged_cents=charge,settled_at=now() where question_id=q.question_id;
 return charge;
end $$;
revoke all on function public.icash_reserve_question(uuid,uuid,text),public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint) from public,anon,authenticated;
grant execute on function public.icash_reserve_question(uuid,uuid,text),public.icash_settle_question(uuid,uuid,text,bigint,bigint,bigint) to service_role;
create or replace function public.icash_flag_membership_issue(p_payment text) returns void language plpgsql set search_path='' as $$
begin
 update public.icash_memberships set state='needs_review',updated_at=now() where id in (select membership_id from public.icash_membership_invoices where stripe_payment_id=p_payment union select membership_id from public.icash_plan_changes where payment_id=p_payment);
 update public.icash_accounts set bot_paused=true where id in (select account_id from public.icash_memberships where state='needs_review' and id in (select membership_id from public.icash_membership_invoices where stripe_payment_id=p_payment union select membership_id from public.icash_plan_changes where payment_id=p_payment));
end $$;
commit;
