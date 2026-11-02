-- Original installed candidate selector captured read-only on 2026-11-02.
CREATE OR REPLACE FUNCTION public.icash_enrichment_before_prospecting_budget(p_account uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select s.id from public.icash_screening_jobs s
 left join public.icash_automation_tickets t on t.screening_id=s.id
 where s.account_id=p_account and not public.icash_owner_preflight_sibling_waiting(s.account_id,s.id,s.snapshot,s.id) and not public.icash_owner_preflight_empty(s.account_id,s.id,s.snapshot) and s.state='complete' and s.snapshot->>'propertyType'='house' and s.snapshot->'sellerRequest' is null and public.icash_research_state_allowed(s.snapshot->'raw'->'data'->>'state') and s.result->'financialCheck'->>'status'='eligible'
 and s.completed_at>now()-interval '24 hours'
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=s.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 and not exists(select 1 from public.icash_owner_contacts oc join public.icash_screening_jobs prior on prior.id=oc.screening_id where oc.account_id=s.account_id and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId' and oc.created_at>now()-interval '30 days')
 and (t.id is null or (((t.kind='contacts' and t.state='held' and t.outcome='expired' and t.issue_attempts<3 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||s.account_id||':'||s.id))
  or (t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited' and t.owner_preview_deferrals>0))
 and (t.owner_preview_deferrals=0 or (t.account_id=s.account_id
  and t.owner_preview_deferrals between 1 and 7 and t.owner_preview_retry_after<=clock_timestamp()
  and t.owner_preview_retry_until>clock_timestamp()
  and t.owner_preview_screening_hash=public.icash_owner_enrichment_screening_hash(s)
  and public.icash_owner_enrichment_retry_current(s.account_id,s.id)))))
 order by public.icash_opportunity_score(p_account,s.result,left(s.snapshot->'raw'->'data'->>'zip',5)) desc,s.completed_at,s.id limit 1;
$function$

