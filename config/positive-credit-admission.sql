begin;
set local lock_timeout='5s';
-- Align planning/readiness with the already deployed actual-usage admission:
-- a positive balance, no maximum-estimate hold. Pricing, permissions, provider
-- claims, membership, Pause and once-only settlement remain unchanged.
do $patch$
declare definition text;r record;
begin
 for r in select * from (values
  ('public.icash_outbound_search_due(uuid)','capacity<cost','capacity<=0'),
  ('public.icash_next_before_owner_question()','wallet.balance_cents-wallet.reserved_cents>=rate.charge_cents','wallet.balance_cents>0'),
  ('public.icash_manual_text_reason(uuid,uuid,uuid)','coalesce(available,0)<charge','coalesce(available,0)<=0'),
  ('public.icash_next_work(uuid)','c.estimated_charge_cents<=least(f.available,f.remaining)','f.remaining>0')
 ) patches(signature,old_check,new_check) loop
  definition:=pg_get_functiondef(r.signature::regprocedure);
  if position(r.old_check in definition)=0 then raise exception 'Credit admission prerequisite changed: %',r.signature;end if;
  execute replace(definition,r.old_check,r.new_check);
 end loop;
end $patch$;
commit;
