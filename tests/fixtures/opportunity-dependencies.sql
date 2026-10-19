-- Schema functions captured for local fixture testing; no customer data.
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
end; $function$
;

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
end; $function$
;

CREATE OR REPLACE FUNCTION public.icash_seller_contact_stop(p_body text)
 RETURNS boolean
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO ''
AS $function$
 select coalesce(replace(replace(btrim(p_body),'’',''''),'‘','''') ~* '^(please[[:space:]]+)?(stop|stopall|unsubscribe|cancel|end|quit|revoke|opt[[:space:]]*out)([[:space:]]+please)?([.![:space:]]*$|[[:space:]]*[,;.!][[:space:]]*(please|call|text|but)\M)|\m(do not|don''t|dont|stop)[[:space:]]+(texting|messaging|contacting|calling|text|message|contact|call)([[:space:]]+(me|us))?\M(?![[:space:]]+(it|that|the house|the property)\M)|\mleave (me|us) alone\M|\m(remove|take) (me|my number) (off|from)\M|^(please )?(unsubscribe|remove|delete) (me|my number)[.! ]*$',false)
$function$
;

CREATE OR REPLACE FUNCTION public.icash_settle_complete_costs(p_operation text, p_charge bigint, p_components jsonb, p_evidence text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.icash_operation_spend;prior public.icash_fractional_usage;carry bigint;charge bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if o.customer_price_micros is null then
 perform public.icash_settle_costs_before_fractional(p_operation,p_charge,p_components,p_evidence);return;
 end if;
 select * into prior from public.icash_fractional_usage where operation_key=p_operation;
 if found then perform public.icash_settle_costs_before_fractional(p_operation,prior.charged_cents,p_components,p_evidence);return;end if;
 insert into public.icash_fractional_credit_carry(account_id) values(o.account_id) on conflict do nothing;
 select remaining_micros into carry from public.icash_fractional_credit_carry where account_id=o.account_id for update;
 charge:=(carry+o.customer_price_micros)/10000;
 -- Costs still require the complete verified manifest. Unknown provider cost cannot be settled as zero.
 perform public.icash_settle_costs_before_fractional(p_operation,charge,p_components,p_evidence);
 insert into public.icash_fractional_usage(operation_key,account_id,price_micros,charged_cents) values(p_operation,o.account_id,o.customer_price_micros,charge);
 update public.icash_fractional_credit_carry set remaining_micros=mod(carry+o.customer_price_micros,10000) where account_id=o.account_id;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_settle_operation(p_operation text, p_charge bigint, p_actual_micros bigint, p_evidence text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare o public.icash_operation_spend;
begin
 if p_charge is null or p_charge<0 or p_actual_micros is null or p_actual_micros<0 or p_evidence is null or trim(p_evidence)='' then raise exception 'Verified settlement required'; end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found then raise exception 'Operation missing'; end if;
 if o.state in ('settled','cancelled') then
  if row(o.charged_cents,o.actual_micros,o.settlement_evidence) is distinct from row(p_charge,p_actual_micros,p_evidence) then raise exception 'Settlement conflict'; end if;
  return;
 end if;
 if p_charge>o.charge_cap_cents then raise exception 'Charge exceeds approved amount'; end if;
 if o.state='reserved' and (p_charge<>0 or p_actual_micros<>0) then raise exception 'Undispatched operation can only be cancelled'; end if;
 perform public.icash_finish_credit(o.account_id,p_operation,p_charge,p_evidence);
 update public.icash_operating_budget set reserved_micros=reserved_micros-o.reserved_micros,spent_micros=spent_micros+p_actual_micros,
 enabled=case when p_actual_micros>o.reserved_micros then false else enabled end,
 hold_reason=case when p_actual_micros>o.reserved_micros then 'Actual cost exceeded reserve or margin floor; reconcile before resuming' else hold_reason end where id=1;
 update public.icash_operation_spend set state=case when o.state='reserved' then 'cancelled' else 'settled' end,actual_micros=p_actual_micros,charged_cents=p_charge,settlement_evidence=p_evidence,settled_at=now() where operation_key=p_operation;
 if not public.icash_account_margin_ok(o.account_id,0,0,false) then
 update public.icash_accounts set bot_paused=true where id=o.account_id;
 end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_settle_costs_before_fractional(p_operation text, p_charge bigint, p_components jsonb, p_evidence text)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare cat text;n numeric;total numeric:=0;old public.icash_cost_manifests;
begin
 if p_evidence is null or length(trim(p_evidence))<10 or p_charge is null or p_charge<0 or jsonb_typeof(p_components) is distinct from 'object' then raise exception 'Verified complete cost evidence required';end if;
 if (select count(*) from jsonb_object_keys(p_components))<>16 then raise exception 'All cost categories required';end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(p_components->cat->'amountMicros') is distinct from 'number' or jsonb_typeof(p_components->cat->'evidenceRef') is distinct from 'string' or length(trim(p_components->cat->>'evidenceRef'))<10 then raise exception 'Verified cost category required: %',cat;end if;
  n:=(p_components->cat->>'amountMicros')::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost';end if;
  total:=total+n;
 end loop;
 if total>9007199254740991 then raise exception 'Cost total out of range';end if;
 -- Ledger lock first, matching reserve/settle lock order.
 perform 1 from public.icash_operating_budget where id=1 for update;
 insert into public.icash_cost_manifests(operation_key,charge_cents,actual_micros,components,evidence_ref) values(p_operation,p_charge,total,p_components,p_evidence) on conflict do nothing;
 select * into strict old from public.icash_cost_manifests where operation_key=p_operation;
 if row(old.charge_cents,old.actual_micros,old.components,old.evidence_ref) is distinct from row(p_charge,total::bigint,p_components,p_evidence) then raise exception 'Cost manifest conflict';end if;
 perform public.icash_settle_operation(p_operation,p_charge,total::bigint,p_evidence);
end $function$;
