-- A fixed prospecting allowance per verified funding event. This authorizes
-- bounded work; it never removes a maximum quote from the customer's wallet.
begin;
set local lock_timeout='5s';
create table public.icash_prospecting_budgets(
 id bigint generated always as identity primary key,
 account_id uuid not null references public.icash_accounts(id),
 funding_event text not null unique,
 baseline_cents bigint not null check(baseline_cents>0),
 limit_cents bigint generated always as (baseline_cents/2) stored,
 created_at timestamptz not null default now()
);
create index icash_prospecting_budget_current on public.icash_prospecting_budgets(account_id,id desc);
alter table public.icash_prospecting_budgets enable row level security;
revoke all on public.icash_prospecting_budgets from public,anon,authenticated;
grant select,insert on public.icash_prospecting_budgets to service_role;
grant usage,select on sequence public.icash_prospecting_budgets_id_seq to service_role;
alter table public.icash_operation_spend add column prospecting_budget_id bigint references public.icash_prospecting_budgets(id);
create index icash_prospecting_spend on public.icash_operation_spend(account_id,prospecting_budget_id,state) where prospecting_budget_id is not null;
alter table public.icash_automation_tickets add column prospecting_quote_cents bigint check(prospecting_quote_cents>0);

create function public.icash_new_prospect_operation(p_account uuid,p_operation text,p_rate uuid) returns boolean
language plpgsql stable set search_path='' as $$
declare kind text;screen uuid;
begin
 select operation into kind from public.icash_operation_rates where id=p_rate;
 if kind in ('property_search','owner_enrichment') then return true;end if;
 if kind='seller_call' then
  select t.screening_id into screen from public.icash_voice_jobs j
   join public.icash_voice_contact_targets t on t.id=coalesce(j.permission_id,j.operational_contact_id) and t.account_id=j.account_id
   where j.account_id=p_account and 'voice:'||j.id=p_operation and t.party='seller'
   and j.callback_id is null and j.sms_source_message_id is null and j.cancellation_notice_id is null;
 elsif kind in ('sms_send','mms_send') then
  select d.screening_id into screen from public.icash_text_messages m
   join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
   where m.account_id=p_account and 'text:'||m.id=p_operation and t.party='seller' and m.customer_author_id is null;
 else return false;end if;
 if screen is null then return false;end if;
 -- Replies, requested callbacks, customer-written messages, seller submissions
 -- and active contracts keep ordinary credit admission and existing pricing.
 return exists(select 1 from public.icash_screening_jobs s where s.id=screen and s.account_id=p_account and s.snapshot->'sellerRequest' is null)
 and not exists(select 1 from public.icash_deal_files d where d.account_id=p_account and d.screening_id=screen and d.stage<>'draft')
 and not exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id=screen and c.party='seller' and c.state='complete' and public.icash_call_has_seller_response(c.result))
 and not exists(select 1 from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where d.account_id=p_account and d.screening_id=screen and t.party='seller' and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null));
end $$;

create function public.icash_prospecting_available(p_account uuid) returns bigint
language sql stable set search_path='' as $$
 with budget as (select * from public.icash_prospecting_budgets where account_id=p_account order by id desc limit 1),
 spend as (select coalesce(sum(case when o.state='settled' then o.charged_cents when o.state in ('reserved','dispatched') then o.charge_cap_cents else 0 end),0) amount
  from public.icash_operation_spend o join budget b on b.id=o.prospecting_budget_id where o.account_id=p_account),
 pending as (select coalesce(sum(o.charge_cap_cents),0) amount from public.icash_operation_spend o
  where o.account_id=p_account and o.state in ('reserved','dispatched') and
  (o.prospecting_budget_id is not null or public.icash_new_prospect_operation(p_account,o.operation_key,o.rate_id)))
 select coalesce((select greatest(0,least(b.limit_cents-spend.amount,w.balance_cents-(b.baseline_cents-b.limit_cents)-pending.amount))::bigint
  from budget b join public.icash_wallets w on w.account_id=b.account_id cross join spend cross join pending),0);
$$;

