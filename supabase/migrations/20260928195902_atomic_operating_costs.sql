-- All costs use integer USD micros. No rates or cash funding are invented.
create table public.icash_operating_budget (
 id integer primary key check(id=1), enabled boolean not null default false,
 funded_micros bigint not null default 0 check(funded_micros>=0),
 protected_micros bigint not null default 0 check(protected_micros>=0),
 reserved_micros bigint not null default 0 check(reserved_micros>=0),
 spent_micros bigint not null default 0 check(spent_micros>=0),
 daily_limit_micros bigint not null default 0 check(daily_limit_micros>=0),
 minimum_margin_bps integer not null default 6500 check(minimum_margin_bps between 0 and 9999),
 hold_reason text
);
insert into public.icash_operating_budget(id,hold_reason) values(1,'Verified rates and operating cash budget required');
create table public.icash_operation_rates (
 id uuid primary key default gen_random_uuid(), operation text not null,
 version text not null unique, charge_cents bigint not null check(charge_cents>0),
 costs_micros jsonb not null, buffer_bps integer not null default 2000 check(buffer_bps between 0 and 10000),
 evidence_ref text not null check(length(trim(evidence_ref))>0),
 verified_at timestamptz not null, expires_at timestamptz not null,
 enabled boolean not null default false, check(expires_at>verified_at)
);
create table public.icash_operation_spend (
 operation_key text primary key, account_id uuid not null references public.icash_accounts(id),
 rate_id uuid not null references public.icash_operation_rates(id),
 credit_reservation_id uuid not null references public.icash_credit_reservations(id),
 charge_cap_cents bigint not null, reserved_micros bigint not null check(reserved_micros>=0),
 state text not null default 'reserved' check(state in ('reserved','dispatched','settled','cancelled')),
 permission_until timestamptz not null, financial_checked_at timestamptz,
 actual_micros bigint, charged_cents bigint, settlement_evidence text,
 created_at timestamptz not null default now(), dispatched_at timestamptz, settled_at timestamptz
);
create index icash_operation_spend_account on public.icash_operation_spend(account_id,created_at);
create index icash_operation_spend_settled on public.icash_operation_spend(settled_at) where settled_at is not null;
create table public.icash_cost_observations (
 provider text not null, event_key text not null, source_ref text not null,
 amount numeric, units text not null, reconciled boolean not null default false,
 observed_at timestamptz not null default now(), primary key(provider,event_key),check(amount is null or amount>=0)
);
-- Immutable observations can be marked reconciled separately; provider amounts never replace the full settlement.
create function public.icash_record_cost_observation(p_provider text,p_event text,p_source text,p_amount numeric,p_units text) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.icash_cost_observations;
begin
 if p_provider is null or trim(p_provider)='' or p_event is null or trim(p_event)='' or p_source is null or trim(p_source)='' or p_units is null or trim(p_units)='' or p_amount<0 then raise exception 'Invalid cost observation'; end if;
 insert into public.icash_cost_observations(provider,event_key,source_ref,amount,units) values(p_provider,p_event,p_source,p_amount,p_units) on conflict do nothing;
 select * into o from public.icash_cost_observations where provider=p_provider and event_key=p_event;
 if row(o.source_ref,o.amount,o.units) is distinct from row(p_source,p_amount,p_units) then raise exception 'Cost receipt conflict'; end if;
end $$;
create function public.icash_reserve_operation(p_account uuid,p_operation text,p_rate uuid,p_permission_until timestamptz,p_financial_checked_at timestamptz default null,p_financial_eligible boolean default false) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b public.icash_operating_budget; r public.icash_operation_rates; o public.icash_operation_spend; cat text; n numeric; total numeric:=0; held bigint; daily numeric; cr uuid;
begin
 if p_operation is null or length(p_operation) not between 1 and 160 then raise exception 'Invalid operation'; end if;
 select * into b from public.icash_operating_budget where id=1 for update;
 if not b.enabled then raise exception 'Operating budget on hold'; end if;
 select * into o from public.icash_operation_spend where operation_key=p_operation;
 if found then
  if o.account_id<>p_account or o.rate_id<>p_rate then raise exception 'Operation conflict'; end if;
  return jsonb_build_object('operationKey',o.operation_key,'state',o.state,'reservedMicros',o.reserved_micros);
 end if;
 select * into r from public.icash_operation_rates where id=p_rate for share;
 if not found or not r.enabled or r.verified_at>now() or r.expires_at<=now() then raise exception 'Verified rate required'; end if;
 if p_permission_until is null or p_permission_until<=now() then raise exception 'Permission expired'; end if;
 if r.operation='seller_call' and (p_financial_eligible is distinct from true or p_financial_checked_at is null or p_financial_checked_at>now() or p_financial_checked_at<now()-interval '24 hours') then raise exception 'Financial screening required'; end if;
 foreach cat in array array['dealmachine','elevenlabs','twilio','messaging','email','llm','vercel','railway','supabase','github','payments','title_and_signing','support_and_overhead','acquisition','refund_and_dispute_reserve','other'] loop
  if jsonb_typeof(r.costs_micros->cat) is distinct from 'number' then raise exception 'Unknown cost: %',cat; end if;
  n:=(r.costs_micros->>cat)::numeric;
  if n<0 or n<>trunc(n) or n>9007199254740991 then raise exception 'Invalid cost'; end if;
  total:=total+n;
 end loop;
 -- Match JS: round reserve up to a cent after adding buffer.
 held:=ceil(total*(10000+r.buffer_bps)/100000000)*10000;
 if held>r.charge_cents::numeric*10000*(10000-b.minimum_margin_bps)/10000 then raise exception 'Margin floor'; end if;
 if b.funded_micros::numeric-b.spent_micros-b.reserved_micros-b.protected_micros<held then raise exception 'Company budget exhausted'; end if;
 select coalesce(sum(actual_micros),0) into daily from public.icash_operation_spend where settled_at>now()-interval '24 hours';
 if daily+b.reserved_micros+held>b.daily_limit_micros then raise exception 'Company daily limit'; end if;
 cr:=public.icash_reserve_credit(p_account,p_operation,r.charge_cents);
 insert into public.icash_operation_spend(operation_key,account_id,rate_id,credit_reservation_id,charge_cap_cents,reserved_micros,permission_until,financial_checked_at)
 values(p_operation,p_account,p_rate,cr,r.charge_cents,held,p_permission_until,p_financial_checked_at);
 update public.icash_operating_budget set reserved_micros=reserved_micros+held where id=1;
 return jsonb_build_object('operationKey',p_operation,'state','reserved','reservedMicros',held);
