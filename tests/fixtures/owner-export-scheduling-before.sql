CREATE OR REPLACE FUNCTION public.icash_next_acquisition()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_discovery_configs;j uuid;t public.icash_automation_tickets;backlog integer;allowance bigint;minimum_quote bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 perform public.icash_settle_pending_dealmachine();
 -- Expiry/exhaustion is terminal only for this exact proven-unstarted family.
 update public.icash_automation_tickets retry_ticket set outcome=case when owner_preview_deferrals>=8 then 'owner_preview_retry_exhausted' else 'owner_preview_expired' end
 where retry_ticket.kind='contacts' and retry_ticket.state='held' and retry_ticket.outcome='owner_preview_rate_limited'
 and (retry_ticket.owner_preview_deferrals>=8 or retry_ticket.owner_preview_retry_until<=clock_timestamp())
 and public.icash_owner_enrichment_unstarted(retry_ticket.account_id,retry_ticket.screening_id,'owners:'||retry_ticket.account_id||':'||retry_ticket.screening_id);
 update public.icash_automation_tickets set state='held',outcome='expired' where kind in ('contacts','discovery') and state='issued' and expires_at<=now();
 -- Leave other scheduler work available; billing and expiry checks above still run.
 if not public.icash_dealmachine_capacity_available() then return null;end if;
 for c in select d.* from public.icash_discovery_configs d join public.icash_accounts a on a.id=d.account_id join public.icash_wallets w on w.account_id=a.id
 where d.enabled and d.auto_enabled and d.next_run_at<=now() and d.data_rights_until>now() and not a.bot_paused and w.balance_cents>w.reserved_cents
 and not exists(select 1 from public.icash_automation_tickets x where x.account_id=a.id and ((x.state='issued' and x.expires_at>now()) or (x.state='consumed' and x.created_at>now()-interval '5 minutes')))
 order by
  (d.next_run_at<now()-interval '5 minutes') desc,
  case when d.next_run_at<now()-interval '5 minutes' then d.next_run_at end,
  coalesce((public.icash_daily_work_target(d.account_id)->>'priorityRatio')::numeric,1),
  d.next_run_at,d.account_id limit 5 for update of d skip locked loop
 perform public.icash_prepare_research_efficiency(c.account_id);
 select * into c from public.icash_discovery_configs where account_id=c.account_id;
 perform public.icash_refresh_opportunity_outcomes(c.account_id);
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
 j:=null;
 if c.contacts_enabled and c.contact_rate_id is not null then j:=public.icash_enrichment_candidate(c.account_id);end if;
 if j is not null then
 update public.icash_discovery_configs set next_run_at=now()+interval '5 seconds' where account_id=c.account_id;
 insert into public.icash_automation_tickets(account_id,kind,screening_id) values(c.account_id,'contacts',j)
 on conflict(screening_id) do update set token=gen_random_uuid()::text||gen_random_uuid()::text,state='issued',outcome=null,completed_at=null,created_at=now(),expires_at=least(now()+interval '2 minutes',coalesce(public.icash_automation_tickets.owner_preview_retry_until,now()+interval '2 minutes')),issue_attempts=case when public.icash_automation_tickets.outcome='owner_preview_rate_limited' then public.icash_automation_tickets.issue_attempts else public.icash_automation_tickets.issue_attempts+1 end
 returning * into t;
 return jsonb_build_object('token',t.token);
 end if;
 -- Provider capacity remains bounded while completed attempts free the queue.
 backlog:=public.icash_pending_opportunity_count(c.account_id);
 if c.exhausted or backlog>=c.max_open_prospects or not public.icash_outbound_search_due(c.account_id) then
  update public.icash_discovery_configs set next_run_at=now()+interval '60 seconds' where account_id=c.account_id;
  continue;
 end if;
 update public.icash_discovery_configs set next_run_at=now()+interval '5 seconds' where account_id=c.account_id;
 insert into public.icash_automation_tickets(account_id,kind) values(c.account_id,'discovery') returning * into t;
 return jsonb_build_object('token',t.token);
 end loop;
 return null;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_enrichment_candidate(p_account uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when public.icash_dealmachine_capacity_available() then public.icash_enrichment_before_provider_quota(p_account) else null::uuid end;
$function$;

CREATE OR REPLACE FUNCTION public.icash_resume_prospecting_ticket()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_automation_tickets;op text;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 for t in
  with waiting_accounts as materialized (
   select distinct account_id from public.icash_automation_tickets
   where state='held' and outcome='prospecting_budget_held' and expires_at<=now()
  ), allowances as materialized (
   select a.id,public.icash_prospecting_available(a.id) available
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
  select x.* from public.icash_automation_tickets x join outreach_priority a on a.id=x.account_id
  where x.state='held' and x.outcome='prospecting_budget_held' and x.expires_at<=now()
  and a.available>=x.prospecting_quote_cents
  and (x.kind<>'voice_dispatch' or exists(
   select 1 from public.icash_voice_jobs v
   join public.icash_voice_contact_targets current_target
    on current_target.id=coalesce(v.permission_id,v.operational_contact_id) and current_target.account_id=v.account_id
   where v.id=x.voice_job_id and v.account_id=x.account_id
    and ((v.permission_id is not null and v.operational_contact_id is null and current_target.eligibility_source='operator_record')
     or (v.permission_id is null and v.operational_contact_id is not null and current_target.eligibility_source='operational_checks_only'))
    and current_target.revoked_at is null and current_target.permission_until>now()
    and (public.icash_outreach_window_open(current_target.timezone,
     case when v.operational_contact_id is not null then (select timezone_basis from public.icash_operational_contacts
      where id=v.operational_contact_id and account_id=v.account_id and channel='voice') end,clock_timestamp()) or public.icash_owner_demo_call_current(v.account_id,v.id))
  ))
  and (x.kind not in ('contacts','discovery') or (public.icash_dealmachine_capacity_available() and not a.waiting_for_outreach))

  and (x.kind='discovery' or (
   x.kind in ('contacts','voice_dispatch','seller_opener','seller_recovery')
   and (x.kind<>'contacts' or x.screening_id is not null)
   and not exists(select 1 from public.icash_automation_tickets active
    where active.id<>x.id and active.account_id=x.account_id
     and ((active.state='issued' and active.expires_at>now())
      or (active.state='consumed' and active.created_at>now()-interval '5 minutes')))
   and (x.kind<>'voice_dispatch' or exists(select 1 from public.icash_voice_jobs v
    where v.id=x.voice_job_id and v.account_id=x.account_id and v.state='held' and v.outcome='prospecting_budget_held'
     and v.operation_key is null and v.conversation_id is null and v.provider_call_sid is null))
   and (x.kind not in ('seller_opener','seller_recovery') or exists(select 1 from public.icash_text_messages m
    where m.id=x.opener_message_id and m.account_id=x.account_id and m.state='ready' and m.provider_id is null and m.last_delivery_at is null))
   and not exists(select 1 from public.icash_operation_spend spent where spent.operation_key=case
    when x.kind='contacts' then 'owners:'||x.account_id||':'||x.screening_id
    when x.kind='voice_dispatch' then 'voice:'||x.voice_job_id else 'text:'||x.opener_message_id end)
   and not exists(select 1 from public.icash_live_conversations live where live.operation_key=case
    when x.kind='contacts' then 'owners:'||x.account_id||':'||x.screening_id
    when x.kind='voice_dispatch' then 'voice:'||x.voice_job_id else 'text:'||x.opener_message_id end)
  ))
  order by x.created_at limit 20 for update of x skip locked loop
  op:=null;
  if t.kind='contacts' then op:='owners:'||t.account_id||':'||t.screening_id;
  elsif t.kind='voice_dispatch' then
   op:='voice:'||t.voice_job_id;
   if not exists(select 1 from public.icash_voice_jobs where id=t.voice_job_id and account_id=t.account_id and state='held' and outcome='prospecting_budget_held' and operation_key is null and conversation_id is null and provider_call_sid is null) then continue;end if;
  elsif t.kind in ('seller_opener','seller_recovery') then
   op:='text:'||t.opener_message_id;
   if not exists(select 1 from public.icash_text_messages where id=t.opener_message_id and account_id=t.account_id and state='ready' and provider_id is null and last_delivery_at is null) then continue;end if;
  elsif t.kind='discovery' then
   -- A discovery page can move independently. Its scheduler handles the current
   -- revision; do not replay a stale page capability.
   update public.icash_automation_tickets set outcome='prospecting_budget_released' where id=t.id;
   perform public.icash_wake_funded_outreach(t.account_id);continue;
  end if;
  if op is null or exists(select 1 from public.icash_operation_spend where operation_key=op) or exists(select 1 from public.icash_live_conversations where operation_key=op) then continue;end if;
  if exists(select 1 from public.icash_automation_tickets x where x.id<>t.id and x.account_id=t.account_id and ((x.state='issued' and x.expires_at>now()) or (x.state='consumed' and x.created_at>now()-interval '5 minutes'))) then continue;end if;
  if t.kind='voice_dispatch' then update public.icash_voice_jobs set state='issued',outcome=null,updated_at=now() where id=t.voice_job_id;end if;
  update public.icash_automation_tickets set token=gen_random_uuid()::text||gen_random_uuid()::text,state='issued',outcome=null,completed_at=null,created_at=now(),expires_at=now()+interval '2 minutes' where id=t.id returning * into t;
  return jsonb_build_object('token',t.token);
 end loop;
 return null;
end $function$;
