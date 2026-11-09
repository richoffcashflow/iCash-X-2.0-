begin;
set local lock_timeout='5s';
select 1 from public.icash_operating_budget where id=1 for update;

-- Prospective owner policy, 2026-11-09: ARV × 70% − repairs − wholesale fee.
-- Patch the existing functions in place to retain their validation and privileges.
-- No stored offers, accepted/signed terms, published prices, fees or deposits change.
do $patch$
declare signature text;definition text;
 old_formula constant text:='floor(greatest(arv-repairs,0)*7000/10000)';
 new_formula constant text:='greatest(floor(arv*7000/10000)-repairs,0)';
begin
 foreach signature in array array[
  'public.icash_automatic_cash_offer_price(jsonb)',
  'public.icash_buyer_assignment_pricing(bigint,jsonb,bigint)',
  'public.icash_buyer_assignment_pricing(bigint,jsonb,bigint,bigint)'
 ] loop
  if to_regprocedure(signature) is null then raise exception '70 percent pricing prerequisite missing: %',signature;end if;
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,old_formula,'')))/length(old_formula)<>1 then
   raise exception '70 percent pricing prerequisite changed: %',signature;
  end if;
  execute replace(definition,old_formula,new_formula);
 end loop;
 -- Only the evidence text on NEW publications changes. The existing early returns
 -- for legacy policies and already-published authorities are retained verbatim.
 signature:='public.icash_prepare_disposition_before_deposit(uuid,uuid)';
 definition:=pg_get_functiondef(signature::regprocedure);
 if position('whole $1000 fees within 70% of (ARV minus repairs).' in definition)=0
 or position('public.icash_deal_minimum_fee(p_account,p_deal)' in definition)=0
 or position('if a.deal_id is not null then' in definition)=0 then
  raise exception '70 percent publication prerequisite changed';
 end if;
 definition:=replace(definition,'Owner pricing policy 2026-10-10:','Owner pricing policy 2026-11-09:');
 execute replace(definition,'whole $1000 fees within 70% of (ARV minus repairs).','whole $1000 fees within (ARV times 70%) minus repairs.');
end $patch$;
commit;