create function public.icash_guard_prospecting_spend() returns trigger
language plpgsql set search_path='' as $$
begin
 if not public.icash_new_prospect_operation(new.account_id,new.operation_key,new.rate_id) then return new;end if;
 -- All reservations and funding share this lock. Concurrent calls/pages cannot
 -- spend the same allowance; an ambiguous provider outcome keeps its allowance.
 perform 1 from public.icash_operating_budget where id=1 for update;
 if public.icash_prospecting_available(new.account_id)<new.charge_cap_cents then
  raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',new.charge_cap_cents)::text;
 end if;
 select id into new.prospecting_budget_id from public.icash_prospecting_budgets where account_id=new.account_id order by id desc limit 1;
 if new.prospecting_budget_id is null then raise exception 'Prospecting budget reached' using detail=jsonb_build_object('quoteCents',new.charge_cap_cents)::text;end if;
 return new;
end $$;
create trigger icash_prospecting_spend_guard before insert on public.icash_operation_spend for each row execute function public.icash_guard_prospecting_spend();

create function public.icash_start_funded_prospecting(p_account uuid,p_event text) returns void
language plpgsql set search_path='' as $$
declare balance bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select balance_cents into balance from public.icash_wallets where account_id=p_account for update;
 if balance<=0 or balance is null then return;end if;
 if not exists(select 1 from public.icash_credit_ledger where account_id=p_account and event_key=p_event and kind in ('purchase','grant') and delta_cents>0) then raise exception 'Verified funding required';end if;
 insert into public.icash_prospecting_budgets(account_id,funding_event,baseline_cents) values(p_account,p_event,balance) on conflict(funding_event) do nothing;
 update public.icash_automation_tickets set expires_at=least(expires_at,now()) where account_id=p_account and state='held' and outcome='prospecting_budget_held';
 perform public.icash_wake_funded_outreach(p_account);
end $$;

-- Preserve the existing verified ledger/idempotency path and hook only a newly
-- posted purchase/grant. Refunds and usage settlements cannot reset the cap.
do $$declare definition text;needle text;begin
 select pg_get_functiondef('public.icash_post_credit(uuid,text,text,bigint,text)'::regprocedure) into definition;
 needle:=' select * into w from public.icash_wallets where account_id=p_account for update;';
 if position(needle in definition)=0 then raise exception 'Funding lock hook changed';end if;
 definition:=replace(definition,needle,' perform 1 from public.icash_operating_budget where id=1 for update;'||chr(10)||needle);
 needle:=' update public.icash_wallets set balance_cents=balance_cents+p_amount where account_id=p_account;';
 if position(needle in definition)=0 then raise exception 'Funding posting hook changed';end if;
 execute replace(definition,needle,needle||chr(10)||' if p_kind in (''purchase'',''grant'') then perform public.icash_start_funded_prospecting(p_account,p_event);end if;');
end $$;

-- Seed the fixed allowance once for existing positive wallets. No historical
-- operation is repriced or reassigned, and an explicit Pause stays in force.
insert into public.icash_prospecting_budgets(account_id,funding_event,baseline_cents)
 select account_id,'prospecting-release-20261019:'||account_id,balance_cents from public.icash_wallets where balance_cents>0;

-- Skip unaffordable research before issuing work. Final admission above remains
-- authoritative for races and all direct/manual provider entry points.
alter function public.icash_outbound_search_due(uuid) rename to icash_search_due_before_prospecting_budget;
create function public.icash_outbound_search_due(p_account uuid) returns boolean language sql stable set search_path='' as $$
 select public.icash_prospecting_available(p_account)>=r.charge_cents and public.icash_search_due_before_prospecting_budget(p_account)
 from public.icash_discovery_configs c join public.icash_operation_rates r on r.id=c.rate_id where c.account_id=p_account;
$$;
alter function public.icash_enrichment_candidate(uuid) rename to icash_enrichment_before_prospecting_budget;
create function public.icash_enrichment_candidate(p_account uuid) returns uuid language sql stable set search_path='' as $$
 select public.icash_enrichment_before_prospecting_budget(p_account) from public.icash_discovery_configs c
 join public.icash_operation_rates r on r.id=c.contact_rate_id where c.account_id=p_account and public.icash_prospecting_available(p_account)>=r.charge_cents;
