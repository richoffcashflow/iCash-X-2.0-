CREATE OR REPLACE FUNCTION public.icash_finish_credit(p_account uuid, p_operation text, p_charge bigint, p_evidence text)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare r public.icash_credit_reservations; desired text;
begin
 if p_charge is null or p_charge<0 or p_evidence is null or trim(p_evidence)='' then raise exception 'Invalid settlement'; end if;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where account_id=p_account and operation_key=p_operation for update;
 if not found then raise exception 'Reservation missing'; end if;
 desired:=case when p_charge=0 then 'released' else 'settled' end;
 if r.status<>'reserved' then
  if r.status=desired and coalesce(r.settled_cents,0)=p_charge then return r.status; end if;
  raise exception 'Settlement conflict';
 end if;
 if p_charge>r.amount_cents then raise exception 'Charge exceeds reservation'; end if;
 if p_charge>0 then
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,'usage:'||p_operation,'usage',-p_charge,p_evidence);
 end if;
 update public.icash_wallets set balance_cents=balance_cents-p_charge,reserved_cents=reserved_cents-r.amount_cents where account_id=p_account;
 update public.icash_credit_reservations set status=desired,settled_cents=case when p_charge>0 then p_charge else null end where id=r.id;
 return desired;
end; $function$;

CREATE OR REPLACE FUNCTION public.icash_reserve_credit(p_account uuid, p_operation text, p_amount bigint)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare w public.icash_wallets; r public.icash_credit_reservations; a public.icash_accounts; used bigint; result uuid;
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
  if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) then raise exception 'Bot paused'; end if;
  return r.id;
 end if;
 if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) then raise exception 'Bot paused'; end if;
 if w.balance_cents-w.reserved_cents<p_amount then raise exception 'Insufficient credits'; end if;
 -- Rolling 24-hour consumption plus ALL outstanding reservations, including older work.
 select coalesce(sum(-delta_cents),0) into used from public.icash_credit_ledger
 where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours';
 if used+w.reserved_cents+p_amount>a.daily_limit_cents then raise exception 'Daily budget reached'; end if;
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents)
 values(p_account,p_operation,p_amount) returning id into result;
 update public.icash_wallets set reserved_cents=reserved_cents+p_amount where account_id=p_account;
 return result;
end; $function$;

