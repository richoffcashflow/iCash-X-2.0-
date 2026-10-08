-- Compact equivalent of 20261008182808_available_credit_usage.sql for production.
-- Each existing definition must match its audited checksum before any change.
-- Usage authorizations remain immutable/idempotent; they no longer withhold wallet credits.
-- Provider-cost ceilings and operation bindings remain intact.
begin;
set local lock_timeout='5s';
create table public.icash_usage_coverage (
 operation_key text primary key references public.icash_credit_reservations(operation_key),
 account_id uuid not null references public.icash_accounts(id),
 gross_cents bigint not null check(gross_cents>0),
 customer_cents bigint not null check(customer_cents>=0),
 covered_cents bigint not null check(covered_cents>0),
 evidence_ref text not null check(length(trim(evidence_ref))>0),
 created_at timestamptz not null default now(),
 check(gross_cents=customer_cents+covered_cents)
);
alter table public.icash_usage_coverage enable row level security;
revoke all on public.icash_usage_coverage from public,anon,authenticated,service_role;
grant select,insert on public.icash_usage_coverage to service_role;
-- Releasing authorizations is not a refund or a settlement. Historical provider
-- receipts and amounts are unchanged; actual costs still reconcile once.
do $$ begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 update public.icash_wallets set reserved_cents=0 where reserved_cents>0;
end $$;

CREATE OR REPLACE FUNCTION public.icash_call_credit_available(p_account uuid,p_operation text)
returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_operation_spend o join public.icash_wallets w on w.account_id=o.account_id
 where o.account_id=p_account and o.operation_key=p_operation and o.state='dispatched' and w.balance_cents>0)
$$;
do $deploy$
declare d text;
begin
 d:=pg_get_functiondef('public.icash_reserve_credit(uuid,text,bigint)'::regprocedure);
 if md5(d)<>'a6240731d99ebec562409ea97a388a8d' then raise exception 'Concurrent change to icash_reserve_credit';end if;
 d:=overlay(d placing $edit$
$edit$ from 2376 for 100);
 d:=overlay(d placing $edit$ if w.balance_cents<=0 then raise exception 'Insufficient credits'; end if;
 -- This row is an idempotent usage authorization, not a wallet hold.
 -- The work planner chooses affordable work; actual usage is deducted once.
$edit$ from 1939 for 286);
 execute d;
 d:=pg_get_functiondef('public.icash_finish_credit(uuid,text,bigint,text)'::regprocedure);
 if md5(d)<>'6b2f21524b9319ff5787e551c8d73432' then raise exception 'Concurrent change to icash_finish_credit';end if;
 d:=overlay(d placing $edit$ update public.icash_wallets set balance_cents=balance_cents+covered-p_charge,reserved_cents=0 where account_id=p_account;
$edit$ from 1235 for 143);
 d:=overlay(d placing $edit$ -- Concurrent completed work may consume the last credits before this receipt.
 -- Record platform-covered overrun explicitly; never debit below zero or retry a charge.
 covered:=greatest(0,p_charge-available);
 if covered>0 then
  insert into public.icash_usage_coverage(account_id,operation_key,gross_cents,customer_cents,covered_cents,evidence_ref)
  values(p_account,p_operation,p_charge,p_charge-covered,covered,p_evidence);
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,'usage-coverage:'||p_operation,'grant',covered,'Platform-covered concurrent usage; no customer debt: '||p_evidence);
 end if;
