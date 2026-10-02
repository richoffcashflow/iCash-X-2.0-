begin;
-- LOCAL REVIEW CANDIDATE. Apply after general-reception.sql and the existing
-- customer-funded margins / fractional / scoped-spend-activation migrations.
-- This narrow bridge changes no account, wallet, activation, rate, or operating
-- budget values, and enables nothing. Provider configuration/rate approval and
-- inbound-only pause opt-in remain separate, explicit actions.
-- Both profile rates are EXISTING incoming-call rates, not new credit. Normal
-- is 600 seconds / 430 cents; quick-test is a separately approved owner-only
-- 60 seconds / 65 cents profile. Insufficient normal funding NEVER downgrades it.
do $$
begin
 if exists(select 1 from icash_reception_private.receipts) then
  raise exception 'Customer funding bridge requires unused reception approval; reconcile prior receipts separately';
 end if;
 if to_regprocedure('public.icash_reserve_operation(uuid,text,uuid,timestamp with time zone,timestamp with time zone,boolean)') is null
  or to_regprocedure('public.icash_claim_operation(text)') is null then
  raise exception 'Existing customer spend primitives required';
 end if;
end $$;
update icash_reception_private.config set enabled=false;
-- Installed base schema allowed only 60..300 seconds. Widen its named checks
-- locally, then constrain this bridge to the two exact reviewed profiles below.
alter table icash_reception_private.config
 drop constraint config_max_duration_seconds_check,
 add constraint config_max_duration_seconds_check check(max_duration_seconds between 60 and 600),
 alter column max_duration_seconds set default 600;
alter table icash_reception_private.receipts
 drop constraint receipts_max_duration_seconds_check,
 add constraint receipts_max_duration_seconds_check check(max_duration_seconds between 60 and 600);
update icash_reception_private.config set max_duration_seconds=600;
alter table icash_reception_private.config
 add column funding_mode text not null default 'customer_credits' check(funding_mode='customer_credits'),
 add column receipt_mode text not null default 'provider_readback' check(receipt_mode='provider_readback'),
 add column call_profile text not null default 'normal' check(call_profile in ('normal','owner_quick_test')),
 add column customer_charge_cap_cents bigint not null default 430,
 add column rate_id uuid not null default 'e827a7c9-8648-4999-885c-f136fd07100e'
  references public.icash_operation_rates(id),
 add column owner_quick_test_enabled boolean not null default false,
 add column owner_quick_test_approval_reference text
  check(length(btrim(owner_quick_test_approval_reference)) between 1 and 500),
 add column owner_caller_hash text check(owner_caller_hash ~ '^[a-f0-9]{64}$'),
 add column reviewed_until timestamptz check(isfinite(reviewed_until)),
 add column allow_inbound_while_paused boolean not null default false,
 add column inbound_pause_approval_reference text
  check(length(btrim(inbound_pause_approval_reference)) between 1 and 500),
 add constraint reception_pause_opt_in check(not allow_inbound_while_paused or inbound_pause_approval_reference is not null),
 add constraint reception_call_profile check(
  (call_profile='normal' and rate_id='e827a7c9-8648-4999-885c-f136fd07100e'::uuid
   and max_duration_seconds=600 and customer_charge_cap_cents=430)
  or (call_profile='owner_quick_test' and rate_id='f93ace00-83fc-4d09-a37c-6d9d9f0a38f0'::uuid
   and max_duration_seconds=60 and customer_charge_cap_cents=65
   and owner_quick_test_enabled and owner_quick_test_approval_reference is not null and owner_caller_hash is not null)
 ),
 drop constraint reception_enabled_approval,
 add constraint reception_customer_funding_approval check(not enabled or (
  config_hash is not null and agent_id is not null and branch_id is not null
  and reviewed_version_id is not null and reviewed_until is not null
  and approved_at is not null and approval_reference is not null
  and reviewed_until>=approved_at+make_interval(secs=>max_duration_seconds+60)
 ));
-- Legacy operator amount/period columns remain for migration compatibility only.
-- They are not an admission gate or a source of funds in customer_credits mode.
alter table icash_reception_private.receipts
 add column operation_key text not null unique references public.icash_operation_spend(operation_key) deferrable initially deferred,
 add column admission_xid bigint not null default txid_current(),
 add column call_profile text not null,
 add column rate_id uuid not null references public.icash_operation_rates(id),
 add column customer_charge_cap_cents bigint not null,
 add constraint reception_receipt_profile check(
  (call_profile='normal' and rate_id='e827a7c9-8648-4999-885c-f136fd07100e'::uuid
   and max_duration_seconds=600 and customer_charge_cap_cents=430)
  or (call_profile='owner_quick_test' and rate_id='f93ace00-83fc-4d09-a37c-6d9d9f0a38f0'::uuid
   and max_duration_seconds=60 and customer_charge_cap_cents=65)
 ),
 add constraint reception_exact_operation check(operation_key='reception:'||call_sid);

