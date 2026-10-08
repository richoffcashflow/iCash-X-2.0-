begin;
set local lock_timeout='2s';
-- Title questions may receive the same bounded initial contact as payoff holds.
-- This does not change financial eligibility, authorize an offer, or replay work.
-- Patch the live definitions so VIP pricing and current allocation are preserved.
do $patch$
declare fn regprocedure; definition text; needle text := $old$->'financialScreening'->>'status'='payoff_may_exceed_budget'$old$;
begin
 foreach fn in array array['public.icash_assign_seller_lead_for(uuid)'::regprocedure,'public.icash_seller_limited_contact(uuid,uuid)'::regprocedure] loop
  definition:=pg_get_functiondef(fn);
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
   raise exception 'Limited-contact prerequisite changed: %',fn;
  end if;
  execute replace(definition,needle,$new$->'financialScreening'->>'status' in ('payoff_may_exceed_budget','title_review_needed')$new$);
 end loop;
end $patch$;
commit;