end $$;
create function public.icash_claim_operation(p_operation text) returns boolean
language plpgsql security invoker set search_path='' as $$
declare b public.icash_operating_budget; o public.icash_operation_spend; r public.icash_operation_rates; a public.icash_accounts;
begin
 select * into b from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.state<>'reserved' or not b.enabled or b.funded_micros::numeric-b.spent_micros-b.protected_micros<b.reserved_micros then return false; end if;
 select * into a from public.icash_accounts where id=o.account_id for update;
 select * into r from public.icash_operation_rates where id=o.rate_id for share;
 if a.bot_paused or not r.enabled or r.expires_at<=now() or o.permission_until<=now() then return false; end if;
 if r.operation='seller_call' and (o.financial_checked_at is null or o.financial_checked_at<now()-interval '24 hours') then return false; end if;
 update public.icash_operation_spend set state='dispatched',dispatched_at=now() where operation_key=p_operation;
 return true;
end $$;
create function public.icash_settle_operation(p_operation text,p_charge bigint,p_actual_micros bigint,p_evidence text) returns void
language plpgsql security invoker set search_path='' as $$
declare o public.icash_operation_spend;
begin
 if p_charge is null or p_charge<0 or p_actual_micros is null or p_actual_micros<0 or p_evidence is null or trim(p_evidence)='' then raise exception 'Verified settlement required'; end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found then raise exception 'Operation missing'; end if;
 if o.state in ('settled','cancelled') then
  if row(o.charged_cents,o.actual_micros,o.settlement_evidence) is distinct from row(p_charge,p_actual_micros,p_evidence) then raise exception 'Settlement conflict'; end if;
  return;
 end if;
 if p_charge>o.charge_cap_cents then raise exception 'Charge exceeds approved amount'; end if;
 if o.state='reserved' and (p_charge<>0 or p_actual_micros<>0) then raise exception 'Undispatched operation can only be cancelled'; end if;
 perform public.icash_finish_credit(o.account_id,p_operation,p_charge,p_evidence);
 update public.icash_operating_budget set reserved_micros=reserved_micros-o.reserved_micros,spent_micros=spent_micros+p_actual_micros,
 enabled=case when p_actual_micros>o.reserved_micros or p_actual_micros::numeric>p_charge::numeric*10000*(10000-minimum_margin_bps)/10000 then false else enabled end,
 hold_reason=case when p_actual_micros>o.reserved_micros or p_actual_micros::numeric>p_charge::numeric*10000*(10000-minimum_margin_bps)/10000 then 'Actual cost exceeded reserve or margin floor; reconcile before resuming' else hold_reason end where id=1;
 update public.icash_operation_spend set state=case when o.state='reserved' then 'cancelled' else 'settled' end,actual_micros=p_actual_micros,charged_cents=p_charge,settlement_evidence=p_evidence,settled_at=now() where operation_key=p_operation;
end $$;

alter table public.icash_operating_budget enable row level security;
alter table public.icash_operation_rates enable row level security;
alter table public.icash_operation_spend enable row level security;
alter table public.icash_cost_observations enable row level security;
revoke all on public.icash_operating_budget,public.icash_operation_rates,public.icash_operation_spend,public.icash_cost_observations from public,anon,authenticated;
grant select,insert,update,delete on public.icash_operating_budget,public.icash_operation_rates,public.icash_operation_spend,public.icash_cost_observations to service_role;
revoke all on function public.icash_record_cost_observation(text,text,text,numeric,text),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_claim_operation(text),public.icash_settle_operation(text,bigint,bigint,text) from public,anon,authenticated;
grant execute on function public.icash_record_cost_observation(text,text,text,numeric,text),public.icash_reserve_operation(uuid,text,uuid,timestamptz,timestamptz,boolean),public.icash_claim_operation(text),public.icash_settle_operation(text,bigint,bigint,text) to service_role;

create function public.icash_immutable_operation_rate() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then raise exception 'Create a new rate version instead of changing evidence'; end if;
 return new;
end $$;
revoke all on function public.icash_immutable_operation_rate() from public,anon,authenticated;
grant execute on function public.icash_immutable_operation_rate() to service_role;
create trigger icash_operation_rate_immutable before update on public.icash_operation_rates for each row execute function public.icash_immutable_operation_rate();
