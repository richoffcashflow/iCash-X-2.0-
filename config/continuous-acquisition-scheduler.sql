-- Bound time spent selecting new work under the shared operating-budget lock.
-- Existing recipient, quote, wallet, unknown-outcome and final admission gates
-- still execute before any new provider action. Funding retains its wake path.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;
 old_declare text:='declare c public.icash_discovery_configs;j uuid;t public.icash_automation_tickets;backlog integer;';
 old_batch text:='d.next_run_at,d.account_id limit 20 for update of d skip locked loop';
 old_entry text:=$entry$ perform public.icash_refresh_opportunity_outcomes(c.account_id);
 j:=null;$entry$;
 old_delay text:=$delay$now()+case when public.icash_prospecting_available(c.account_id)>0 then interval '5 seconds' else interval '60 seconds' end$delay$;
begin
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 if md5(d)<>'2c67841e283c3f724c3c5bba57d65b93' or position(old_entry in d)=0 or position(old_batch in d)=0 or position(old_declare in d)=0 or position(old_delay in d)=0 then
  raise exception 'Acquisition scheduler prerequisite changed';
 end if;
 d:=replace(d,old_declare,old_declare||'allowance bigint;minimum_quote bigint;');
 d:=replace(d,old_batch,'d.next_run_at,d.account_id limit 5 for update of d skip locked loop');
 d:=replace(d,old_entry,$entry$ perform public.icash_refresh_opportunity_outcomes(c.account_id);
 allowance:=public.icash_prospecting_available(c.account_id);
 select min(quote) into minimum_quote from (
  select public.icash_research_admission_quote(c.account_id,'property_search',r.charge_cents) quote
   from public.icash_operation_rates r where r.id=c.rate_id
  union all
  select public.icash_research_admission_quote(c.account_id,'owner_enrichment',r.charge_cents)
   from public.icash_operation_rates r where c.contacts_enabled and r.id=c.contact_rate_id
 ) quotes;
 if minimum_quote is null or allowance<minimum_quote then
  update public.icash_discovery_configs set next_run_at=now()+interval '60 seconds' where account_id=c.account_id;
  continue;
 end if;
 j:=null;$entry$);
 execute replace(d,old_delay,$delay$now()+case when allowance>0 then interval '5 seconds' else interval '60 seconds' end$delay$);
end $patch$;

-- Parked, unaffordable tickets do not need an expensive outreach-priority scan.
-- Compute that scan once per account only when a research ticket can fit.
do $patch$
declare d text;
 old_allowances text:=$old$   select a.id,public.icash_prospecting_available(a.id) available,
    public.icash_research_waiting_on_outreach(a.id) waiting_for_outreach
   from public.icash_accounts a join waiting_accounts w on w.account_id=a.id
   where not a.bot_paused and public.icash_membership_work_allowed(a.id)
  )
  select x.* from public.icash_automation_tickets x join allowances a on a.id=x.account_id$old$;
begin
 d:=pg_get_functiondef('public.icash_resume_prospecting_ticket()'::regprocedure);
 if (length(d)-length(replace(d,old_allowances,'')))<>length(old_allowances) then
  raise exception 'Parked ticket scheduler prerequisite changed';
 end if;
 execute replace(d,old_allowances,$new$   select a.id,public.icash_prospecting_available(a.id) available
   from public.icash_accounts a join waiting_accounts w on w.account_id=a.id
   where not a.bot_paused and public.icash_membership_work_allowed(a.id)
  ), outreach_priority as materialized (
   select a.*,case when exists(
    select 1 from public.icash_automation_tickets pending where pending.account_id=a.id
     and pending.state='held' and pending.outcome='prospecting_budget_held' and pending.expires_at<=now()
     and pending.kind in ('contacts','discovery') and a.available>=pending.prospecting_quote_cents
   ) then public.icash_research_waiting_on_outreach(a.id) else false end waiting_for_outreach
   from allowances a
  )
  select x.* from public.icash_automation_tickets x join outreach_priority a on a.id=x.account_id$new$);
end $patch$;
commit;
