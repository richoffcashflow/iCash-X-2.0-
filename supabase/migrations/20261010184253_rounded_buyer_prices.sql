begin;
set local lock_timeout='3s';
select 1 from public.icash_operating_budget where id=1 for update;
-- Set new marketing terms before any package/assignment is issued. The exact
-- seller purchase price stays intact; the fee bridges it to the rounded total.
do $rounding$
declare target regprocedure;definition text;patch record;
begin
 target:=coalesce(to_regprocedure('public.icash_prepare_disposition_before_deposit(uuid,uuid)'),to_regprocedure('public.icash_prepare_buyer_disposition(uuid,uuid)'));
 definition:=pg_get_functiondef(target);
 for patch in select * from (values
  ($old$price bigint;repairs numeric;$old$,$new$price bigint;fee bigint;prior_policy text;repairs numeric;$new$),
  ($old$if price<=0 or price>99999000000 then return false;end if;$old$,$new$if price<=0 or price>99999000000 then return false;end if;
 select pricing_policy into prior_policy from public.icash_disposition_authorities where deal_id=d.id and account_id=p_account;
 -- An existing release retains its exact advertised price and fee.
 fee:=case when prior_policy='signed_purchase_plus_10000_v1' then 1000000
  else ((price+1000000+99999)/100000)*100000-price end;$new$),
  ($old$if d.terms->>'assignmentFeeCents' is null and not exists($old$,$new$if d.terms->>'assignmentFeeCents' is null and prior_policy is null and not exists($new$),
  ($old$jsonb_set(terms,'{assignmentFeeCents}','1000000'::jsonb)$old$,$new$jsonb_set(terms,'{assignmentFeeCents}',to_jsonb(fee))$new$),
  ($old$if d.terms->>'assignmentFeeCents' is distinct from '1000000' then return false;end if;$old$,$new$if d.terms->>'assignmentFeeCents' is distinct from fee::text then return false;end if;$new$),
  ($old$pricing_policy<>'signed_purchase_plus_10000_v1'$old$,$new$pricing_policy not in ('signed_purchase_plus_10000_v1','signed_purchase_rounded_10000_v2')$new$),
  ($old$'Operator standing policy authorized 2026-10-07: executed standard purchase plus $10000; no contact consent or title clearance asserted.',deadline,'signed_purchase_plus_10000_v1'$old$,$new$'Owner pricing policy 2026-10-10: signed purchase plus a minimum $10000 fee, buyer total rounded up to $1000; no contact consent or title clearance asserted.',deadline,'signed_purchase_rounded_10000_v2'$new$)
 ) as edits(old_text,new_text) loop
  if (length(definition)-length(replace(definition,patch.old_text,'')))/length(patch.old_text)<>1 then
   raise exception 'Buyer price prerequisite changed: %',left(patch.old_text,70);
  end if;
  definition:=replace(definition,patch.old_text,patch.new_text);
 end loop;
 if (length(definition)-length(replace(definition,'price+1000000','')))/length('price+1000000')<>3 then
  raise exception 'Buyer total prerequisite changed';
 end if;
 -- Preserve the rounding formula's base fee, change only stored/checked totals.
 definition:=replace(definition,$old$'house',price+1000000,repairs::bigint$old$,$new$'house',price+fee,repairs::bigint$new$);
 definition:=replace(definition,'asking_price_cents=price+1000000','asking_price_cents=price+fee');
 execute definition;
end $rounding$;
commit;
