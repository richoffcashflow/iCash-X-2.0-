
create function public.icash_post_credit(p_account uuid,p_event text,p_kind text,p_amount bigint,p_evidence text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare w public.icash_wallets; e public.icash_credit_ledger; result uuid;
begin
 if p_event is null or trim(p_event)='' or p_evidence is null or trim(p_evidence)='' or p_amount is null or p_amount=0
 or p_kind is null or p_kind not in ('purchase','grant','refund') then raise exception 'Invalid credit posting'; end if;
 if (p_kind in ('purchase','grant') and p_amount<0) or (p_kind='refund' and p_amount>0) then raise exception 'Invalid credit direction'; end if;
 select * into w from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into e from public.icash_credit_ledger where event_key=p_event;
 if found then
  if e.account_id<>p_account or e.kind<>p_kind or e.delta_cents<>p_amount or e.evidence_ref<>p_evidence then raise exception 'Idempotency conflict'; end if;
  return e.id;
 end if;
 if w.balance_cents+p_amount<w.reserved_cents then raise exception 'Insufficient unreserved credits'; end if;
 insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
 values(p_account,p_event,p_kind,p_amount,p_evidence) returning id into result;
 update public.icash_wallets set balance_cents=balance_cents+p_amount where account_id=p_account;
 return result;
end; $$;

create function public.icash_reserve_credit(p_account uuid,p_operation text,p_amount bigint)
returns uuid language plpgsql security invoker set search_path='' as $$
declare w public.icash_wallets; r public.icash_credit_reservations; a public.icash_accounts; used bigint; result uuid;
begin
 if p_operation is null or trim(p_operation)='' or p_amount is null or p_amount<=0 then raise exception 'Invalid reservation'; end if;
 select * into a from public.icash_accounts where id=p_account for update;
 if not found then raise exception 'Account missing'; end if;
 select * into w from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where operation_key=p_operation;
 if found then
  if r.account_id<>p_account or r.amount_cents<>p_amount then raise exception 'Idempotency conflict'; end if;
  if r.status<>'reserved' then raise exception 'Operation already resolved'; end if;
  if a.bot_paused then raise exception 'Bot paused'; end if;
  return r.id;
 end if;
 if a.bot_paused then raise exception 'Bot paused'; end if;
 if w.balance_cents-w.reserved_cents<p_amount then raise exception 'Insufficient credits'; end if;
 -- Rolling 24-hour consumption plus ALL outstanding reservations, including older work.
 select coalesce(sum(-delta_cents),0) into used from public.icash_credit_ledger
 where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours';
 if used+w.reserved_cents+p_amount>a.daily_limit_cents then raise exception 'Daily budget reached'; end if;
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents)
 values(p_account,p_operation,p_amount) returning id into result;
 update public.icash_wallets set reserved_cents=reserved_cents+p_amount where account_id=p_account;
 return result;
end; $$;

create function public.icash_finish_credit(p_account uuid,p_operation text,p_charge bigint,p_evidence text)
returns text language plpgsql security invoker set search_path='' as $$
declare r public.icash_credit_reservations; desired text;
begin
 if p_charge is null or p_charge<0 or p_evidence is null or trim(p_evidence)='' then raise exception 'Invalid settlement'; end if;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 if not found then raise exception 'Wallet missing'; end if;
 select * into r from public.icash_credit_reservations where account_id=p_account and operation_key=p_operation for update;
 if not found then raise exception 'Reservation missing'; end if;
 desired:=case when p_charge=0 then 'released' else 'settled' end;
 if r.status<>'reserved' then
  if r.status=desired and coalesce(r.settled_cents,0)=p_charge then return r.status; end if;
  raise exception 'Settlement conflict';
 end if;
 if p_charge>r.amount_cents then raise exception 'Charge exceeds reservation'; end if;
 if p_charge>0 then
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,'usage:'||p_operation,'usage',-p_charge,p_evidence);
 end if;
 update public.icash_wallets set balance_cents=balance_cents-p_charge,reserved_cents=reserved_cents-r.amount_cents where account_id=p_account;
 update public.icash_credit_reservations set status=desired,settled_cents=case when p_charge>0 then p_charge else null end where id=r.id;
 return desired;
end; $$;
revoke all on function public.icash_post_credit(uuid,text,text,bigint,text) from public,anon,authenticated;
revoke all on function public.icash_reserve_credit(uuid,text,bigint) from public,anon,authenticated;
revoke all on function public.icash_finish_credit(uuid,text,bigint,text) from public,anon,authenticated;
grant execute on function public.icash_post_credit(uuid,text,text,bigint,text) to service_role;
grant execute on function public.icash_reserve_credit(uuid,text,bigint) to service_role;
grant execute on function public.icash_finish_credit(uuid,text,bigint,text) to service_role;

create table icash_private.engine_configs (
 engine text primary key check(engine in ('deal','retention')), enabled boolean not null default false,
 version integer not null default 1 check(version>0), settings jsonb not null,
 updated_at timestamptz not null default now()
);
insert into icash_private.engine_configs(engine,settings) values
 ('deal','{"objective":"verified_closings_within_customer_budget","protect_active_deals":true,"daily_limit_required":true,"minimum_provider_margin_required":true,"human_review_for_exceptions":true}'),
 ('retention','{"objective":"retained_gross_profit_with_customer_outcomes","truthful_events_only":true,"respect_notification_preferences":true,"minimum_hours_between_prompts":24,"no_guaranteed_deals":true,"no_automatic_reload_without_consent":true}');
create table icash_private.engine_decisions (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 deal_id uuid, engine text not null references icash_private.engine_configs(engine),
 config_version integer not null, action text not null, reason text not null,
 evidence_refs text[] not null check(cardinality(evidence_refs)>0),
 expected_customer_charge_cents bigint not null default 0 check(expected_customer_charge_cents>=0),
 expected_provider_cost_usd numeric(18,8) not null default 0 check(expected_provider_cost_usd>=0),
 operation_key text not null unique, created_at timestamptz not null default now(),
 foreign key(account_id,deal_id) references public.icash_deals(account_id,id)
);
create table icash_private.outcome_events (
 id uuid primary key default gen_random_uuid(), account_id uuid not null references public.icash_accounts(id),
 deal_id uuid, event_type text not null, source_event_id text not null unique,
 evidence_ref text not null, occurred_at timestamptz not null, metrics jsonb not null default '{}',
 foreign key(account_id,deal_id) references public.icash_deals(account_id,id)
);
alter table icash_private.engine_configs enable row level security;
alter table icash_private.engine_decisions enable row level security;
alter table icash_private.outcome_events enable row level security;
grant select,insert,update on icash_private.engine_configs to service_role;
grant select,insert on icash_private.engine_decisions,icash_private.outcome_events to service_role;
create index icash_decision_deal on icash_private.engine_decisions(account_id,deal_id);
create index icash_decision_engine on icash_private.engine_decisions(engine);
create index icash_outcome_deal on icash_private.outcome_events(account_id,deal_id);
