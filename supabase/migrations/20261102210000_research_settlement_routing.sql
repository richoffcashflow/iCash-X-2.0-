-- Repair the legacy research-estimate race without rewriting original usage.
begin;
set local lock_timeout='5s';
do $patch$
declare d text;needle text:='-- A full-call quote is a reservation ceiling, never completed-call usage.';
begin
 d:=pg_get_functiondef('public.icash_settle_estimate_before_sms_tokens(text)'::regprocedure);
 if md5(d)<>'4f81aaec4293366f46a313ebbdace87f' or strpos(d,needle)=0 then raise exception 'Estimate settlement source changed';end if;
 execute replace(d,needle,$new$-- Research must use the original observed credit receipt and saved multipliers.
 -- The maintenance path can race the provider handler after receipt persistence.
 if r.operation in ('property_search','owner_enrichment','buyer_discovery') then
  return public.icash_settle_dealmachine_usage(p_operation);
 end if;
$new$||needle);
end $patch$;

create table icash_reliability_private.research_settlement_corrections(
 operation_key text primary key references public.icash_operation_spend(operation_key),
 account_id uuid not null references public.icash_accounts(id),
 operation_snapshot jsonb not null,manifest_components jsonb not null,receipt jsonb not null,
 observation jsonb not null,correct_cost_micros bigint not null check(correct_cost_micros>=0),
 correct_charge_cents bigint not null check(correct_charge_cents>=0),
 credited_cents bigint not null check(credited_cents>=0),
 system_pause_observed boolean not null,control_event_id uuid,
 authority text not null,created_at timestamptz not null default now()
);
create index research_settlement_corrections_account on icash_reliability_private.research_settlement_corrections(account_id);
alter table icash_reliability_private.research_settlement_corrections enable row level security;
revoke all on icash_reliability_private.research_settlement_corrections from public,anon,authenticated,service_role;
grant select on icash_reliability_private.research_settlement_corrections to service_role;
create table icash_reliability_private.account_pause_recoveries(
 account_id uuid primary key references public.icash_accounts(id),control_event_id uuid,
 evidence text not null,created_at timestamptz not null default now()
);
alter table icash_reliability_private.account_pause_recoveries enable row level security;
revoke all on icash_reliability_private.account_pause_recoveries from public,anon,authenticated,service_role;

-- Exact original-row matching prevents this exception from covering later costs.
-- Corrected historical operations contribute no margin headroom and no deficit.
-- Original charges/costs remain immutable; any credit is a separate ledger entry.
do $patch$
declare d text;needle text:='case when o.state=''settled'' then o.actual_micros::numeric*o.standard_cost_multiplier';
begin
 d:=pg_get_functiondef('public.icash_account_margin_ok(uuid,bigint,bigint,boolean)'::regprocedure);
 if md5(d)<>'d8e993e7bea0979de8ca339eba260f68' or strpos(d,needle)=0 then raise exception 'Account margin source changed';end if;
 d:=replace(d,needle,'case when o.state=''settled'' and correction.operation_key is not null then o.charged_cents::numeric*10000 when o.state=''settled'' then o.actual_micros::numeric*o.standard_cost_multiplier');
 needle:='where o.account_id=p_account';
 if strpos(d,needle)=0 then raise exception 'Account margin scope changed';end if;
 execute replace(d,needle,'left join icash_reliability_private.research_settlement_corrections correction on correction.operation_key=o.operation_key and correction.account_id=o.account_id and correction.operation_snapshot=to_jsonb(o) and correction.manifest_components=m.components '||needle);
end $patch$;

