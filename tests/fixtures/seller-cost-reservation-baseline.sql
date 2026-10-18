-- Read-only production snapshot, 2026-10-18. Synthetic tests only.
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
end $function$
;