$$;
-- Five seconds between affordable research steps; pending-buffer/provider gates
-- still bound volume. The worker already picks up ready tickets every second.
do $$declare definition text;needle text;begin
 select pg_get_functiondef('public.icash_next_acquisition()'::regprocedure) into definition;
 needle:='make_interval(secs=>least(interval_seconds,60))';
 if position(needle in definition)=0 then raise exception 'Research cadence hook changed';end if;
 execute replace(definition,needle,'case when public.icash_prospecting_available(c.account_id)>0 then interval ''5 seconds'' else interval ''60 seconds'' end');
end $$;

-- Completed research with no usable owner phone must not fill the pending
-- buffer indefinitely. Retain its original lookup/receipt for history.
do $$declare definition text;needle text;begin
 select pg_get_functiondef('public.icash_pending_opportunity_count(uuid)'::regprocedure) into definition;
 needle:='jsonb_array_length(coalesce(c.result->''contacts'',''[]''::jsonb))=0';
 if position(needle in definition)=0 then raise exception 'Pending owner-buffer hook changed';end if;
 execute replace(definition,needle,$replace$not exists(select 1 from jsonb_array_elements(coalesce(c.result->'contacts','[]'::jsonb)) person
  cross join lateral jsonb_array_elements(coalesce(person->'phones','[]'::jsonb)) phone
  where person->'likelyOwner'='true'::jsonb and phone->'doNotCall' is distinct from 'true'::jsonb and length(coalesce(phone->>'number',''))>0)$replace$);
end $$;

-- Only an exact rolled-back budget rejection may park/reissue unattempted work.
create function public.icash_hold_prospecting_ticket(p_id uuid,p_account uuid,p_quote bigint) returns boolean
language plpgsql set search_path='' as $$
declare t public.icash_automation_tickets;op text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into t from public.icash_automation_tickets where id=p_id and account_id=p_account and state='consumed' for update;
 if not found or p_quote is null or p_quote<=0 then return false;end if;
 if t.kind='contacts' then op:='owners:'||p_account||':'||t.screening_id;
 elsif t.kind='voice_dispatch' then
  op:='voice:'||t.voice_job_id;
  if not exists(select 1 from public.icash_voice_jobs where id=t.voice_job_id and account_id=p_account and state='issued' and operation_key is null and conversation_id is null and provider_call_sid is null) then return false;end if;
 elsif t.kind in ('seller_opener','seller_recovery') then
  op:='text:'||t.opener_message_id;
  if not exists(select 1 from public.icash_text_messages where id=t.opener_message_id and account_id=p_account and state='ready' and provider_id is null and last_delivery_at is null) then return false;end if;
 elsif t.kind='discovery' then
  select 'discovery:'||account_id||':'||revision||':'||next_page into op from public.icash_discovery_configs where account_id=p_account;
 else return false;end if;
 if op is null or exists(select 1 from public.icash_operation_spend where operation_key=op)
  or exists(select 1 from public.icash_live_conversations where operation_key=op) then return false;end if;
 update public.icash_automation_tickets set state='held',outcome='prospecting_budget_held',prospecting_quote_cents=p_quote,completed_at=now(),expires_at=now()+interval '1 minute' where id=t.id;
 if t.kind='voice_dispatch' then update public.icash_voice_jobs set state='held',outcome='prospecting_budget_held',updated_at=now() where id=t.voice_job_id;end if;
 return true;
end $$;

create function public.icash_resume_prospecting_ticket() returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_automation_tickets;op text;
begin
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if not found then return null;end if;
 for t in select x.* from public.icash_automation_tickets x join public.icash_accounts a on a.id=x.account_id
  where x.state='held' and x.outcome='prospecting_budget_held' and x.expires_at<=now() and not a.bot_paused
  and public.icash_membership_work_allowed(a.id) and public.icash_prospecting_available(a.id)>=x.prospecting_quote_cents
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
end $$;
alter function public.icash_next_automation() rename to icash_next_before_prospecting_budget;
create function public.icash_next_automation() returns jsonb language plpgsql security definer set search_path='' as $$
declare retry jsonb;
begin
 perform pg_advisory_xact_lock(726341927);
 retry:=public.icash_resume_prospecting_ticket();
 if retry->>'token' is not null then return retry;end if;
 return public.icash_next_before_prospecting_budget();
