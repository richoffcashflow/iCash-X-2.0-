-- Evaluate the same account allowance once for a batch of parked tickets.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;old_query text:=$old$for t in select x.* from public.icash_automation_tickets x join public.icash_accounts a on a.id=x.account_id
  where x.state='held' and x.outcome='prospecting_budget_held' and x.expires_at<=now() and not a.bot_paused
  and public.icash_membership_work_allowed(a.id) and public.icash_prospecting_available(a.id)>=x.prospecting_quote_cents
  and (x.kind not in ('contacts','discovery') or not public.icash_research_waiting_on_outreach(x.account_id))
  order by x.created_at limit 20 for update of x skip locked loop$old$;
begin
 d:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 if position(old_query in d)=0 then raise exception 'Prospecting ticket selection changed';end if;
 execute replace(d,old_query,$new$for t in
  with waiting_accounts as materialized (
   select distinct account_id from public.icash_automation_tickets
   where state='held' and outcome='prospecting_budget_held' and expires_at<=now()
  ), allowances as materialized (
   select a.id,public.icash_prospecting_available(a.id) available,
    public.icash_research_waiting_on_outreach(a.id) waiting_for_outreach
   from public.icash_accounts a join waiting_accounts w on w.account_id=a.id
   where not a.bot_paused and public.icash_membership_work_allowed(a.id)
  )
  select x.* from public.icash_automation_tickets x join allowances a on a.id=x.account_id
  where x.state='held' and x.outcome='prospecting_budget_held' and x.expires_at<=now()
  and a.available>=x.prospecting_quote_cents
  and (x.kind not in ('contacts','discovery') or not a.waiting_for_outreach)
  order by x.created_at limit 20 for update of x skip locked loop$new$);
end $patch$;
commit;
