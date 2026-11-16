CREATE OR REPLACE FUNCTION icash_work_private.live_owner_preflight_deadline(p_account uuid, p_screening uuid DEFAULT NULL::uuid)
 RETURNS timestamp with time zone
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
 with candidates as materialized (
  select p.id,p.account_id,p.items,p.state,p.checked_at,p.created_at,p.next_check_at
  from icash_research_private.owner_export_preflights p
  where p.account_id=p_account and (
   (p.state='waiting' and p.created_at>now()-interval '30 minutes' and p.created_at<=now()
    and p.next_check_at<=now() and p.deleted_at is null and p.cleanup_attempts=0)
   or (p.state='ready' and p.checked_at>now()-interval '30 minutes' and p.checked_at<=now()))
   and (p_screening is null or p.items->0->>'screeningId'=p_screening::text)
   and exists (
    select 1 from public.icash_screening_jobs s
    join public.icash_automation_tickets t on t.screening_id=s.id and t.account_id=s.account_id
    where s.id=(p.items->0->>'screeningId')::uuid and s.account_id=p.account_id
     and t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited'
     and t.owner_preview_deferrals between 1 and 7
     and t.owner_preview_retry_after<=now() and t.owner_preview_retry_until>now()
   )
 ), due as materialized (
  select p.id,p.account_id,p.items,p.state,p.checked_at,p.created_at,case when p.state='ready' then p.checked_at else p.next_check_at end next_check_at
  from candidates p
  where case when p.state='ready' then icash_research_private.owner_preflight_ready_current(p.id) else true end
   and icash_research_private.owner_preflight_list_known(p.id)
 )
 select min(least(
  (case when p.state='ready' then p.checked_at else p.created_at end)+interval '30 minutes',
  t.owner_preview_retry_until,s.completed_at+interval '24 hours',
  case when pg_catalog.pg_input_is_valid(s.snapshot->>'fetchedAt','timestamp with time zone')
   then (s.snapshot->>'fetchedAt')::timestamptz+interval '24 hours' end)) from due p
 join public.icash_screening_jobs s on s.id=(p.items->0->>'screeningId')::uuid and s.account_id=p.account_id
 join public.icash_automation_tickets t on t.screening_id=s.id and t.account_id=s.account_id
 where (public.icash_dealmachine_capacity_available(3,p_account) or (public.icash_dealmachine_capacity_available(2) and icash_work_private.owner_preflight_two_step_current(p.id)))
  and t.kind='contacts' and t.state='held' and t.outcome='owner_preview_rate_limited'
  and t.owner_preview_deferrals between 1 and 7
  and t.owner_preview_retry_after<=now() and t.owner_preview_retry_until>now()
  and t.owner_preview_screening_hash=public.icash_owner_enrichment_screening_hash(s)
  and public.icash_owner_enrichment_retry_current(s.account_id,s.id)
  and not exists(select 1 from public.icash_operation_spend o
   join public.icash_screening_jobs prior on o.operation_key='owners:'||s.account_id||':'||prior.id
   where prior.account_id=s.account_id and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId'
    and o.state in ('reserved','dispatched'))
  and p.items=icash_research_private.owner_preflight_cohort(s.account_id,s.id);
$function$
