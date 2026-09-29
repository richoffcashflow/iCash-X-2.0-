-- Prioritize existing seller work and recover only provably unconsumed tickets.
alter table public.icash_discovery_configs add column max_open_prospects integer not null default 20 check(max_open_prospects between 1 and 100);
alter table public.icash_automation_tickets add column issue_attempts integer not null default 1 check(issue_attempts between 1 and 3);
create function public.icash_enrichment_candidate(p_account uuid) returns uuid language sql stable set search_path='' as $$
 select s.id from public.icash_screening_jobs s
 left join public.icash_automation_tickets t on t.screening_id=s.id
 where s.account_id=p_account and s.state='complete' and s.result->'financialCheck'->>'status'='eligible'
 and s.completed_at>now()-interval '24 hours'
 and not exists(select 1 from public.icash_property_controls pc where pc.account_id=s.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual)
 and not exists(select 1 from public.icash_owner_contacts oc join public.icash_screening_jobs prior on prior.id=oc.screening_id where oc.account_id=s.account_id and prior.snapshot->>'propertyId'=s.snapshot->>'propertyId' and oc.created_at>now()-interval '30 days')
 and (t.id is null or (t.kind='contacts' and t.state='held' and t.outcome='expired' and t.issue_attempts<3 and not exists(select 1 from public.icash_operation_spend o where o.operation_key='owners:'||s.account_id||':'||s.id)))
 order by s.completed_at,s.id limit 1;
$$;
create or replace function public.icash_next_acquisition() returns jsonb language plpgsql set search_path='' as $$
declare c public.icash_discovery_configs;j uuid;t public.icash_automation_tickets;backlog integer;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 update public.icash_automation_tickets set state='held',outcome='expired' where kind in ('contacts','discovery') and state='issued' and expires_at<=now();
 for c in select d.* from public.icash_discovery_configs d join public.icash_accounts a on a.id=d.account_id join public.icash_wallets w on w.account_id=a.id
 where d.enabled and d.auto_enabled and d.next_run_at<=now() and d.data_rights_until>now() and not a.bot_paused and w.balance_cents>w.reserved_cents
 and not exists(select 1 from public.icash_automation_tickets x where x.account_id=a.id and ((x.state='issued' and x.expires_at>now()) or (x.state='consumed' and x.created_at>now()-interval '5 minutes')))
 order by d.next_run_at,d.account_id limit 20 for update of d skip locked loop
 j:=null;
 if c.contacts_enabled and c.contact_rate_id is not null then j:=public.icash_enrichment_candidate(c.account_id);end if;
 if j is not null then
 update public.icash_discovery_configs set next_run_at=now()+interval '1 minute' where account_id=c.account_id;
 insert into public.icash_automation_tickets(account_id,kind,screening_id) values(c.account_id,'contacts',j)
 on conflict(screening_id) do update set token=gen_random_uuid()::text||gen_random_uuid()::text,state='issued',outcome=null,completed_at=null,created_at=now(),expires_at=now()+interval '2 minutes',issue_attempts=public.icash_automation_tickets.issue_attempts+1
 returning * into t;
 return jsonb_build_object('token',t.token);
 end if;
 -- Do not buy more records while the existing qualified queue needs attention.
 select count(*) into backlog from public.icash_screening_jobs s where s.account_id=c.account_id and
 (s.state in ('queued','running') or (s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '7 days'
 and not exists(select 1 from public.icash_live_conversations v where v.account_id=s.account_id and v.screening_id=s.id and v.state='complete')
 and not exists(select 1 from public.icash_deal_files d where d.account_id=s.account_id and d.screening_id=s.id)));
 update public.icash_discovery_configs set next_run_at=now()+make_interval(secs=>interval_seconds) where account_id=c.account_id;
 if c.exhausted or backlog>=c.max_open_prospects then continue;end if;
 insert into public.icash_automation_tickets(account_id,kind) values(c.account_id,'discovery') returning * into t;
 return jsonb_build_object('token',t.token);
 end loop;
 return null;
end $$;
-- Order the whole tenant's work before pagination, so contracts cannot disappear below new lookups.
create function public.icash_prioritized_work(p_account uuid,p_page integer default 0)
returns table(id uuid,state text,result jsonb,completed_at timestamptz) language sql stable set search_path='' as $$
 select s.id,s.state,s.result,s.completed_at from public.icash_screening_jobs s
 where s.account_id=p_account and s.state='complete' and p_page between 0 and 10000
 order by case
 when exists(select 1 from public.icash_handoffs h where h.account_id=p_account and h.screening_id=s.id and h.state<>'resolved')
 or exists(select 1 from public.icash_deal_files d join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id where d.account_id=p_account and d.screening_id=s.id and e.state='customer_signature_needed' and not e.test_mode) then 0
 when exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=s.id and d.stage in ('under_contract','buyer_selected','title_open','closing')) then 1
 when exists(select 1 from public.icash_live_callbacks b where b.account_id=p_account and b.screening_id=s.id and b.state in ('pending_dispatch_review','held_for_human','missed')) then 2
 when s.result->'financialCheck'->>'status'='eligible' then 3 else 4 end,
 s.completed_at desc,s.id limit 7 offset (greatest(0,least(10000,p_page))*6);
$$;
revoke all on function public.icash_enrichment_candidate(uuid),public.icash_prioritized_work(uuid,integer) from public,anon,authenticated;
grant execute on function public.icash_enrichment_candidate(uuid),public.icash_prioritized_work(uuid,integer) to service_role;