-- A bool-only, service-only predicate avoids exposing the private schema to
-- ordinary invoker credit functions. It is true ONLY for a receipt inserted by
-- this bridge in the CURRENT transaction, never for an arbitrary key prefix.
create function public.icash_general_reception_pause_exempt(p_account uuid,p_operation text,p_charge bigint)
returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_reception_private.receipts r
 join icash_reception_private.config c on c.id=1 and c.account_id=r.account_id
 join public.icash_operation_rates rate on rate.id=c.rate_id
 where p_account=c.account_id and r.operation_key=p_operation
  and r.operation_key='reception:'||r.call_sid and r.admission_xid=txid_current()
  and r.state='reserved' and r.conversation_id is null and r.config_hash=c.config_hash
  and r.agent_id=c.agent_id and r.branch_id=c.branch_id and r.reviewed_version_id=c.reviewed_version_id
  and c.enabled and c.allow_inbound_while_paused and c.inbound_pause_approval_reference is not null
  and r.call_profile=c.call_profile and r.rate_id=c.rate_id
  and r.max_duration_seconds=c.max_duration_seconds and r.customer_charge_cap_cents=c.customer_charge_cap_cents
  and (c.call_profile='normal' or (c.call_profile='owner_quick_test' and c.owner_quick_test_enabled
   and c.owner_quick_test_approval_reference is not null and r.caller_hash=c.owner_caller_hash))
  and c.approved_at<=clock_timestamp()
  and c.reviewed_until>=clock_timestamp()+make_interval(secs=>c.max_duration_seconds+60)
  and rate.operation='incoming_call' and rate.enabled and rate.charge_cents=c.customer_charge_cap_cents
  and p_charge=c.customer_charge_cap_cents and rate.voice_max_duration_seconds=c.max_duration_seconds
  and rate.verified_at<=clock_timestamp()
  and rate.expires_at>=clock_timestamp()+make_interval(secs=>c.max_duration_seconds+60)
  and (not exists(select 1 from public.icash_operation_spend o where o.operation_key=p_operation)
   or exists(select 1 from public.icash_operation_spend o where o.operation_key=p_operation
    and o.account_id=c.account_id and o.rate_id=c.rate_id and o.charge_cap_cents=c.customer_charge_cap_cents)));

