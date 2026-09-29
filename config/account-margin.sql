create or replace function public.icash_account_margin_ok(p_account uuid,p_charge bigint,p_cost bigint,p_pending boolean) returns boolean language sql stable set search_path='' as $$
 select p_charge>=0 and p_cost>=0 and
 coalesce(sum(case when o.state='settled' then o.actual_micros when p_pending and o.state in ('reserved','dispatched') then o.reserved_micros else 0 end),0)::numeric+p_cost
 <= (coalesce(sum(case when o.state='settled' then o.charged_cents else 0 end),0)::numeric+p_charge)*(10000-b.minimum_margin_bps)
 from public.icash_operating_budget b left join public.icash_operation_spend o on o.account_id=p_account where b.id=1 group by b.minimum_margin_bps
$$;
revoke all on function public.icash_account_margin_ok(uuid,bigint,bigint,boolean) from public,anon,authenticated;
grant execute on function public.icash_account_margin_ok(uuid,bigint,bigint,boolean) to service_role;

CREATE OR REPLACE FUNCTION public.icash_reserve_operation(p_account uuid, p_operation text, p_rate uuid, p_permission_until timestamp with time zone, p_financial_checked_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_financial_eligible boolean DEFAULT false)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare b public.icash_operating_budget; r public.icash_operation_rates; o public.icash_operation_spend; cat text; n numeric; total numeric:=0; held bigint; daily numeric; cr uuid;
begin
 if p_operation is null or length(p_operation) not between 1 and 160 then raise exception 'Invalid operation'; end if;
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.enabled then raise exception 'Operating budget on hold'; end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation;
 if found then
  if o.account_id<>p_account or o.rate_id<>p_rate then raise exception 'Operation conflict'; end if;
  return jsonb_build_object('operationKey',o.operation_key,'state',o.state,'reservedMicros',o.reserved_micros);
 end if;
 select * into r from public.icash_operation_rates where id=p_rate for share;
 if not found or not r.enabled or r.verified_at>now() or r.expires_at<=now() then raise exception 'Verified rate required'; end if;
 if p_permission_until is null or p_permission_until<=now() then raise exception 'Permission expired'; end if;
 if r.operation='seller_call' and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
 -- Match JS: round reserve up to a cent after adding buffer.
 held:=ceil(total*(10000+r.buffer_bps)/100000000)*10000;
 if not public.icash_account_margin_ok(p_account,r.charge_cents,held,true) then raise exception 'Account margin reserve exhausted'; end if;
 if b.funded_micros::numeric-b.spent_micros-b.reserved_micros-b.protected_micros<held then raise exception 'Company budget exhausted'; end if;
 select coalesce(sum(actual_micros),0) into daily from public.icash_operation_spend where settled_at>now()-interval '24 hours';
 if daily+b.reserved_micros+held>b.daily_limit_micros then raise exception 'Company daily limit'; end if;
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
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
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

