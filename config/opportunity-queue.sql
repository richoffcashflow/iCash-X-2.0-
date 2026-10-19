-- Bounded pending work, not daily record counts, determines discovery demand.
begin;
set local lock_timeout='5s';
alter table public.icash_discovery_configs drop constraint icash_discovery_configs_interval_seconds_check;
alter table public.icash_discovery_configs add constraint icash_discovery_configs_interval_seconds_check check(interval_seconds between 60 and 86400);
alter table public.icash_discovery_configs alter column interval_seconds set default 60;

create function public.icash_pending_opportunity_count(p_account uuid) returns integer
language sql stable security invoker set search_path='' as $$
 select count(*)::integer from public.icash_screening_jobs s
 left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
 where s.account_id=p_account and s.created_at>now()-interval '24 hours'
 and (s.state in ('queued','running') or (s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
  and not coalesce(o.attempted,false) and not coalesce(o.responded,false) and not coalesce(o.opted_out,false)
  and not exists(select 1 from public.icash_property_controls c where c.account_id=s.account_id and c.property_id=s.snapshot->>'propertyId' and c.manual)
  and not exists(select 1 from public.icash_owner_contacts c where c.account_id=s.account_id and c.screening_id=s.id and jsonb_array_length(coalesce(c.result->'contacts','[]'::jsonb))=0)
  and not exists(select 1 from public.icash_deal_files d where d.account_id=s.account_id and d.screening_id=s.id and d.stage in ('closed','cancelled','cancellation_pending','under_contract','purchase_signed','buyer_selected','assigned','title_open','closing'))));
$$;

-- Retry only billing against an already saved receipt. Never repeat a provider call.
create function public.icash_settle_pending_dealmachine() returns integer
language plpgsql security invoker set search_path='' as $$
declare item record;n integer:=0;
begin
 for item in select operation_key from public.icash_operation_spend where state='dispatched' and dealmachine_cost_multiplier is not null order by dispatched_at desc limit 20 loop
  begin
   if public.icash_settle_dealmachine_usage(item.operation_key) then n:=n+1;end if;
  exception when raise_exception then null; -- Conflicting evidence stays held for reconciliation.
  end;
 end loop;
 return n;
end $$;
revoke all on function public.icash_pending_opportunity_count(uuid),public.icash_settle_pending_dealmachine() from public,anon,authenticated;
grant execute on function public.icash_pending_opportunity_count(uuid),public.icash_settle_pending_dealmachine() to service_role;
CREATE OR REPLACE FUNCTION public.icash_outbound_search_due(p_account uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare a public.icash_accounts;c public.icash_discovery_configs;policy public.icash_acquisition_policy;capacity bigint;research_spend bigint;cost bigint;target integer;pending_count integer;profile jsonb;
begin
 select * into policy from public.icash_acquisition_policy where id=1;
 if not found or policy.mode='inbound' then return false;end if;
 select * into a from public.icash_accounts where id=p_account;
 if not found or a.bot_paused or not public.icash_membership_work_allowed(p_account) then return false;end if;
 select * into c from public.icash_discovery_configs where account_id=p_account;
 if not found or not c.enabled or not c.auto_enabled or c.exhausted or c.data_rights_until<=now() or not public.icash_research_zip_known(c.zip) then return false;end if;
 if exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null) then return false;end if;
 select charge_cents into cost from public.icash_operation_rates where id=c.rate_id and enabled and expires_at>now() and operation='property_search';
 if cost is null then return false;end if;
 select w.balance_cents into capacity from public.icash_wallets w where account_id=p_account;
 if capacity is null or capacity<=0 then return false;end if;
 if exists(select 1 from public.icash_screening_jobs s where s.account_id=p_account and s.state in ('queued','running') and s.created_at>now()-interval '1 day') then return false;end if;
 if policy.mode='outbound' then return public.icash_pending_opportunity_count(p_account)<c.max_open_prospects;end if;
 select bs.profile into profile from public.icash_bot_setups bs where account_id=p_account;
 -- Let an affordable, due inbound request be delivered before buying a page.
 if public.icash_credit_acquisition_allowed(p_account) and exists(select 1 from public.icash_seller_intakes l where l.state in ('qualified','assigned') and l.next_assignment_at<=now() and l.data_rights_until>now() and l.checked_at>now()-interval '8 days'
 and public.icash_research_state_allowed(l.property->>'state') and (profile->>'marketMode'='nationwide' or lower(trim(profile->>'market')) in (lower(l.property->>'city'),lower(l.property->>'city')||', '||lower(l.property->>'state'),l.property->>'zip'))
 and not exists(select 1 from public.icash_seller_matches m where m.lead_id=l.id and m.account_id=p_account)
 and (select count(*) from public.icash_seller_matches m where m.lead_id=l.id)<3
 and not exists(select 1 from public.icash_text_suppressions s where s.phone=l.phone)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_live_conversations lc on lc.account_id=sm.account_id and lc.screening_id=sm.screening_id join public.icash_contact_suppressions cs on cs.account_id=lc.account_id and cs.contact_key=lc.contact_key where sm.lead_id=l.id)
 and not exists(select 1 from public.icash_seller_matches sm join public.icash_deal_files d on d.account_id=sm.account_id and d.screening_id=sm.screening_id join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id and e.kind='purchase' and not e.test_mode and e.state='completed' where sm.lead_id=l.id)
 and (select public.icash_seller_assignment_due(count(*)::integer,min(m.assigned_at),max(m.assigned_at)) from public.icash_seller_matches m where m.lead_id=l.id)<=now()
 and not exists(select 1 from public.icash_outbound_property_owners o where o.property_id=l.property->>'id' and o.account_id<>p_account)
 and ceil(ceil((select sum(value::numeric) from jsonb_each_text(coalesce(l.customer_costs,case when public.icash_seller_acquisition_quote(l.id) is not null then l.lookup_costs||jsonb_build_object('acquisition',(public.icash_seller_acquisition_quote(l.id)->>'costMicros')::bigint) end)))*coalesce(l.customer_lead_multiplier,case when l.customer_costs is not null then 3 else 2 end)/10000)*case when public.icash_vip_active(p_account) then 0.8 else 1 end)<=capacity) then return false;end if;
 -- Keep a bounded buffer of fresh, unattempted work. Failed connections and
 -- real responses remain in history without consuming the discovery buffer.
 target:=c.max_open_prospects;
 pending_count:=public.icash_pending_opportunity_count(p_account);
 return pending_count<target;
