-- Finish an existing, exactly bound free check before opening another cohort.
-- Ranking only: no new admission, retries, capability mutation or provider work.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

create function public.icash_owner_preflight_due_at(p_account uuid,p_screening uuid default null) returns timestamptz
language sql stable security definer set search_path='' as $$
 with due as materialized (
  select p.account_id,p.items,p.next_check_at from icash_research_private.owner_export_preflights p
  where p.account_id=p_account and p.state='waiting'
   and p.created_at>now()-interval '30 minutes' and p.created_at<=now()
   and p.next_check_at<=now() and p.deleted_at is null and p.cleanup_attempts=0
   and (p_screening is null or p.items->0->>'screeningId'=p_screening::text)
   and jsonb_typeof(p.list_id) in ('string','number') and (p.list_id#>>'{}') ~ '^[A-Za-z0-9_-]{1,100}$'
   and p.receipts->'create'->'httpStatus'='200'::jsonb
   and p.receipts->'create'->'raw'->'data'->'list_id'=p.list_id
   and p.receipts->'create'->'raw'->'data'->>'name'=p.list_name
   and p.receipts->'create'->'raw'->'data'->>'source_type'='people'
   and p.receipts->'create'->'raw'->'data'->>'status'='completed'
   and p.receipts->'create'->'raw'->'data'->'total_count'=to_jsonb(
    case when jsonb_typeof(p.request->'people_ids')='array' then jsonb_array_length(p.request->'people_ids') end)
 )
 select min(p.next_check_at) from due p
 join public.icash_screening_jobs s on s.id=(p.items->0->>'screeningId')::uuid and s.account_id=p.account_id
 join public.icash_automation_tickets t on t.screening_id=s.id and t.account_id=s.account_id
 where public.icash_dealmachine_capacity_available(3)
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
$$;
revoke all on function public.icash_owner_preflight_due_at(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_owner_preflight_due_at(uuid,uuid) to service_role;

do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 if md5(d)<>'3b14e47a834d90976a7902346482c84b' then raise exception 'Owner preflight account priority prerequisite changed';end if;
 needle:=$old$ order by
  (d.next_run_at<now()-interval '5 minutes') desc,$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner preflight account ordering changed';end if;
 execute replace(d,needle,$new$ order by
  -- Ordinary overdue accounts retain an aging escape from the due-list queue.
  case when d.next_run_at<now()-interval '10 minutes' then d.next_run_at end nulls last,
  case when d.contacts_enabled and d.contact_rate_id is not null
   and public.icash_owner_active_export_capacity() in ('disabled','ready')
   then public.icash_owner_preflight_due_at(d.account_id,null::uuid) end nulls last,
  (d.next_run_at<now()-interval '5 minutes') desc,$new$);
 d:=pg_get_functiondef('public.icash_enrichment_before_prospecting_budget(uuid)'::regprocedure);
 if md5(d)<>'30b3c424c4cd402907201872b757115c' then raise exception 'Owner preflight candidate priority prerequisite changed';end if;
 needle:=' order by public.icash_opportunity_score';
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner preflight candidate ordering changed';end if;
 execute replace(d,needle,' order by public.icash_owner_preflight_due_at(p_account,s.id) nulls last,public.icash_opportunity_score');
end $patch$;
commit;
