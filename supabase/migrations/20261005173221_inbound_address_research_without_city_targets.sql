begin;
-- Inbound acquisition is driven by submitted addresses, not a discovery-city
-- allowlist. Keep recorded data rights, spend, financial and contact gates.
-- The legacy market_qualified column now means financially qualified for
-- distribution; it is not contract-jurisdiction or outreach authorization.
do $patch$
declare def text;needle text;
begin
 def:=pg_get_functiondef('public.icash_finish_seller_lookup(uuid,uuid,jsonb)'::regprocedure);
 needle:=$old$select numbers and exists(select 1 from public.icash_seller_markets m where m.city=city_name and m.state=st and m.enabled and m.major_city and m.reviewed_until>now() and length(m.review_ref)>=10) into market;$old$;
 if position(needle in def)=0 then raise exception 'Seller financial qualification changed';end if;
 def:=replace(def,needle,'market:=numbers;');
 def:=replace(def,$old$ when numbers then 'market_review'$old$,'');
 def:=replace(def,$old$'reviewed-market:'||st||':'||city_name$old$,$new$'inbound-address:screening:'||l.id$new$);
 execute def;

 def:=pg_get_functiondef('public.icash_assign_seller_lead_for(uuid)'::regprocedure);
 needle:=$old$if l.data_rights_until<=now() or not exists(select 1 from public.icash_seller_markets m where m.city=city_name and m.state=state_code and m.enabled and m.major_city and m.reviewed_until>now()) then$old$;
 if position(needle in def)=0 then raise exception 'Seller assignment data check changed';end if;
 def:=replace(def,needle,$new$if l.data_rights_until is null or l.data_rights_until<=now() or not exists(select 1 from public.icash_seller_controls where id=1 and enabled and data_rights_until>now() and length(coalesce(review_ref,''))>=10) then$new$);
 def:=replace(def,'Fresh property data or current market review required','Current data-use configuration required');
 execute def;
end $patch$;

-- Preserve historical records; stop target-city acquisition and queued scans.
update public.icash_seller_markets set enabled=false where enabled;
update public.icash_market_research_scopes set enabled=false where enabled;
update public.icash_market_research_jobs set state='held',next_attempt_at='infinity',updated_at=now() where state in ('pending','issued');
update public.icash_discovery_configs set auto_enabled=false where auto_enabled;

-- Fresh inbound research held only by the former city list can be distributed.
-- Do not replay a paid lookup, reprice an assignment, or touch uncertain work.
insert into public.icash_seller_events(lead_id,event_name,evidence_ref)
select id,'Lead','inbound-address:screening:'||id from public.icash_seller_intakes
where state='market_review' and numbers_passed and checked_at>now()-interval '24 hours'
and data_rights_until>now() and result->'financialCheck'->>'status'='eligible'
and (result->>'preliminarySellerCeilingCents')::bigint>0 on conflict do nothing;
update public.icash_seller_intakes set state='qualified',market_qualified=true,next_assignment_at=now(),hold_reason=null
where state='market_review' and numbers_passed and checked_at>now()-interval '24 hours'
and data_rights_until>now() and result->'financialCheck'->>'status'='eligible'
and (result->>'preliminarySellerCeilingCents')::bigint>0;
commit;