end $function$;
CREATE OR REPLACE FUNCTION public.icash_next_acquisition()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare c public.icash_discovery_configs;j uuid;t public.icash_automation_tickets;backlog integer;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 perform public.icash_settle_pending_dealmachine();
 update public.icash_automation_tickets set state='held',outcome='expired' where kind in ('contacts','discovery') and state='issued' and expires_at<=now();
 for c in select d.* from public.icash_discovery_configs d join public.icash_accounts a on a.id=d.account_id join public.icash_wallets w on w.account_id=a.id
 where d.enabled and d.auto_enabled and d.next_run_at<=now() and d.data_rights_until>now() and not a.bot_paused and w.balance_cents>w.reserved_cents
 and not exists(select 1 from public.icash_automation_tickets x where x.account_id=a.id and ((x.state='issued' and x.expires_at>now()) or (x.state='consumed' and x.created_at>now()-interval '5 minutes')))
 order by d.next_run_at,d.account_id limit 20 for update of d skip locked loop
 perform public.icash_refresh_opportunity_outcomes(c.account_id);
 j:=null;
 if c.contacts_enabled and c.contact_rate_id is not null then j:=public.icash_enrichment_candidate(c.account_id);end if;
 if j is not null then
 update public.icash_discovery_configs set next_run_at=now()+interval '5 seconds' where account_id=c.account_id;
 insert into public.icash_automation_tickets(account_id,kind,screening_id) values(c.account_id,'contacts',j)
 on conflict(screening_id) do update set token=gen_random_uuid()::text||gen_random_uuid()::text,state='issued',outcome=null,completed_at=null,created_at=now(),expires_at=now()+interval '2 minutes',issue_attempts=public.icash_automation_tickets.issue_attempts+1
 returning * into t;
 return jsonb_build_object('token',t.token);
 end if;
 -- Provider capacity remains bounded while completed attempts free the queue.
 backlog:=public.icash_pending_opportunity_count(c.account_id);
 update public.icash_discovery_configs set next_run_at=now()+make_interval(secs=>least(interval_seconds,60)) where account_id=c.account_id;
 if c.exhausted or backlog>=c.max_open_prospects or not public.icash_outbound_search_due(c.account_id) then continue;end if;
 insert into public.icash_automation_tickets(account_id,kind) values(c.account_id,'discovery') returning * into t;
 return jsonb_build_object('token',t.token);
 end loop;
 return null;
end $function$;
commit;