$edit$ from 1041 for 0);
 d:=overlay(d placing $edit$ select balance_cents into available from public.icash_wallets where account_id=p_account for update;
$edit$ from 387 for 76);
 d:=overlay(d placing $edit$declare r public.icash_credit_reservations; desired text; available bigint; covered bigint;
$edit$ from 192 for 58);
 execute d;
 d:=pg_get_functiondef('public.icash_daily_allowance(uuid)'::regprocedure);
 if md5(d)<>'1962434a06226405ca3b4e3b6744e248' then raise exception 'Concurrent change to icash_daily_allowance';end if;
 d:=overlay(d placing $edit$ select coalesce(-sum(delta_cents),0) into spent from public.icash_credit_ledger
 where account_id=p_account and created_at>=day_start and (kind='usage' or event_key like 'usage-coverage:%');
 return jsonb_build_object('mode','available_balance','day',public.icash_spending_day(),'timezone','America/Chicago',
 'openingCents',w.balance_cents+spent,'limitCents',w.balance_cents+spent,'spentCents',spent,
 'reservedCents',0,'remainingCents',w.balance_cents,'availableCents',w.balance_cents,'extraCents',0,
 'resetsAt',(public.icash_spending_day()+1)::timestamp at time zone 'America/Chicago');
end $$
$edit$ from 591 for 1855);
 d:=overlay(d placing $edit$ select * into strict w from public.icash_wallets where account_id=p_account;
$edit$ from 337 for 171);
 d:=overlay(d placing $edit$create or replace function public.icash_daily_allowance(p_account uuid)
returns jsonb language plpgsql set search_path='' as $$
declare w public.icash_wallets;spent bigint;day_start timestamptz;
$edit$ from 1 for 330);
 execute d;
 d:=pg_get_functiondef('public.icash_reserve_before_membership(uuid,text,uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure);
 if md5(d)<>'6dc6cd0a94b34e48da87f5c19bfbc21e' then raise exception 'Concurrent change to icash_reserve_before_membership';end if;
 d:=overlay(d placing $edit$$edit$ from 1594 for 9);
 d:=overlay(d placing $edit$ -- A paid, enabled account spends its current balance; no lifetime spending cap.
$edit$ from 895 for 690);
 execute d;
 d:=pg_get_functiondef('public.icash_reserve_before_fractional(uuid,text,uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure);
 if md5(d)<>'82b26fe284b90c06ee7d890aaa7506cf' then raise exception 'Concurrent change to icash_reserve_before_fractional';end if;
 d:=overlay(d placing $edit$$edit$ from 4575 for 880);
 execute d;
 d:=pg_get_functiondef('public.icash_claim_operation(text)'::regprocedure);
 if md5(d)<>'816b5ca8f8f9c6411166cf8aca933d4a' then raise exception 'Concurrent change to icash_claim_operation';end if;
 d:=overlay(d placing $edit$ perform 1 from public.icash_wallets where account_id=a and balance_cents>0 for update;
 if not found then return false;end if;
$edit$ from 336 for 0);
 d:=overlay(d placing $edit$ perform 1 from public.icash_operating_budget where id=1 for update;
$edit$ from 169 for 0);
 execute d;
 d:=pg_get_functiondef('public.icash_manual_text_reason(uuid,uuid,uuid)'::regprocedure);
 if md5(d)<>'ef8945cef26c80dcf504b9a771b2aa89' then raise exception 'Concurrent change to icash_manual_text_reason';end if;
 d:=overlay(d placing $edit$$edit$ from 1600 for 1079);
 execute d;
 d:=pg_get_functiondef('public.icash_next_work(uuid)'::regprocedure);
 if md5(d)<>'d8abb23c13034a8adcc09bec71adcc46' then raise exception 'Concurrent change to icash_next_work';end if;
 d:=overlay(d placing $edit$ w.balance_cents as remaining
$edit$ from 416 for 214);
 execute d;
 d:=pg_get_functiondef('public.icash_research_purchase_allowed(uuid,text,uuid)'::regprocedure);
 if md5(d)<>'49e4faacc45b9dbffbb5ed1f97eea5d5' then raise exception 'Concurrent change to icash_research_purchase_allowed';end if;
 d:=overlay(d placing $edit$  if not found or a.bot_paused or not exists(select 1 from public.icash_wallets where account_id=p_account and balance_cents>0) then return false;end if;
$edit$ from 739 for 617);
 execute d;
 d:=pg_get_functiondef('public.icash_outbound_search_due(uuid)'::regprocedure);
 if md5(d)<>'c4c978df53ca5ff844f2d657d33d122c' then raise exception 'Concurrent change to icash_outbound_search_due';end if;
 d:=overlay(d placing $edit$ target:=least(20,greatest(2,ceil(capacity::numeric/1000)::integer));
$edit$ from 4469 for 81);
 d:=overlay(d placing $edit$$edit$ from 1625 for 566);
 d:=overlay(d placing $edit$ select w.balance_cents into capacity from public.icash_wallets w where account_id=p_account;
$edit$ from 1250 for 311);
 d:=overlay(d placing $edit$ if not found or a.bot_paused then return false;end if;
$edit$ from 592 for 82);
 execute d;
 d:=pg_get_functiondef('public.icash_reserve_flexible_voice(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure);
 if md5(d)<>'85252b02a7f575735f0383b135595911' then raise exception 'Concurrent change to icash_reserve_flexible_voice';end if;
 d:=overlay(d placing $edit$ update public.icash_voice_jobs set state='ready',due_at=now()+interval '1 minute',outcome='Add credits to continue calling',updated_at=now() where id=p_job;
$edit$ from 4191 for 175);
 d:=overlay(d placing $edit$  if price<=capacity or seconds=120 then
$edit$ from 3664 for 26);
 d:=overlay(d placing $edit$$edit$ from 2862 for 358);
 d:=overlay(d placing $edit$ if coalesce(capacity,0)<=0 then return null;end if;
$edit$ from 2286 for 458);
 execute d;
 d:=pg_get_functiondef('public.icash_reserve_paced_voice(uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,boolean)'::regprocedure);
 if md5(d)<>'93a2e64ebb37af6596a02007df649584' then raise exception 'Concurrent change to icash_reserve_paced_voice';end if;
 d:=overlay(d placing $edit$$edit$ from 1209 for 647);
 execute d;
 d:=pg_get_functiondef('public.icash_claim_voice_job(uuid)'::regprocedure);
 if md5(d)<>'36b9f57d37ade596f35368802bbea18c' then raise exception 'Concurrent change to icash_claim_voice_job';end if;
 d:=overlay(d placing $edit$ if not exists(select 1 from public.icash_wallets where account_id=j.account_id and balance_cents>0) then return false;end if;
$edit$ from 1945 for 162);
 execute d;
 d:=pg_get_functiondef('public.icash_reserve_direct_reception(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure);
 if md5(d)<>'77f8ac4e76aaadde0f9dfc3bbb2c255b' then raise exception 'Concurrent change to icash_reserve_direct_reception';end if;
 d:=overlay(d placing $edit$   or (c.cost_policy_id is not null and row(o.standard_cost_multiplier,o.elevenlabs_cost_multiplier) is distinct from row(b.standard_cost_multiplier,b.elevenlabs_cost_multiplier))
$edit$ from 8162 for 180);
 d:=overlay(d placing $edit$     if price>0 and price<=c.charge_cap_cents and (price<=capacity or seconds=120) then
$edit$ from 7116 for 67);
 d:=overlay(d placing $edit$   if coalesce(capacity,0)<=0 then return jsonb_build_object('allowed',false,'reason','credits_exhausted');end if;
   if capacity<c.charge_cap_cents or public.icash_vip_active(c.account_id) then
$edit$ from 6144 for 501);
 d:=overlay(d placing $edit$ if public.icash_vip_active(c.account_id) then b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;end if;
$edit$ from 5888 for 0);
 execute d;
 d:=pg_get_functiondef('public.icash_reserve_flexible_reception(uuid,text,text,text,text,text,text,text,text,text,text)'::regprocedure);
 if md5(d)<>'ed926d7d5ea1e33ef1d7c6c321752828' then raise exception 'Concurrent change to icash_reserve_flexible_reception';end if;
 d:=overlay(d placing $edit$   or (c.cost_policy_id is not null and row(o.standard_cost_multiplier,o.elevenlabs_cost_multiplier) is distinct from row(b.standard_cost_multiplier,b.elevenlabs_cost_multiplier))
$edit$ from 8004 for 180);
 d:=overlay(d placing $edit$     if price>0 and price<=c.charge_cap_cents and (price<=capacity or seconds=120) then
$edit$ from 6958 for 67);
 d:=overlay(d placing $edit$   if coalesce(capacity,0)<=0 then return jsonb_build_object('allowed',false,'reason','credits_exhausted');end if;
   if capacity<c.charge_cap_cents or public.icash_vip_active(c.account_id) then
$edit$ from 5986 for 501);
 d:=overlay(d placing $edit$ if public.icash_vip_active(c.account_id) then b.standard_cost_multiplier:=2.4;b.elevenlabs_cost_multiplier:=2.4;end if;
$edit$ from 5730 for 0);
 execute d;
 d:=pg_get_functiondef('public.icash_seller_demand_summary()'::regprocedure);
 if md5(d)<>'fb6c8fd8bbfc0ae2411a06b03596643c' then raise exception 'Concurrent change to icash_seller_demand_summary';end if;
 d:=overlay(d placing $edit$ where public.icash_credit_acquisition_allowed(ac.id)
$edit$ from 491 for 172);
 d:=overlay(d placing $edit$ select ac.id,w.balance_cents capacity
$edit$ from 157 for 253);
 execute d;
 d:=pg_get_functiondef('public.icash_arm_owner_inbound_acceptance(uuid,uuid,uuid,text,text,jsonb,text,text)'::regprocedure);
 if md5(d)<>'6d33d68236fa1f56410ca736bc1e4472' then raise exception 'Concurrent change to icash_arm_owner_inbound_acceptance';end if;
 d:=overlay(d placing $edit$$edit$ from 2599 for 109);
 d:=overlay(d placing $edit$ if w.balance_cents<=0 then raise exception 'Insufficient owner inbound credits';end if;
$edit$ from 2003 for 417);
 execute d;
 d:=pg_get_functiondef('public.icash_work_summary(uuid)'::regprocedure);
 if md5(d)<>'26e45dc4657cdbc17dda84163bedb7e0' then raise exception 'Concurrent change to icash_work_summary';end if;
 d:=overlay(d placing $edit$ 'spentCents',(select coalesce(sum(o.charged_cents-coalesce(c.covered_cents,0)),0) from public.icash_operation_spend o left join public.icash_usage_coverage c on c.operation_key=o.operation_key and c.account_id=o.account_id where o.account_id=p_account and o.state='settled'),
 'coveredUsageCents',(select coalesce(sum(covered_cents),0) from public.icash_usage_coverage where account_id=p_account),
$edit$ from 476 for 136);
 execute d;
 d:=pg_get_functiondef('icash_recorded_reception_private.automatic_components(icash_recorded_reception_private.sessions,jsonb)'::regprocedure);
 if md5(d)<>'556702ce8f268a7a7efb9611297b2a3a' then raise exception 'Concurrent change to automatic_components';end if;
 d:=overlay(d placing $edit$  or not (
   row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row((p->>'standard_cost_multiplier')::numeric,(p->>'elevenlabs_cost_multiplier')::numeric)
   or (row((p->>'standard_cost_multiplier')::numeric,(p->>'elevenlabs_cost_multiplier')::numeric) is not distinct from row(3::numeric,3::numeric)
    and row(r.standard_cost_multiplier,r.elevenlabs_cost_multiplier) is not distinct from row(2.4::numeric,2.4::numeric))
  )
$edit$ from 732 for 186);
 execute d;
end $deploy$;
revoke all on function public.icash_call_credit_available(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_call_credit_available(uuid,text) to service_role;
commit;
