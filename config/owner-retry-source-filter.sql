-- Filter stale retry sources before shared-cohort and same-property history proof. Preserve every original
-- eligibility predicate, ordering, one-use claim and financial/receipt gate.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $guard$begin
 if md5(pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure))<>'d662482464f80518334ab92987a8084e' then
  raise exception 'Owner retry selector changed; review before installing source filtering';
 end if;
end $guard$;
CREATE OR REPLACE FUNCTION public.icash_enrichment_before_prospecting_budget(p_account uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 with source_candidates as materialized (
 select s as screening,t as ticket from public.icash_screening_jobs s
 left join public.icash_automation_tickets t on t.screening_id=s.id
 where s.account_id=p_account and s.state='complete' and s.snapshot->>'propertyType'='house' and s.snapshot->'sellerRequest' is null and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state') and s.result->'financialCheck'->>'status'='eligible'
 and s.completed_at>now()-interval '24 hours'
 and (t.id is null or (((t.kind='contacts' and t.state='held' and t.outcome='expired' and t.issue_attempts<3 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||s.account_id||':'||s.id))
  or (t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited' and t.owner_preview_deferrals>0))
 and (t.owner_preview_deferrals=0 or (t.account_id=s.account_id
  and t.owner_preview_deferrals between 1 and 7 and t.owner_preview_retry_after<=clock_timestamp()
  and t.owner_preview_retry_until>clock_timestamp()
  and case when t.owner_preview_screening_hash=public.icash_owner_enrichment_screening_hash(s)
   then public.icash_owner_enrichment_retry_current(s.account_id,s.id) else false end))))

 )
 select (c.screening).id from source_candidates c
 where not exists(select 1 from public.icash_property_controls pc where pc.account_id=(c.screening).account_id and pc.property_id=(c.screening).snapshot->>'propertyId' and pc.manual)
 and not exists(select 1 from public.icash_owner_contacts oc join public.icash_screening_jobs prior on prior.id=oc.screening_id where oc.account_id=(c.screening).account_id and prior.snapshot->>'propertyId'=(c.screening).snapshot->>'propertyId' and oc.created_at>now()-interval '30 days')

 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||(c.screening).account_id||':'||(c.screening).id)
 and not exists(select 1 from public.icash_operation_spend o
  join public.icash_screening_jobs prior on o.operation_key='owners:'||(c.screening).account_id||':'||prior.id
  where prior.account_id=(c.screening).account_id and prior.snapshot->>'propertyId'=(c.screening).snapshot->>'propertyId'
   and o.state in ('reserved','dispatched'))
 and not public.icash_owner_preflight_sibling_waiting((c.screening).account_id,(c.screening).id,(c.screening).snapshot,(c.screening).id) and not public.icash_owner_preflight_empty((c.screening).account_id,(c.screening).id,(c.screening).snapshot) order by public.icash_owner_preflight_due_at(p_account,(c.screening).id) nulls last,
  case when (c.ticket).kind='contacts' and (c.ticket).state='held' and (c.ticket).outcome='owner_preview_rate_limited'
   and (c.ticket).owner_preview_deferrals between 1 and 7 and (c.ticket).owner_preview_retry_after<=now() and (c.ticket).owner_preview_retry_until>now()
   then (c.ticket).owner_preview_retry_after end nulls last,public.icash_opportunity_score(p_account,(c.screening).result,left((c.screening).snapshot->'raw'->'data'->>'zip',5)) desc,(c.screening).completed_at,(c.screening).id limit 1;
$function$;

commit;