end $$;

create function public.icash_prospecting_progress(p_account uuid) returns jsonb language plpgsql stable set search_path='' as $$
declare b public.icash_prospecting_budgets;remaining bigint;minimum bigint;spent bigint;pending bigint;queued bigint;screened bigint;eligible bigint;attempted bigint;responded bigint;active boolean;paused boolean;
begin
 select * into b from public.icash_prospecting_budgets where account_id=p_account order by id desc limit 1;
 if not found then return null;end if;
 remaining:=public.icash_prospecting_available(p_account);
 select least(search.charge_cents,contacts.charge_cents) into minimum from public.icash_discovery_configs c join public.icash_operation_rates search on search.id=c.rate_id left join public.icash_operation_rates contacts on contacts.id=c.contact_rate_id where c.account_id=p_account;
 select coalesce(sum(charged_cents) filter(where state='settled'),0),coalesce(sum(charge_cap_cents) filter(where state in ('reserved','dispatched')),0) into spent,pending from public.icash_operation_spend where account_id=p_account and prospecting_budget_id=b.id;
 select bot_paused into paused from public.icash_accounts where id=p_account;
 select count(*) filter(where s.state in ('queued','running')),count(*) filter(where s.state='complete'),count(*) filter(where s.state='complete' and s.result->'financialCheck'->>'status'='eligible')
  into queued,screened,eligible from public.icash_screening_jobs s where s.account_id=p_account and s.created_at>=b.created_at and s.state<>'archived';
 select count(*) filter(where o.attempted),count(*) filter(where o.responded and not o.opted_out) into attempted,responded
  from public.icash_opportunity_outcomes o where o.account_id=p_account and o.discovered_at>=b.created_at;
 active:=exists(select 1 from public.icash_automation_tickets where account_id=p_account and kind in ('discovery','contacts','voice_dispatch','seller_opener') and state='consumed' and created_at>now()-interval '2 minutes') or queued>0;
 return jsonb_build_object('budgetId',b.id,'startedAt',b.created_at,'limitCents',b.limit_cents,'spentCents',spent,'pendingCents',pending,'remainingCents',remaining,
  'queued',queued,'screened',screened,'eligible',eligible,'contacted',attempted,'responded',responded,
  'status',case when paused then 'paused' when not public.icash_membership_work_allowed(p_account) then 'membership_required'
   when remaining<coalesce(minimum,1) and pending>0 then 'settling' when remaining<coalesce(minimum,1) then 'budget_reached' when active then 'working'
   when exists(select 1 from public.icash_discovery_configs where account_id=p_account and enabled and auto_enabled and data_rights_until>now()) then 'ready' else 'waiting' end);
end $$;

revoke all on function public.icash_new_prospect_operation(uuid,text,uuid),public.icash_prospecting_available(uuid),public.icash_guard_prospecting_spend(),public.icash_start_funded_prospecting(uuid,text),public.icash_outbound_search_due(uuid),public.icash_search_due_before_prospecting_budget(uuid),public.icash_enrichment_candidate(uuid),public.icash_enrichment_before_prospecting_budget(uuid),public.icash_hold_prospecting_ticket(uuid,uuid,bigint),public.icash_resume_prospecting_ticket(),public.icash_next_automation(),public.icash_next_before_prospecting_budget(),public.icash_prospecting_progress(uuid) from public,anon,authenticated;
grant execute on function public.icash_new_prospect_operation(uuid,text,uuid),public.icash_prospecting_available(uuid),public.icash_guard_prospecting_spend(),public.icash_start_funded_prospecting(uuid,text),public.icash_outbound_search_due(uuid),public.icash_search_due_before_prospecting_budget(uuid),public.icash_enrichment_candidate(uuid),public.icash_enrichment_before_prospecting_budget(uuid),public.icash_hold_prospecting_ticket(uuid,uuid,bigint),public.icash_resume_prospecting_ticket(),public.icash_next_automation(),public.icash_next_before_prospecting_budget(),public.icash_prospecting_progress(uuid) to service_role;
commit;