$$;
revoke all on function public.icash_general_reception_pause_exempt(uuid,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.icash_general_reception_pause_exempt(uuid,text,bigint) to service_role;

-- Patch ONLY the current production pause checks. pg_get_functiondef preserves
-- every other budget, paid-activation, credit, claim, and permission check. Fail
-- the entire migration on source drift rather than replacing newer logic.
do $$
declare definition text;needle text;replacement text;
begin
 definition:=pg_get_functiondef('public.icash_reserve_credit(uuid,text,bigint)'::regprocedure);
 needle:='if a.bot_paused then';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2 then
  raise exception 'Credit pause source changed; review migration before applying';
 end if;
 replacement:='if a.bot_paused and not public.icash_general_reception_pause_exempt(p_account,p_operation,p_amount) then';
 execute replace(definition,needle,replacement);
 definition:=pg_get_functiondef('public.icash_claim_before_activation(text)'::regprocedure);
 needle:='if a.bot_paused or not r.enabled';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then
  raise exception 'Claim pause source changed; review migration before applying';
 end if;
 replacement:='if (a.bot_paused and not public.icash_general_reception_pause_exempt(o.account_id,p_operation,o.charge_cap_cents)) or not r.enabled';
 execute replace(definition,needle,replacement);
end $$;

create or replace function public.icash_reserve_general_reception(
 p_call_sid text,p_called_number text,p_caller_hash text,p_receipt_nonce text,
 p_config_hash text,p_reviewed_version_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c icash_reception_private.config; r icash_reception_private.receipts;
 rate public.icash_operation_rates; o public.icash_operation_spend;
 b public.icash_operating_budget; t timestamptz; op text; cost_total numeric; planned_reserve bigint;
begin
 if p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$'
  or p_called_number is distinct from '+17816093521'
  or p_caller_hash is null or p_caller_hash !~ '^[a-f0-9]{64}$'
  or p_receipt_nonce is null or p_receipt_nonce !~ '^[a-f0-9]{64}$'
  or p_config_hash is null or p_config_hash !~ '^[a-f0-9]{64}$'
  or p_reviewed_version_id is null then
  return jsonb_build_object('allowed',false,'reason','invalid_input');
 end if;
 select * into c from icash_reception_private.config where id=1 for update;
 if not found or not c.enabled then return jsonb_build_object('allowed',false,'reason','disabled'); end if;
 if c.config_hash is distinct from p_config_hash or c.reviewed_version_id is distinct from p_reviewed_version_id then
  return jsonb_build_object('allowed',false,'reason','config_changed');
 end if;
 -- Owner quick-test is opt-in and caller-bound, never an affordability fallback.
 if c.call_profile='owner_quick_test' and (not c.owner_quick_test_enabled
  or c.owner_quick_test_approval_reference is null or c.owner_caller_hash is distinct from p_caller_hash) then
  return jsonb_build_object('allowed',false,'reason','caller_not_authorized');
 end if;
 if exists(select 1 from icash_reception_private.receipts where lower(call_sid)=lower(p_call_sid)) then
  return jsonb_build_object('allowed',false,'reason','duplicate_call');
 end if;
 if exists(select 1 from icash_reception_private.receipts where receipt_nonce=p_receipt_nonce) then
  return jsonb_build_object('allowed',false,'reason','duplicate_nonce');
 end if;
 if exists(select 1 from icash_reception_private.receipts where state='reserved') then
  return jsonb_build_object('allowed',false,'reason','concurrency_limit');
 end if;
 -- Match existing ledger lock order: budget -> account -> wallet -> rate. All
 -- locks are transaction-scoped; none is held across a provider network call.
 select * into b from public.icash_operating_budget where id=1 for update;
 if not found or not b.enabled or b.require_company_reserve then
  return jsonb_build_object('allowed',false,'reason','customer_funding_unavailable');
 end if;
 perform 1 from public.icash_accounts where id=c.account_id and owner_user_id=c.owner_user_id for update;
 if not found then return jsonb_build_object('allowed',false,'reason','account_binding_changed'); end if;
 perform 1 from public.icash_wallets where account_id=c.account_id for update;
 select * into rate from public.icash_operation_rates where id=c.rate_id for share;
 -- now() is frozen at transaction start. Re-read wall time AFTER every lock
 -- needed by reserve/claim, so a blocked transaction cannot reuse stale review.
 t:=clock_timestamp();
 if c.approved_at>t or c.reviewed_until is null
  or t+make_interval(secs=>c.max_duration_seconds+60)>c.reviewed_until then
  return jsonb_build_object('allowed',false,'reason','outside_review');
 end if;
 if rate.id is null or rate.operation<>'incoming_call' or not rate.enabled or rate.charge_cents<>c.customer_charge_cap_cents
  or not isfinite(rate.verified_at) or not isfinite(rate.expires_at)
  or rate.verified_at>t or rate.verified_at>c.approved_at
  or rate.voice_max_duration_seconds is null or rate.voice_max_duration_seconds<>c.max_duration_seconds
  or t+make_interval(secs=>c.max_duration_seconds+60)>rate.expires_at then
  return jsonb_build_object('allowed',false,'reason','rate_unavailable');
 end if;
 if (select count(*) from icash_reception_private.receipts where caller_hash=p_caller_hash
  and reserved_at>t-make_interval(secs=>c.caller_window_seconds))>=c.caller_max_calls then
  return jsonb_build_object('allowed',false,'reason','caller_throttled');
 end if;
 op:='reception:'||p_call_sid;
 -- Never recycle an orphaned prior operation, even if the upstream primitive
 -- would return its idempotent reservation. Provider dispatch is at most once.
 if exists(select 1 from public.icash_operation_spend where lower(operation_key)=lower(op))
  or exists(select 1 from public.icash_credit_reservations where lower(operation_key)=lower(op)) then
  return jsonb_build_object('allowed',false,'reason','operation_conflict');
 end if;
 -- A subtransaction rolls back ALL financial writes if claim/verification or
 -- receipt insertion fails. Known spend denials return no permission or nonce.
 begin
  -- This complete reviewed rate is a PLANNING reservation, not proof of actual
  -- all-in provider cost. Customer reservation is the exact selected profile cap.
  select sum(value::text::numeric) into cost_total from jsonb_each(rate.costs_micros);
  planned_reserve:=ceil(cost_total*(10000+rate.buffer_bps)/10000);
  insert into icash_reception_private.receipts(account_id,call_sid,called_number,caller_hash,receipt_nonce,
   config_hash,agent_id,branch_id,reviewed_version_id,max_duration_seconds,reserved_usd_micros,
   period_starts_at,period_ends_at,reserved_at,operation_key,call_profile,rate_id,customer_charge_cap_cents)
  values(c.account_id,p_call_sid,c.called_number,p_caller_hash,p_receipt_nonce,c.config_hash,c.agent_id,c.branch_id,
   c.reviewed_version_id,c.max_duration_seconds,planned_reserve,c.approved_at,c.reviewed_until,t,op,c.call_profile,c.rate_id,c.customer_charge_cap_cents)
  returning * into r;
  perform public.icash_reserve_operation(c.account_id,op,c.rate_id,least(c.reviewed_until,rate.expires_at));
  select * into strict o from public.icash_operation_spend where operation_key=op for update;
  if o.account_id<>c.account_id or o.rate_id<>c.rate_id or o.state<>'reserved'
   or o.reserved_micros<>planned_reserve or o.charge_cap_cents<>c.customer_charge_cap_cents
   or not exists(select 1 from public.icash_credit_reservations cr
    where cr.id=o.credit_reservation_id and cr.operation_key=op and cr.account_id=c.account_id
     and cr.status='reserved' and cr.amount_cents=c.customer_charge_cap_cents) then
   raise exception 'Customer reservation does not match reviewed reception rate';
  end if;
  if not public.icash_claim_operation(op) then raise exception 'Reception spending not claimable'; end if;
  t:=clock_timestamp();
  if t+make_interval(secs=>c.max_duration_seconds+60)>least(c.reviewed_until,rate.expires_at) then
   raise exception 'Reception review expired while reserving';
  end if;
 exception when raise_exception then
  return jsonb_build_object('allowed',false,'reason','customer_funding_denied');
 end;
 return jsonb_build_object('allowed',true,'reason','reserved','receipt',to_jsonb(r));
end $$;

-- icash_finish_general_reception is deliberately unchanged: exact authenticated
-- SID/nonce/agent/version/branch binding adds the real conversation_id to THIS
-- operation's immutable receipt. It does not settle/release/refund any credits,
-- fabricate a conversation, create a seller record, or unlock financial tools.
-- The existing receipt guard freezes operation_key along with the reservation.
-- A terminal receipt releases only the reception concurrency slot.

-- Minimal read-only reconciliation hook. A later authoritative usage collector
-- can join real Twilio/ElevenLabs receipts by these immutable identifiers and
-- call the EXISTING complete-cost settlement pipeline after full verification.
-- A single terminal event, partial cost observation, or call duration is never
-- sufficient to debit or refund. Until then, all customer credits stay reserved.
create function public.icash_get_general_reception_reconciliation(p_operation text)
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('operation_key',r.operation_key,'account_id',r.account_id,
  'call_sid',r.call_sid,'conversation_id',r.conversation_id,'receipt_state',r.state,
  'agent_id',r.agent_id,'branch_id',r.branch_id,'reviewed_version_id',r.reviewed_version_id,
  'terminal_at',r.terminal_at,'max_duration_seconds',r.max_duration_seconds,
  'call_profile',r.call_profile,'customer_charge_cap_cents',r.customer_charge_cap_cents,
  'rate_id',o.rate_id,'operation_state',o.state,'reserved_usd_micros',o.reserved_micros,
  'customer_reserved_cents',cr.amount_cents,'credit_state',cr.status,
  'requires_authoritative_cost_reconciliation',o.state='dispatched',
  'provider_cost_basis','planning_reserve_actual_cost_unknown')
 from icash_reception_private.receipts r
 join public.icash_operation_spend o on o.operation_key=r.operation_key and o.account_id=r.account_id
 join public.icash_credit_reservations cr on cr.id=o.credit_reservation_id and cr.account_id=r.account_id
 where r.operation_key=p_operation;
$$;
revoke all on function public.icash_get_general_reception_reconciliation(text) from public,anon,authenticated,service_role;
grant execute on function public.icash_get_general_reception_reconciliation(text) to service_role;
revoke all on function public.icash_reserve_general_reception(text,text,text,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.icash_reserve_general_reception(text,text,text,text,text,text) to service_role;
-- Owner-authenticated server control may retrieve the most recent fixed-account
-- receipt, then authenticate provider API readback before calling the exact
-- existing finish RPC. This is not publicly exposed and never settles charges.
create function public.icash_latest_general_reception_receipt()
returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(r) from icash_reception_private.receipts r
 where r.account_id='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
 order by r.reserved_at desc,r.receipt_id desc limit 1;
$$;
revoke all on function public.icash_latest_general_reception_receipt() from public,anon,authenticated,service_role;
grant execute on function public.icash_latest_general_reception_receipt() to service_role;
commit;
