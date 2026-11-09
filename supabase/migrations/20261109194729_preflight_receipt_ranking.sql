-- Rank only currently eligible retries before validating their saved receipts.
-- Preserve original proof, source, funding, capacity and final admission checks.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);

do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_owner_preflight_due_at(uuid,uuid)'::regprocedure);
 if md5(d)<>'cc338b5cd1ec538a1dffe5aa4bbdf167' then
  raise exception 'Preflight receipt ranking prerequisite changed';end if;
 needle:=$old$ with due as materialized (
  select p.account_id,p.items,case when p.state='ready' then p.checked_at else p.next_check_at end next_check_at from icash_research_private.owner_export_preflights p
  where p.account_id=p_account and (
   (p.state='waiting' and p.created_at>now()-interval '30 minutes' and p.created_at<=now()
    and p.next_check_at<=now() and p.deleted_at is null and p.cleanup_attempts=0)
   or (p.state='ready' and p.checked_at>now()-interval '30 minutes' and p.checked_at<=now()
    and icash_research_private.owner_preflight_ready_current(p.id)))
   and (p_screening is null or p.items->0->>'screeningId'=p_screening::text)
   and icash_research_private.owner_preflight_list_known(p.id)
 )$old$;
 replacement:=$new$ with candidates as materialized (
  select p.id,p.account_id,p.items,p.state,p.checked_at,p.next_check_at
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
  select p.account_id,p.items,case when p.state='ready' then p.checked_at else p.next_check_at end next_check_at
  from candidates p
  where case when p.state='ready' then icash_research_private.owner_preflight_ready_current(p.id) else true end
   and icash_research_private.owner_preflight_list_known(p.id)
 )$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Preflight receipt ranking body changed';end if;
 execute replace(d,needle,replacement);
end $patch$;
commit;
