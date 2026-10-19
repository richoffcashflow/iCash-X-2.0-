-- Owner clarification 2026-10-19: only DealMachine research usage changes to 3x.
-- Standard/voice/SMS/lead-package pricing and historical snapshots are untouched.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_operation_spend
 add column dealmachine_cost_multiplier numeric check(dealmachine_cost_multiplier>0),
 add column data_unit_cost_micros bigint check(data_unit_cost_micros>0),
 add column data_cost_basis text;
CREATE OR REPLACE FUNCTION public.icash_reserve_before_fractional(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; r public.icash_operation_rates; o public.icash_operation_spend; cat text; n numeric; total numeric:=0; held bigint; daily numeric; cr uuid; required numeric; price numeric; dm_mult numeric; data_unit bigint; data_basis text;
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
 if r.operation='seller_call' and not public.icash_limited_seller_voice(p_account,p_operation) and not public.icash_cancellation_voice_current(p_account,p_operation) and not exists(select 1 from public.icash_voice_jobs meta_job where meta_job.account_id=p_account and 'voice:'||meta_job.id=p_operation and public.icash_meta_voice_context(p_account,meta_job.id) is not null) and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
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
 if r.operation in ('property_search','owner_enrichment','buyer_discovery') then
  dm_mult:=3*case when public.icash_vip_active(p_account) then 0.8 else 1 end;
  select credit_micros,cost_basis into strict data_unit,data_basis from public.icash_data_cost_settings where provider='dealmachine';
 end if;
 -- Match JS: round reserve up to a cent after adding buffer.
 held:=ceil(total*(10000+r.buffer_bps)/10000);
 required:=ceil((total*b.standard_cost_multiplier-(r.costs_micros->>'elevenlabs')::numeric*(b.standard_cost_multiplier-b.elevenlabs_cost_multiplier)+coalesce((r.costs_micros->>'dealmachine')::numeric*(dm_mult-b.standard_cost_multiplier),0))*(10000+r.buffer_bps)/10000);
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
 update public.icash_operation_spend set standard_cost_multiplier=b.standard_cost_multiplier,elevenlabs_cost_multiplier=b.elevenlabs_cost_multiplier,required_revenue_micros=required,dealmachine_cost_multiplier=dm_mult,data_unit_cost_micros=data_unit,data_cost_basis=data_basis where operation_key=p_operation;
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_account_margin_ok(p_account uuid, p_charge bigint, p_cost bigint, p_pending boolean)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select p_charge>=0 and p_cost>=0 and
 coalesce(sum(case when o.state='settled' then o.actual_micros::numeric*o.standard_cost_multiplier-coalesce((m.components->'elevenlabs'->>'amountMicros')::numeric,0)*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier)+coalesce((m.components->'dealmachine'->>'amountMicros')::numeric*(o.dealmachine_cost_multiplier-o.standard_cost_multiplier),0)
 when p_pending and o.state in ('reserved','dispatched') then coalesce(o.required_revenue_micros,o.reserved_micros*o.standard_cost_multiplier) else 0 end),0)
 +p_cost*(select standard_cost_multiplier from public.icash_operating_budget where id=1)
 <=coalesce(sum(case when o.state='settled' then coalesce(o.customer_price_micros,o.charged_cents*10000)
 when p_pending and o.state in ('reserved','dispatched') then coalesce(o.customer_price_micros,o.charge_cap_cents*10000) else 0 end),0)+p_charge*10000::numeric
 from public.icash_operation_spend o left join public.icash_cost_manifests m on m.operation_key=o.operation_key where o.account_id=p_account
$function$
;
CREATE OR REPLACE FUNCTION public.icash_quote_dealmachine(p_credits integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare s public.icash_data_cost_settings;mult numeric;
begin
 if p_credits is null or p_credits<0 or p_credits>1000000 then raise exception 'Invalid credit count';end if;
 select * into strict s from public.icash_data_cost_settings where provider='dealmachine';
 mult:=3;
 return jsonb_build_object('providerCredits',p_credits,'unitCostMicros',s.credit_micros,
 'estimatedDataCostMicros',p_credits::bigint*s.credit_micros,
 'dataPriceMicros',ceil(p_credits::numeric*s.credit_micros*mult),
 'multiplier',mult,'costBasis',s.cost_basis,'excludes','Infrastructure, payment costs, outreach and other overhead');
end $function$
;
-- Settle only the new policy's completed, bound provider receipts. Never guess
-- a missing response or re-price previously admitted operations.
create function public.icash_settle_dealmachine_usage(p_operation text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare o public.icash_operation_spend;r public.icash_operation_rates;receipt jsonb;observed numeric;
 v_source_ref text;used numeric;part record;components jsonb:='{}';amount numeric;total numeric:=0;price numeric:=0;charge bigint;evidence text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.dealmachine_cost_multiplier is null or o.data_unit_cost_micros is null then return false;end if;
 select * into strict r from public.icash_operation_rates where id=o.rate_id;
 if r.operation not in ('property_search','owner_enrichment','buyer_discovery') then return false;end if;
 if o.state='settled' then return true;end if;
 if o.state<>'dispatched' then return false;end if;
 if r.operation='property_search' then
  select result into receipt from public.icash_discovery_results where operation_key=p_operation and account_id=o.account_id;
  v_source_ref:='dealmachine:search:'||p_operation;
 elsif r.operation='owner_enrichment' then
  select result into receipt from public.icash_owner_contacts where operation_key=p_operation and account_id=o.account_id;
  v_source_ref:='dealmachine:owners:'||p_operation;
 else
  select b.receipt into receipt from public.icash_buyer_search_receipts b join public.icash_deal_files d on d.id=b.deal_id and d.account_id=o.account_id where b.operation_key=p_operation;
  v_source_ref:=p_operation;
 end if;
 if receipt is null or jsonb_typeof(receipt->'creditsUsed') is distinct from 'number' then return false;end if;
 used:=(receipt->>'creditsUsed')::numeric;
 select c.amount into observed from public.icash_cost_observations c where c.provider='dealmachine' and c.event_key=p_operation and c.source_ref=v_source_ref and c.units='provider_credits';
 if used<0 or used<>trunc(used) or used is distinct from observed or used*o.data_unit_cost_micros>(r.costs_micros->>'dealmachine')::numeric then return false;end if;
 for part in select key,value from jsonb_each_text(r.costs_micros) loop
  amount:=case when part.key='dealmachine' then used*o.data_unit_cost_micros else part.value::numeric end;
  total:=total+amount;
  price:=price+amount*case when part.key='dealmachine' then o.dealmachine_cost_multiplier when part.key='elevenlabs' then o.elevenlabs_cost_multiplier else o.standard_cost_multiplier end;
  components:=components||jsonb_build_object(part.key,jsonb_build_object('amountMicros',amount,'basis','estimated','evidenceRef',case when part.key='dealmachine' then 'Observed DealMachine credits at saved '||o.data_cost_basis||' unit allocation: '||v_source_ref else 'Existing operation allocation: '||r.version end));
 end loop;
 charge:=ceil(price/10000);
 if charge>o.charge_cap_cents or total>o.reserved_micros then return false;end if;
 evidence:='DealMachine usage v1: '||p_operation;
 perform public.icash_settle_complete_costs(p_operation,charge,components,evidence);
 update public.icash_operation_spend set cost_basis='estimated' where operation_key=p_operation;
 return true;
end $$;
revoke all on function public.icash_settle_dealmachine_usage(text) from public,anon,authenticated;
grant execute on function public.icash_settle_dealmachine_usage(text) to service_role;
commit;

