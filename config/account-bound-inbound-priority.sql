-- Only an intake that can be assigned to this account may delay its research.
-- Preserve existing source ownership, receipt requirements and assignment limits.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_search_due_before_prospecting_budget(uuid)'::regprocedure);
 needle:=' and public.icash_research_state_allowed(l.property->>''state'')';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Inbound research priority prerequisite changed';end if;
 d:=replace(d,needle,needle||$new$
 and exists(select 1 from public.icash_seller_controls where id=1 and enabled and data_rights_until>now() and length(coalesce(review_ref,''))>=10)
 and l.contact_consent_scope is distinct from 'meta_direct_principal'
 and (l.contact_consent_scope is distinct from 'icash_x_demo' or l.attribution->>'demoAccountId'=p_account::text)
 and (not exists(select 1 from public.icash_meta_leads ml where ml.lead_id=l.id)
  or exists(select 1 from public.icash_meta_leads ml join public.icash_seller_matches sm
   on sm.lead_id=ml.lead_id and sm.account_id=ml.account_id and sm.screening_id=ml.screening_id
   where ml.lead_id=l.id and public.icash_meta_pool_receipt_current(ml.lead_id)))
 and (l.numbers_passed or not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id))$new$);
 needle:='and (select count(*) from public.icash_seller_matches m where m.lead_id=l.id)<3';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Inbound assignment limit prerequisite changed';end if;
 execute replace(d,needle,'and (select count(*) from public.icash_seller_matches m where m.lead_id=l.id)<case when l.contact_consent_scope=''icash_x_demo'' then 1 else 3 end');
end $patch$;
commit;
