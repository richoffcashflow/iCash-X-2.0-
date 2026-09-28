create table public.icash_property_controls (
 account_id uuid not null references public.icash_accounts(id),property_id text not null,
 manual boolean not null default true,updated_at timestamptz not null default now(),primary key(account_id,property_id)
);
create table public.icash_control_events (
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 actor_user_id uuid not null,action text not null,property_id text,created_at timestamptz not null default now()
);
alter table public.icash_property_controls enable row level security;
alter table public.icash_control_events enable row level security;
revoke all on public.icash_property_controls,public.icash_control_events from public,anon,authenticated;
grant all on public.icash_property_controls,public.icash_control_events to service_role;
create function public.icash_set_work_control(p_user uuid,p_account uuid,p_action text,p_screening uuid default null) returns void
language plpgsql security invoker set search_path='' as $$
declare prop text;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then raise exception 'Account ownership required';end if;
 if p_action in ('pause','resume') then
 update public.icash_accounts set bot_paused=(p_action='pause') where id=p_account;
 elsif p_action in ('takeover','return_to_bot') then
 select snapshot->>'propertyId' into prop from public.icash_screening_jobs where id=p_screening and account_id=p_account;
 if prop is null then raise exception 'Property missing';end if;
 insert into public.icash_property_controls(account_id,property_id,manual) values(p_account,prop,p_action='takeover')
 on conflict(account_id,property_id) do update set manual=excluded.manual,updated_at=now();
 else raise exception 'Invalid control';end if;
 insert into public.icash_control_events(account_id,actor_user_id,action,property_id) values(p_account,p_user,p_action,prop);
end $$;
revoke all on function public.icash_set_work_control(uuid,uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.icash_set_work_control(uuid,uuid,text,uuid) to service_role;

create or replace function public.icash_next_automation() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.icash_discovery_configs; j uuid; t public.icash_automation_tickets;
begin
 -- Serialize dispatch selection across replicas; budgets remain enforced again at provider dispatch.
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 -- Expired unconsumed tickets never authorize later work. Consumed tickets are never retried here.
 update public.icash_automation_tickets set state='held',outcome='expired' where state='issued' and expires_at<=now();
 select d.* into c from public.icash_discovery_configs d
 join public.icash_accounts a on a.id=d.account_id
 join public.icash_wallets w on w.account_id=a.id
 where d.enabled and d.auto_enabled and d.next_run_at<=now() and d.data_rights_until>now()
 and not a.bot_paused and w.balance_cents>w.reserved_cents
 and not exists(select 1 from public.icash_automation_tickets x where x.account_id=a.id and (x.state='issued' or (x.state='consumed' and x.created_at>now()-interval '5 minutes')))
 and (not d.exhausted or (d.contacts_enabled and exists(select 1 from public.icash_screening_jobs s where s.account_id=a.id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and not exists(select 1 from public.icash_property_controls pc where pc.account_id=s.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual) and s.completed_at>now()-interval '24 hours' and not exists(select 1 from public.icash_automation_tickets t2 where t2.screening_id=s.id))))
 order by d.next_run_at,d.account_id for update of d skip locked limit 1;
 if not found then return null;end if;
 if c.contacts_enabled and c.contact_rate_id is not null then
  select s.id into j from public.icash_screening_jobs s where s.account_id=c.account_id and s.state='complete'
  and s.result->'financialCheck'->>'status'='eligible' and not exists(select 1 from public.icash_property_controls pc where pc.account_id=s.account_id and pc.property_id=s.snapshot->>'propertyId' and pc.manual) and s.completed_at>now()-interval '24 hours'
  and not exists(select 1 from public.icash_automation_tickets x where x.screening_id=s.id)
  order by s.completed_at limit 1;
 end if;
 update public.icash_discovery_configs set next_run_at=now()+make_interval(secs=>interval_seconds) where account_id=c.account_id;
 if j is null and c.exhausted then return null;end if;
 insert into public.icash_automation_tickets(account_id,kind,screening_id) values(c.account_id,case when j is null then 'discovery' else 'contacts' end,j) returning * into t;
 return jsonb_build_object('token',t.token);
end $$;
