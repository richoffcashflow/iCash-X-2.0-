begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Persist the wait plan so the service's final progress refresh and maintenance
-- cannot relabel an unresolved original receipt as merely pending/queued.
do $patch$declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.icash_save_seller_text_offer(uuid,uuid,text,bigint,jsonb)'::regprocedure);
 old:='update public.icash_text_ai_jobs set state=''pending'',next_attempt_at=now()+interval ''1 minute'',updated_at=now() where id=j.id;';
 replacement:='update public.icash_text_ai_jobs set state=''pending'',analysis=jsonb_build_object(''offerPolicy'',''seller-text-offer-v1'',''offerPlan'',p_plan),next_attempt_at=now()+interval ''1 minute'',updated_at=now() where id=j.id;';
 if position(old in definition)=0 then raise exception 'Seller offer wait save changed';end if;
 execute replace(definition,old,replacement);
 definition:=pg_get_functiondef('public.icash_refresh_seller_reply_progress(uuid,uuid,text)'::regprocedure);
 old:='elsif offer_context is not null and o.id is null and p_failure is null then';
 replacement:=$r$elsif offer_context is not null and o.id is null and p_failure is null and j.analysis->>'offerPolicy'='seller-text-offer-v1' and j.analysis->'offerPlan'->>'kind'='wait' then
  status:='waiting';milestone:='negotiation';why:=j.analysis->'offerPlan'->>'reason';step:=j.analysis->'offerPlan'->>'nextStep';wake:='original call/message completion receipt or 15-minute reconciliation boundary';due:=now()+interval '1 minute';
 $r$||old;
 if position(old in definition)=0 then raise exception 'Seller offer wait refresh changed';end if;
 execute replace(definition,old,replacement);
end $patch$;
commit;
