alter table public.icash_discovery_configs add column auto_enabled boolean not null default false,
 add column next_run_at timestamptz not null default now(),
 add column interval_seconds integer not null default 900 check(interval_seconds between 300 and 86400),
 add column contacts_enabled boolean not null default false,
 add column contact_rate_id uuid references public.icash_operation_rates(id),
 add column contact_credit_cap integer not null default 5 check(contact_credit_cap between 1 and 25);
create table public.icash_automation_tickets (
 id uuid primary key default gen_random_uuid(), token text not null unique default (gen_random_uuid()::text||gen_random_uuid()::text),
 account_id uuid not null references public.icash_accounts(id),kind text not null check(kind in ('discovery','contacts')),
 screening_id uuid references public.icash_screening_jobs(id),
 state text not null default 'issued' check(state in ('issued','consumed','complete','held')),
 expires_at timestamptz not null default now()+interval '2 minutes',created_at timestamptz not null default now(),
 completed_at timestamptz, outcome text,
 unique(screening_id)
);
create index icash_automation_account on public.icash_automation_tickets(account_id,created_at desc);
create table public.icash_owner_contacts (
 screening_id uuid primary key references public.icash_screening_jobs(id),account_id uuid not null references public.icash_accounts(id),
 operation_key text not null unique references public.icash_operation_spend(operation_key),
 result jsonb not null,created_at timestamptz not null default now()
);
create index icash_owner_contacts_account on public.icash_owner_contacts(account_id,created_at desc);
alter table public.icash_automation_tickets enable row level security;
alter table public.icash_owner_contacts enable row level security;
revoke all on public.icash_automation_tickets,public.icash_owner_contacts from public,anon,authenticated;
grant all on public.icash_automation_tickets,public.icash_owner_contacts to service_role;
create function public.icash_next_automation() returns jsonb
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
 and (not d.exhausted or (d.contacts_enabled and exists(select 1 from public.icash_screening_jobs s where s.account_id=a.id and s.state='complete' and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '24 hours' and not exists(select 1 from public.icash_automation_tickets t2 where t2.screening_id=s.id))))
 order by d.next_run_at,d.account_id for update of d skip locked limit 1;
 if not found then return null;end if;
 if c.contacts_enabled and c.contact_rate_id is not null then
  select s.id into j from public.icash_screening_jobs s where s.account_id=c.account_id and s.state='complete'
  and s.result->'financialCheck'->>'status'='eligible' and s.completed_at>now()-interval '24 hours'
  and not exists(select 1 from public.icash_automation_tickets x where x.screening_id=s.id)
  order by s.completed_at limit 1;
 end if;
 update public.icash_discovery_configs set next_run_at=now()+make_interval(secs=>interval_seconds) where account_id=c.account_id;
 if j is null and c.exhausted then return null;end if;
 insert into public.icash_automation_tickets(account_id,kind,screening_id) values(c.account_id,case when j is null then 'discovery' else 'contacts' end,j) returning * into t;
 return jsonb_build_object('token',t.token);
end $$;
create function public.icash_consume_automation(p_token text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t public.icash_automation_tickets;
begin
 update public.icash_automation_tickets set state='consumed' where token=p_token and state='issued' and expires_at>now() returning * into t;
 if not found then return null;end if;
 return jsonb_build_object('id',t.id,'accountId',t.account_id,'kind',t.kind,'screeningId',t.screening_id);
end $$;
create function public.icash_finish_automation(p_id uuid,p_success boolean,p_outcome text) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if length(p_outcome)>100 then raise exception 'Outcome too long';end if;
 update public.icash_automation_tickets set state=case when p_success then 'complete' else 'held' end,outcome=p_outcome,completed_at=now() where id=p_id and state='consumed';
end $$;
create function public.icash_save_contacts(p_account uuid,p_screening uuid,p_operation text,p_result jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.icash_operation_spend; prior jsonb; used bigint;
begin
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.account_id<>p_account or o.state<>'dispatched' then raise exception 'Dispatched enrichment required';end if;
 if not exists(select 1 from public.icash_screening_jobs where id=p_screening and account_id=p_account and state='complete') then raise exception 'Tenant screening required';end if;
 select result into prior from public.icash_owner_contacts where screening_id=p_screening;
 if found then if prior<>p_result then raise exception 'Contact result conflict';end if;return;end if;
 used:=(p_result->>'creditsUsed')::bigint;
 if used is null or used<0 or jsonb_typeof(p_result->'contacts') is distinct from 'array' or octet_length(p_result::text)>262144 then raise exception 'Invalid contact result';end if;
 perform public.icash_record_cost_observation('dealmachine',p_operation,'dealmachine:owners:'||p_operation,used,'provider_credits');
 insert into public.icash_owner_contacts(screening_id,account_id,operation_key,result) values(p_screening,p_account,p_operation,p_result);
 if used>(select contact_credit_cap from public.icash_discovery_configs where account_id=p_account) then
 update public.icash_discovery_configs set contacts_enabled=false where account_id=p_account;
 end if;
end $$;
revoke all on function public.icash_next_automation(),public.icash_consume_automation(text),public.icash_finish_automation(uuid,boolean,text),public.icash_save_contacts(uuid,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_next_automation(),public.icash_consume_automation(text),public.icash_finish_automation(uuid,boolean,text),public.icash_save_contacts(uuid,uuid,text,jsonb) to service_role;
