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
end $function$;