create function public.icash_correct_legacy_research_settlement(p_operation text) returns jsonb
language plpgsql security definer set search_path='' as $fn$
declare o public.icash_operation_spend;r public.icash_operation_rates;m public.icash_cost_manifests;
 a public.icash_accounts;ob public.icash_cost_observations;receipt jsonb;source text;part record;
 quoted numeric:=0;actual numeric:=0;price numeric:=0;legacy_price numeric;amount numeric;used numeric;
 corrected bigint;credit bigint;net bigint;control_id uuid;control_action text;system_pause boolean;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found or o.state<>'settled' or o.dealmachine_cost_multiplier is null or o.data_unit_cost_micros is null or o.customer_price_micros is not null then return null;end if;
 if exists(select 1 from icash_reliability_private.research_settlement_corrections where operation_key=p_operation) then
  return (select jsonb_build_object('corrected',true,'creditedCents',credited_cents) from icash_reliability_private.research_settlement_corrections where operation_key=p_operation);
 end if;
 select * into strict r from public.icash_operation_rates where id=o.rate_id;
 select * into m from public.icash_cost_manifests where operation_key=p_operation;
 if not found or r.operation not in ('property_search','owner_enrichment','buyer_discovery')
  or o.settlement_evidence is distinct from 'ESTIMATE: configured rate '||r.version||'; provider invoice costs not verified' then return null;end if;
 if r.operation='property_search' then
  select result into receipt from public.icash_discovery_results where operation_key=p_operation and account_id=o.account_id;
  source:='dealmachine:search:'||p_operation;
 elsif r.operation='owner_enrichment' then
  select result into receipt from public.icash_owner_contacts where operation_key=p_operation and account_id=o.account_id;
  source:='dealmachine:owners:'||p_operation;
 else
  select b.receipt into receipt from public.icash_buyer_search_receipts b join public.icash_deal_files d on d.id=b.deal_id and d.account_id=o.account_id where b.operation_key=p_operation;
  source:=p_operation;
 end if;
 if receipt is null or jsonb_typeof(receipt->'creditsUsed') is distinct from 'number' then return null;end if;
 used:=(receipt->>'creditsUsed')::numeric;
 select * into ob from public.icash_cost_observations where provider='dealmachine' and event_key=p_operation and source_ref=source and units='provider_credits';
 if not found or used<0 or used<>trunc(used) or used is distinct from ob.amount or used*o.data_unit_cost_micros>(r.costs_micros->>'dealmachine')::numeric then return null;end if;
 if (select count(*) from jsonb_each(m.components))<>(select count(*) from jsonb_each(r.costs_micros)) then return null;end if;
 for part in select key,value from jsonb_each_text(r.costs_micros) loop
  if (m.components->part.key->>'amountMicros')::numeric is distinct from part.value::numeric
   or m.components->part.key->>'evidenceRef' is distinct from o.settlement_evidence then return null;end if;
  quoted:=quoted+part.value::numeric;
  amount:=case when part.key='dealmachine' then used*o.data_unit_cost_micros else part.value::numeric end;
  actual:=actual+amount;
  price:=price+amount*case when part.key='dealmachine' then o.dealmachine_cost_multiplier when part.key='elevenlabs' then o.elevenlabs_cost_multiplier else o.standard_cost_multiplier end;
 end loop;
 legacy_price:=quoted*o.standard_cost_multiplier-coalesce((r.costs_micros->>'elevenlabs')::numeric,0)*(o.standard_cost_multiplier-o.elevenlabs_cost_multiplier);
 if quoted is distinct from o.actual_micros or ceil(legacy_price/10000) is distinct from o.charged_cents
  or not exists(select 1 from public.icash_credit_ledger where account_id=o.account_id and event_key='usage:'||p_operation and kind='usage' and delta_cents=-o.charged_cents) then return null;end if;
 corrected:=ceil(price/10000);
 select coalesce((select customer_cents from public.icash_usage_coverage where operation_key=p_operation and account_id=o.account_id),o.charged_cents) into net;
 credit:=greatest(0,net-corrected);
 select * into strict a from public.icash_accounts where id=o.account_id for update;
 select id,action into control_id,control_action from public.icash_control_events where account_id=o.account_id and property_id is null order by created_at desc,id desc limit 1;
 system_pause:=a.bot_paused and control_action is distinct from 'pause' and not public.icash_account_margin_ok(o.account_id,0,0,false)
  and not exists(select 1 from public.icash_billing_reviews where account_id=o.account_id and resolved_at is null)
  and not exists(select 1 from public.icash_support_cancel_requests where account_id=o.account_id and confirmed_at is not null);
 perform 1 from public.icash_wallets where account_id=o.account_id for update;
 if not found then raise exception 'Wallet missing';end if;
 insert into icash_reliability_private.research_settlement_corrections
 (operation_key,account_id,operation_snapshot,manifest_components,receipt,observation,correct_cost_micros,correct_charge_cents,credited_cents,system_pause_observed,control_event_id,authority)
 values(p_operation,o.account_id,to_jsonb(o),m.components,receipt,to_jsonb(ob),actual,corrected,credit,system_pause,control_id,
 'Owner repair instruction 2026-11-02: exact legacy estimate race; no retrospective debit; immutable receipts and explicit Pause preserved');
 if credit>0 then
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(o.account_id,'research-correction:'||p_operation,'grant',credit,'Original observed-credit correction: '||p_operation);
  update public.icash_wallets set balance_cents=balance_cents+credit where account_id=o.account_id;
 end if;
 return jsonb_build_object('corrected',true,'creditedCents',credit);
end $fn$;

create function public.icash_resume_corrected_research_pause(p_account uuid) returns boolean
language plpgsql security definer set search_path='' as $fn$
declare a public.icash_accounts;control_id uuid;control_action text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into a from public.icash_accounts where id=p_account for update;
 if not found or not a.bot_paused or p_account='48dfb798-8c1a-404f-88c0-c396cc067062'
  or not public.icash_membership_work_allowed(p_account) or not public.icash_account_margin_ok(p_account,0,0,false)
  or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>reserved_cents)
  or exists(select 1 from public.icash_billing_reviews where account_id=p_account and resolved_at is null)
  or exists(select 1 from public.icash_support_cancel_requests where account_id=p_account and confirmed_at is not null)
  or exists(select 1 from icash_reliability_private.account_pause_recoveries where account_id=p_account) then return false;end if;
 select id,action into control_id,control_action from public.icash_control_events where account_id=p_account and property_id is null order by created_at desc,id desc limit 1;
 if control_action='pause' or not exists(select 1 from icash_reliability_private.research_settlement_corrections
  where account_id=p_account and system_pause_observed and control_event_id is not distinct from control_id) then return false;end if;
 insert into icash_reliability_private.account_pause_recoveries(account_id,control_event_id,evidence)
 values(p_account,control_id,'Exact legacy research settlement corrected; customer control unchanged; current margin/access/balance/billing/cancellation checks passed');
 update public.icash_accounts set bot_paused=false where id=p_account;
 update public.icash_discovery_configs set next_run_at=least(next_run_at,now()) where account_id=p_account;
 return true;
end $fn$;
revoke all on function public.icash_correct_legacy_research_settlement(text),public.icash_resume_corrected_research_pause(uuid) from public,anon,authenticated;
grant execute on function public.icash_correct_legacy_research_settlement(text),public.icash_resume_corrected_research_pause(uuid) to service_role;
commit;
