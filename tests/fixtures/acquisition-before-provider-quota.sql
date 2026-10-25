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
 for c in select d.* from public.icash_discovery_configs d join public.icash_accounts a on a.id=d.account_id join public.icash_wallets w on w.account_id=a.id
 where d.enabled and d.auto_enabled and d.next_run_at<=now() and d.data_rights_until>now() and not a.bot_paused and w.balance_cents>w.reserved_cents
 and not exists(select 1 from public.icash_automation_tickets x where x.account_id=a.id and ((x.state='issued' and x.expires_at>now()) or (x.state='consumed' and x.created_at>now()-interval '5 minutes')))
 order by
  (d.next_run_at<now()-interval '5 minutes') desc,
  case when d.next_run_at<now()-interval '5 minutes' then d.next_run_at end,
  coalesce((public.icash_daily_work_target(d.account_id)->>'priorityRatio')::numeric,1),
  d.next_run_at,d.account_id limit 5 for update of d skip locked loop
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
 update public.icash_discovery_configs set next_run_at=now()+case when allowance>0 then interval '5 seconds' else interval '60 seconds' end where account_id=c.account_id;
 if c.exhausted or backlog>=c.max_open_prospects or not public.icash_outbound_search_due(c.account_id) then continue;end if;
 insert into public.icash_automation_tickets(account_id,kind) values(c.account_id,'discovery') returning * into t;
 return jsonb_build_object('token',t.token);
 end loop;
 return null;
end $function$;
