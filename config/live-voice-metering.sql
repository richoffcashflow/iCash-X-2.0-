begin;
-- New calls only. This installs no pricing approval, scheduled work, or live
-- activation. Wallet reserved_cents remains zero. Internal funded exposure is
-- not a debit: only observed cumulative usage changes the customer balance.
create schema icash_voice_meter_private;
revoke all on schema icash_voice_meter_private from public,anon,authenticated,service_role;
create function icash_voice_meter_private.clock_now() returns timestamptz language sql volatile set search_path='' as $$select clock_timestamp()$$;
-- No currently integrated provider proves a hard LLM-inclusive cost ceiling.
-- A policy row cannot self-certify that missing control. A future reviewed
-- implementation must replace this gate with actual enforcement verification.
-- Only isolated tests replace it with a synthetic enforced-provider fixture.
create function icash_voice_meter_private.enforcement_supported(p jsonb) returns boolean language sql immutable set search_path='' as $$select false$$;
create table icash_voice_meter_private.settings (
 id integer primary key check(id=1),enabled boolean not null default false,
 enabled_at timestamptz check(isfinite(enabled_at)),
 check(not enabled or enabled_at is not null)
);
insert into icash_voice_meter_private.settings(id) values(1);
create table icash_voice_meter_private.policies (
 id uuid primary key default gen_random_uuid(),rate_id uuid not null references public.icash_operation_rates(id),
 version text not null unique,enabled boolean not null default false,
 rate_snapshot jsonb not null,components jsonb not null,enforcement jsonb not null,
 reviewed_at timestamptz not null check(isfinite(reviewed_at)),valid_until timestamptz not null check(isfinite(valid_until)),
 upper_bound_evidence text not null check(length(btrim(upper_bound_evidence)) between 20 and 2000),
 tail_seconds integer not null default 15 check(tail_seconds between 0 and 30),
 platform_allowance_cents bigint not null default 0 check(platform_allowance_cents=0),
 check(valid_until>reviewed_at)
);
create unique index one_enabled_voice_meter_policy on icash_voice_meter_private.policies(rate_id) where enabled;
create function icash_voice_meter_private.component_micros(p jsonb,s integer) returns numeric language plpgsql immutable set search_path='' as $$
declare units numeric;seconds numeric;result numeric;
begin
 if s<0 or s>630 then raise exception 'Invalid metered duration';end if;
 if p->>'kind'='fixed' then result:=(p->>'amountMicros')::numeric;
 elsif p->>'kind'='duration' then
  units:=(p->>'unitSeconds')::numeric;
  if units not between 1 and 600 or units<>trunc(units) or (p->>'minimumUnits')::numeric not between 0 and 10
   or (p->>'minimumUnits')::numeric<>trunc((p->>'minimumUnits')::numeric) or p->>'rounding' not in ('up','exact') then raise exception 'Reviewed duration rule required';end if;
  seconds:=greatest(case when p->>'rounding'='up' then ceil(s/units)*units else s end,(p->>'minimumUnits')::numeric*units);
  result:=ceil(seconds*(p->>'microsPerUnit')::numeric/units);
 else raise exception 'Unknown metering basis';end if;
 if result is null or result<0 or result<>trunc(result) or result>9007199254740991 then raise exception 'Invalid metering amount';end if;
 return result;
end $$;
create function icash_voice_meter_private.guard_policy() returns trigger language plpgsql set search_path='' as $$
declare r public.icash_operation_rates;k text;p jsonb;amount numeric;
begin
 if tg_op='DELETE' then raise exception 'Metering policies are immutable';end if;
 if tg_op='UPDATE' and to_jsonb(new)-'enabled' is distinct from to_jsonb(old)-'enabled' then raise exception 'Version metering policies instead';end if;
 select * into strict r from public.icash_operation_rates where id=new.rate_id;
 if r.operation not in ('seller_call','incoming_call') or r.voice_max_duration_seconds<>600
  or to_jsonb(r)-'enabled' is distinct from new.rate_snapshot or new.reviewed_at<r.verified_at or new.valid_until>r.expires_at
  or length(btrim(new.version)) not between 10 and 200 or jsonb_typeof(new.components)<>'object'
  or (select count(*) from jsonb_object_keys(new.components))<>16 then raise exception 'Exact reviewed voice rate required';end if;
 -- A quote divided by duration is NOT an inclusive LLM cost bound. Rollout
 -- requires an independently enforced per-conversation provider ceiling bound
 -- to an immutable agent configuration and verified control receipt. No such
 -- evidence or capability is installed by this migration.
 if new.enforcement->>'kind' is distinct from 'provider_inclusive_hard_cap'
  or new.enforcement->>'boundVersion' is distinct from 'inclusive-conversation-cap-v1'
  or new.enforcement->>'scope' is distinct from 'platform_and_llm_per_conversation'
  or coalesce(new.enforcement->>'configurationHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(new.enforcement->>'controlReceiptHash','') !~ '^[a-f0-9]{64}$'
  or coalesce(new.enforcement->>'agentId','') !~ '^agent_[A-Za-z0-9]+$'
  or coalesce(new.enforcement->>'branchId','') !~ '^agtbrch_[A-Za-z0-9]+$'
  or coalesce(new.enforcement->>'versionId','') !~ '^agtvrsn_[A-Za-z0-9]+$'
  or jsonb_typeof(new.enforcement->'cumulativeCeilingsMicros') is distinct from 'array'
  or jsonb_array_length(new.enforcement->'cumulativeCeilingsMicros')<>600
 then raise exception 'Enforced inclusive provider cost bound required';end if;
 for k,p in select key,value from jsonb_each(new.components) loop
  if not r.costs_micros ? k or jsonb_typeof(p->'evidenceRef') is distinct from 'string' or length(btrim(p->>'evidenceRef'))<10 then raise exception 'All metering evidence required';end if;
  amount:=icash_voice_meter_private.component_micros(p,600);
  if k in ('twilio','elevenlabs') then
   if p->>'kind'<>'duration' or amount>(r.costs_micros->>k)::numeric then raise exception 'Reviewed duration ceiling required';end if;
   if k='twilio' and p->>'rounding'<>'up' then raise exception 'Carrier rounding required';end if;
   if k='elevenlabs' and exists(select 1 from jsonb_array_elements(new.enforcement->'cumulativeCeilingsMicros') with ordinality e(value,n)
     where jsonb_typeof(e.value) is distinct from 'number' or (e.value#>>'{}')::numeric<0
      or (e.value#>>'{}')::numeric<>(trunc((e.value#>>'{}')::numeric))
      or (e.value#>>'{}')::numeric>icash_voice_meter_private.component_micros(p,e.n::integer)) then raise exception 'Enforced ceilings exceed reviewed curve';end if;
  elsif p->>'kind'<>'fixed' or amount is distinct from (r.costs_micros->>k)::numeric then raise exception 'Fixed costs must not be prorated';end if;
 end loop;
 if new.components->'llm'->>'amountMicros'<>'0' then raise exception 'Inclusive ElevenLabs model charge required';end if;
 return new;
end $$;
create trigger voice_meter_policy_guard before insert or update or delete on icash_voice_meter_private.policies for each row execute function icash_voice_meter_private.guard_policy();
create table icash_voice_meter_private.meters (
 operation_key text primary key references public.icash_credit_reservations(operation_key),account_id uuid not null references public.icash_accounts(id),
 rate_id uuid not null references public.icash_operation_rates(id),policy_id uuid not null references icash_voice_meter_private.policies(id),policy_snapshot jsonb not null,
 session_kind text not null check(session_kind in ('outbound','inbound')),session_id uuid not null,
 provider_account_sid text not null,call_sid text,from_phone text not null,to_phone text not null,direction text not null,
 max_seconds integer not null check(max_seconds between 120 and 600),authorized_seconds integer not null check(authorized_seconds between 120 and 600),
 confirmed_seconds integer not null default 0 check(confirmed_seconds between 0 and 600),version bigint not null default 1,
 standard_multiplier numeric not null,elevenlabs_multiplier numeric not null,buffer_bps integer not null,
 committed_cents bigint not null check(committed_cents>=0),provisional_cents bigint not null default 0 check(provisional_cents>=0),
 elapsed_seconds integer not null default 0 check(elapsed_seconds between 0 and 630),start_at timestamptz,terminal_at timestamptz,terminal_receipt jsonb,
 state text not null default 'active' check(state in ('active','stopping','terminal','settled','cancelled')),
 final_charge_cents bigint,final_evidence text,final_ledger_id uuid,
 cancelled_at timestamptz,cancellation_evidence jsonb,
 created_at timestamptz not null default icash_voice_meter_private.clock_now(),updated_at timestamptz not null default icash_voice_meter_private.clock_now(),
 next_check_at timestamptz not null default icash_voice_meter_private.clock_now(),
 unique(session_kind,session_id),unique(provider_account_sid,call_sid),
 check(authorized_seconds<=max_seconds and confirmed_seconds<=authorized_seconds),
 check(provisional_cents<=committed_cents),check((state='settled')=(final_charge_cents is not null)),
 check((state='cancelled')=(cancelled_at is not null and cancellation_evidence is not null))
);
create table icash_voice_meter_private.entries (
 operation_key text not null references icash_voice_meter_private.meters(operation_key),elapsed_seconds integer not null,
 cumulative_cents bigint not null,delta_cents bigint not null check(delta_cents>0),ledger_id uuid not null unique references public.icash_credit_ledger(id),
 observed_at timestamptz not null,receipt_hash text not null,primary key(operation_key,elapsed_seconds)
);
create function icash_voice_meter_private.price(m icash_voice_meter_private.meters,s integer,funded boolean default false) returns bigint language plpgsql stable set search_path='' as $$
declare k text;p jsonb;cost numeric;total numeric:=0;seconds integer;
begin
 if s=0 and not funded then return 0;end if;
 seconds:=case when funded then least(m.max_seconds,s+(m.policy_snapshot->>'tail_seconds')::integer) else s end;
 for k,p in select key,value from jsonb_each(m.policy_snapshot->'components') loop
  cost:=icash_voice_meter_private.component_micros(p,seconds);
  total:=total+cost*case when k='elevenlabs' then m.elevenlabs_multiplier else m.standard_multiplier end;
 end loop;
 return ceil(total*case when funded then (10000+m.buffer_bps)::numeric/10000 else 1 end/10000)::bigint;
end $$;
-- Outstanding historical authorizations are exposure, not invented charges or
-- rewritten holds. For a new metered call substitute ONLY its funded remainder.
create function icash_voice_meter_private.exposure(a uuid,except_operation text default null,only_meters boolean default false) returns bigint language sql stable set search_path='' as $$
 select coalesce(sum(case when m.operation_key is not null then greatest(0,m.committed_cents-m.provisional_cents) else r.amount_cents end),0)::bigint
 from public.icash_credit_reservations r left join icash_voice_meter_private.meters m on m.operation_key=r.operation_key
 where r.account_id=a and r.status='reserved' and r.operation_key is distinct from except_operation and (not only_meters or m.operation_key is not null)
$$;
create function icash_voice_meter_private.json(m icash_voice_meter_private.meters) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('accountId',m.account_id,'operationKey',m.operation_key,'sessionKind',m.session_kind,'sessionId',m.session_id,
 'providerAccountSid',m.provider_account_sid,'callSid',m.call_sid,'fromPhone',m.from_phone,'toPhone',m.to_phone,'direction',m.direction,
 'maxSeconds',m.max_seconds,'authorizedSeconds',m.authorized_seconds,'confirmedSeconds',m.confirmed_seconds,'version',m.version,
 'provisionalCents',m.provisional_cents,'committedCents',m.committed_cents,'state',m.state)
$$;
create function public.icash_prepare_voice_meter(p_account uuid,p_operation text,p_session_kind text,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m icash_voice_meter_private.meters;o public.icash_operation_spend;p icash_voice_meter_private.policies;s jsonb;balance bigint;activated timestamptz;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation and account_id=p_account for update;
 if not found then return jsonb_build_object('status','held','reason','operation_missing');end if;
 select balance_cents into strict balance from public.icash_wallets where account_id=p_account for update;
 select * into m from icash_voice_meter_private.meters where operation_key=p_operation;
 if found then
  if row(m.account_id,m.session_kind,m.session_id) is distinct from row(p_account,p_session_kind,p_session) then raise exception 'Meter identity conflict';end if;
  if m.state='cancelled' then return jsonb_build_object('status','held','reason','meter_cancelled');end if;
  return jsonb_build_object('status','ready','meter',icash_voice_meter_private.json(m));
 end if;
 select enabled_at into activated from icash_voice_meter_private.settings where id=1 and enabled;
 if not found then return jsonb_build_object('status','disabled');end if;
 if p_session_kind='outbound' then select to_jsonb(r) into s from public.icash_call_recordings r where id=p_session and account_id=p_account and operation_key=p_operation;
 elsif p_session_kind='inbound' then select to_jsonb(r) into s from icash_recorded_reception_private.sessions r where id=p_session and account_id=p_account and operation_key=p_operation;
 else raise exception 'Meter session kind invalid';end if;
 if s is null or o.state<>'dispatched' or (s->>'created_at')::timestamptz<activated or s->>'dial_claimed_at' is not null or s->>'setup_claimed_at' is not null
  or s->>'start_claimed_at' is not null or (s->>'rate_id')::uuid is distinct from o.rate_id or (s->>'max_total_seconds')::integer not between 120 and 600
  or s->>'provider_account_sid' !~ '^AC[0-9a-fA-F]{32}$' then return jsonb_build_object('status','held','reason','new_bound_session_required');end if;
 select * into p from icash_voice_meter_private.policies where rate_id=o.rate_id and enabled and reviewed_at<=icash_voice_meter_private.clock_now() and valid_until>icash_voice_meter_private.clock_now()+interval '11 minutes';
 if not found then return jsonb_build_object('status','held','reason','reviewed_upper_bound_required');end if;
 if not icash_voice_meter_private.enforcement_supported(p.enforcement) then return jsonb_build_object('status','held','reason','enforced_cost_control_unavailable');end if;
 if row(s->>'agent_id',s->>'branch_id',s->>'version_id') is distinct from row(p.enforcement->>'agentId',p.enforcement->>'branchId',p.enforcement->>'versionId')
  or (s ? 'config_hash' and s->>'config_hash' is distinct from p.enforcement->>'configurationHash')
  or p.rate_snapshot->>'operation' is distinct from (case when p_session_kind='outbound' then 'seller_call' else 'incoming_call' end)
 then return jsonb_build_object('status','held','reason','enforced_provider_configuration_mismatch');end if;
 m.operation_key:=p_operation;m.account_id:=p_account;m.rate_id:=o.rate_id;m.policy_id:=p.id;m.policy_snapshot:=to_jsonb(p);
 m.session_kind:=p_session_kind;m.session_id:=p_session;m.provider_account_sid:=s->>'provider_account_sid';m.call_sid:=s->>'call_sid';m.from_phone:=s->>'from_phone';m.to_phone:=s->>'to_phone';
 m.direction:=case when p_session_kind='outbound' then 'outbound-api' else 'inbound' end;m.max_seconds:=(s->>'max_total_seconds')::integer;
 m.authorized_seconds:=120;m.confirmed_seconds:=0;m.version:=1;m.standard_multiplier:=o.standard_cost_multiplier;m.elevenlabs_multiplier:=o.elevenlabs_cost_multiplier;
 select buffer_bps into strict m.buffer_bps from public.icash_operation_rates where id=o.rate_id and enabled and to_jsonb(icash_operation_rates)-'enabled'=p.rate_snapshot;
 m.committed_cents:=icash_voice_meter_private.price(m,120,true);
 if m.committed_cents>o.charge_cap_cents or balance-icash_voice_meter_private.exposure(p_account,p_operation)<m.committed_cents then return jsonb_build_object('status','held','reason','funded_minimum_unavailable');end if;
 insert into icash_voice_meter_private.meters(operation_key,account_id,rate_id,policy_id,policy_snapshot,session_kind,session_id,provider_account_sid,call_sid,from_phone,to_phone,direction,max_seconds,authorized_seconds,standard_multiplier,elevenlabs_multiplier,buffer_bps,committed_cents)
 values(m.operation_key,m.account_id,m.rate_id,m.policy_id,m.policy_snapshot,m.session_kind,m.session_id,m.provider_account_sid,m.call_sid,m.from_phone,m.to_phone,m.direction,m.max_seconds,120,m.standard_multiplier,m.elevenlabs_multiplier,m.buffer_bps,m.committed_cents) returning * into m;
 return jsonb_build_object('status','ready','meter',icash_voice_meter_private.json(m));
end $$;
-- This is database evidence of no provider claim, NOT a zero-cost provider
-- receipt. Inbound already has a carrier leg and can never use this recovery.
create function icash_voice_meter_private.unstarted_outbound(m icash_voice_meter_private.meters,r public.icash_call_recordings) returns boolean language sql immutable set search_path='' as $$
 select coalesce(m.session_kind='outbound' and m.state='active' and m.call_sid is null
 and m.version=1 and m.authorized_seconds=120 and m.confirmed_seconds=0 and m.provisional_cents=0 and m.elapsed_seconds=0
 and m.start_at is null and m.terminal_at is null and m.terminal_receipt is null and m.final_charge_cents is null
 and row(r.id,r.account_id,r.operation_key,r.rate_id,r.provider_account_sid,r.from_phone,r.to_phone,r.max_total_seconds)
  is not distinct from row(m.session_id,m.account_id,m.operation_key,m.rate_id,m.provider_account_sid,m.from_phone,m.to_phone,m.max_seconds)
 and r.state='consent_pending' and r.call_sid is null and r.dial_claimed_at is null and r.start_claimed_at is null
 and r.recording_sid is null and r.conversation_id is null and r.provider_started_at is null
 and r.recording_authorized_at is null and r.consent_at is null and r.ended_at is null and r.duration_seconds is null
 and r.call_ended_at is null and r.end_requested_at is null and r.provider_recording_price_micros is null,false)
$$;
create function public.icash_cancel_unstarted_voice_meter(p_account uuid,p_operation text,p_session uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare m icash_voice_meter_private.meters;o public.icash_operation_spend;r public.icash_call_recordings;c public.icash_credit_reservations;reserved bigint;t timestamptz:=icash_voice_meter_private.clock_now();evidence jsonb;
begin
 -- Same accounting order as admission/settlement. Existing provider transition
 -- locks only its recording row and reads these guards; it never locks budget
 -- or wallet after that row. The recording FOR UPDATE serializes cancel/claim.
 select reserved_micros into strict reserved from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation and account_id=p_account for update;
 if not found then return jsonb_build_object('status','held','cancelled',false,'reason','operation_missing');end if;
 perform 1 from public.icash_wallets where account_id=p_account for update;
 select * into m from icash_voice_meter_private.meters where operation_key=p_operation and account_id=p_account and session_kind='outbound' and session_id=p_session for update;
 if not found then return jsonb_build_object('status','held','cancelled',false,'reason','exact_new_outbound_meter_required');end if;
 if m.state='cancelled' then return jsonb_build_object('status','cancelled','cancelled',true,'alreadyCancelled',true,'meter',icash_voice_meter_private.json(m));end if;
 select * into r from public.icash_call_recordings where id=p_session and account_id=p_account and operation_key=p_operation for update;
 if not found or not icash_voice_meter_private.unstarted_outbound(m,r) then return jsonb_build_object('status','held','cancelled',false,'reason','provider_start_not_disproved');end if;
 select * into c from public.icash_credit_reservations where id=o.credit_reservation_id and account_id=p_account and operation_key=p_operation for update;
 if not found or c.status<>'reserved' or c.settled_cents is not null or c.amount_cents is distinct from o.charge_cap_cents
  or r.charge_cap_cents is distinct from o.charge_cap_cents or o.rate_id is distinct from m.rate_id or o.state<>'dispatched'
  or o.actual_micros is not null or o.charged_cents is not null or o.settled_at is not null or o.settlement_evidence is not null
  or o.reserved_micros is null or o.reserved_micros<0 or reserved<o.reserved_micros
  or exists(select 1 from icash_voice_meter_private.entries where operation_key=p_operation)
  or exists(select 1 from public.icash_cost_manifests where operation_key=p_operation)
  or exists(select 1 from public.icash_cost_observations where source_ref=p_operation)
 then return jsonb_build_object('status','held','cancelled',false,'reason','unspent_accounting_binding_required');end if;
 evidence:=jsonb_build_object('kind','database_proven_unclaimed_outbound','sessionId',r.id,'operationKey',m.operation_key,
  'creditReservationId',c.id,'releasedOperatingMicros',o.reserved_micros,'releasedCommitmentCents',m.committed_cents,'checkedAt',t);
 -- Only this exact, still-unspent authorization is released once. No wallet,
 -- ledger, cost manifest, provider receipt or historical session is rewritten.
 update public.icash_credit_reservations set status='released' where id=c.id;
 update public.icash_operating_budget set reserved_micros=reserved_micros-o.reserved_micros where id=1;
 update public.icash_operation_spend set state='cancelled',actual_micros=0,charged_cents=0,settled_at=t,
  settlement_evidence='Database proven unclaimed outbound meter: '||m.operation_key where operation_key=p_operation;
 update icash_voice_meter_private.meters set state='cancelled',committed_cents=0,cancelled_at=t,cancellation_evidence=evidence,updated_at=t where operation_key=p_operation returning * into m;
 return jsonb_build_object('status','cancelled','cancelled',true,'alreadyCancelled',false,'meter',icash_voice_meter_private.json(m));
end $$;
create function icash_voice_meter_private.recover_unstarted(p_limit integer default 20) returns integer language plpgsql set search_path='' as $$
declare candidate record;result jsonb;recovered integer:=0;
begin
 if p_limit is null or p_limit not between 1 and 100 then raise exception 'Invalid recovery batch';end if;
 -- Lock accounting first, never a session/meter before the budget. Age makes
 -- these admissions ineligible to claim, but age ALONE cannot release funds.
 perform 1 from public.icash_operating_budget where id=1 for update;
 for candidate in select m.account_id,m.operation_key,m.session_id from icash_voice_meter_private.meters m
  join public.icash_call_recordings r on r.id=m.session_id and r.account_id=m.account_id and r.operation_key=m.operation_key
  where m.created_at<icash_voice_meter_private.clock_now()-interval '1 minute' and icash_voice_meter_private.unstarted_outbound(m,r)
  order by m.created_at,m.operation_key limit p_limit
 loop
  result:=public.icash_cancel_unstarted_voice_meter(candidate.account_id,candidate.operation_key,candidate.session_id);
  if result->>'cancelled'='true' then recovered:=recovered+1;end if;
 end loop;
 return recovered;
end $$;
create function icash_voice_meter_private.call_matches(m icash_voice_meter_private.meters,c jsonb) returns boolean language sql stable set search_path='' as $$
 select coalesce(c->>'sid' ~ '^CA[0-9a-fA-F]{32}$' and c->>'account_sid'=m.provider_account_sid and c->>'from'=m.from_phone and c->>'to'=m.to_phone and c->>'direction'=m.direction
 and (m.call_sid is null or c->>'sid'=m.call_sid)
 and case m.session_kind when 'outbound' then exists(select 1 from public.icash_call_recordings r where r.id=m.session_id and r.account_id=m.account_id and r.operation_key=m.operation_key and r.call_sid=c->>'sid')
 else exists(select 1 from icash_recorded_reception_private.sessions r where r.id=m.session_id and r.account_id=m.account_id and r.operation_key=m.operation_key and r.call_sid=c->>'sid') end,false)
$$;
create function public.icash_advance_voice_meter(p_operation text,p_call jsonb,p_observed_at timestamptz default null) returns jsonb language plpgsql security definer set search_path='' as $$
declare m icash_voice_meter_private.meters;balance bigint;t timestamptz:=icash_voice_meter_private.clock_now();started timestamptz;ended timestamptz;seconds integer;price bigint;delta bigint;funded bigint;next_seconds integer;entry uuid;stop boolean:=false;renew integer;terminal boolean;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from icash_voice_meter_private.meters where operation_key=p_operation;
 if not found then
  if exists(select 1 from public.icash_operation_spend where operation_key=p_operation) then return jsonb_build_object('status','disabled');end if;
  return jsonb_build_object('status','held','reason','operation_missing');
 end if;
 select balance_cents into strict balance from public.icash_wallets where account_id=m.account_id for update;
 select * into strict m from icash_voice_meter_private.meters where operation_key=p_operation for update;
 if m.state='cancelled' then return jsonb_build_object('status','held','reason','meter_cancelled');end if;
 if not icash_voice_meter_private.call_matches(m,p_call) or p_observed_at is not null and (not isfinite(p_observed_at) or p_observed_at>t or p_observed_at<t-interval '20 seconds') then raise exception 'Fresh canonical call binding required';end if;
 if m.state='settled' then return jsonb_build_object('status','ready','meter',icash_voice_meter_private.json(m),'terminate',false);end if;
 terminal:=p_call->>'status' in ('completed','failed','busy','no-answer','canceled');
 if m.terminal_at is not null then
  if not terminal or row(p_call->>'status',p_call->>'start_time',p_call->>'duration',p_call->>'end_time') is distinct from row(m.terminal_receipt->>'status',m.terminal_receipt->>'start_time',m.terminal_receipt->>'duration',m.terminal_receipt->>'end_time') then raise exception 'Terminal call receipt conflict';end if;
  return jsonb_build_object('status','ready','meter',icash_voice_meter_private.json(m),'terminate',false);
 end if;
 if p_call->>'status' not in ('queued','initiated','ringing','in-progress','completed','failed','busy','no-answer','canceled') then raise exception 'Canonical carrier status required';end if;
 if p_call->>'start_time' is not null then
  started:=(p_call->>'start_time')::timestamptz;
  if not isfinite(started) or started>t or started<m.created_at-interval '60 seconds' or m.start_at is not null and m.start_at<>started then raise exception 'Immutable carrier start required';end if;
 elsif m.start_at is not null then raise exception 'Carrier start disappeared';end if;
 if terminal then
  ended:=case when p_call->>'end_time' is not null then (p_call->>'end_time')::timestamptz else t end;
  if not isfinite(ended) or ended>t or started is not null and ended<started then raise exception 'Canonical terminal time required';end if;
  if p_call->>'status'='completed' and (started is null or p_call->>'end_time' is null or coalesce(p_call->>'duration','') !~ '^[0-9]{1,3}$') then raise exception 'Completed duration required';end if;
  seconds:=case when started is null then 0 else (p_call->>'duration')::integer end;
  if seconds is null or seconds<0 or seconds>m.max_seconds+30 then raise exception 'Terminal duration outside bound';end if;
 else seconds:=case when started is null then 0 else greatest(m.elapsed_seconds,floor(extract(epoch from t-started))::integer) end;end if;
 -- No invented time after the hard ceiling. A late receipt outside its funded
 -- envelope is retained for review and cannot create platform coverage.
 if seconds>m.authorized_seconds+(m.policy_snapshot->>'tail_seconds')::integer or seconds>m.max_seconds then stop:=true;end if;
 price:=icash_voice_meter_private.price(m,least(seconds,m.max_seconds),false);
 delta:=greatest(0,price-m.provisional_cents);
 if delta>0 and (price>m.committed_cents or balance-icash_voice_meter_private.exposure(m.account_id,m.operation_key)<delta) then stop:=true;
 elsif delta>0 then
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref) values(m.account_id,'usage-meter:'||m.operation_key||':'||seconds,'usage',-delta,'Provisional elapsed usage; reviewed metering policy '||(m.policy_snapshot->>'version')) returning id into entry;
  insert into icash_voice_meter_private.entries values(m.operation_key,seconds,price,delta,entry,t,encode(sha256(convert_to(p_call::text,'UTF8')),'hex'));
  update public.icash_wallets set balance_cents=balance_cents-delta where account_id=m.account_id;
  balance:=balance-delta;m.provisional_cents:=price;
 end if;
 m.call_sid:=p_call->>'sid';m.start_at:=coalesce(m.start_at,started);m.elapsed_seconds:=greatest(m.elapsed_seconds,least(seconds,630));
 if terminal then m.state:='terminal';m.terminal_at:=ended;m.terminal_receipt:=p_call;
 elsif m.state='stopping' or stop or t>=m.created_at+interval '12 minutes' then m.state:='stopping';stop:=true;
 elsif started is not null and m.authorized_seconds-seconds<=60 and m.authorized_seconds<m.max_seconds then
  -- Never send a later extension while an earlier command is unconfirmed.
  if m.confirmed_seconds<>m.authorized_seconds then stop:=true;m.state:='stopping';
  else
   next_seconds:=least(m.max_seconds,m.authorized_seconds+60);funded:=icash_voice_meter_private.price(m,next_seconds,true);
   if funded-m.provisional_cents<=balance-icash_voice_meter_private.exposure(m.account_id,m.operation_key)
    and funded<=(select charge_cap_cents from public.icash_operation_spend where operation_key=m.operation_key)
    and (m.policy_snapshot->>'valid_until')::timestamptz>t+make_interval(secs=>next_seconds-seconds) then
    m.authorized_seconds:=next_seconds;m.committed_cents:=funded;m.version:=m.version+1;renew:=next_seconds;
   else stop:=true;m.state:='stopping';end if;
  end if;
 end if;
 update icash_voice_meter_private.meters set call_sid=m.call_sid,start_at=m.start_at,elapsed_seconds=m.elapsed_seconds,provisional_cents=m.provisional_cents,
 authorized_seconds=m.authorized_seconds,committed_cents=m.committed_cents,version=m.version,state=m.state,terminal_at=m.terminal_at,terminal_receipt=m.terminal_receipt,updated_at=t,next_check_at=t+interval '10 seconds' where operation_key=m.operation_key;
 return jsonb_build_object('status','ready','meter',icash_voice_meter_private.json(m),'terminate',stop and not terminal)||case when renew is not null then jsonb_build_object('desiredTimeLimit',renew) else '{}'::jsonb end;
end $$;
create function public.icash_confirm_voice_meter_limit(p_operation text,p_version bigint,p_seconds integer,p_call jsonb) returns boolean language plpgsql security definer set search_path='' as $$
declare m icash_voice_meter_private.meters;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from icash_voice_meter_private.meters where operation_key=p_operation for update;
 -- Twilio does not return TimeLimit in its Call resource. The server adapter
 -- attests a successful fixed-endpoint update/create with these exact command
 -- arguments. A GET is not confirmation and must never call this RPC.
 if not found or m.state<>'active' or m.version<>p_version or m.authorized_seconds<>p_seconds or not icash_voice_meter_private.call_matches(m,p_call)
  or p_call->>'status' not in ('queued','initiated','ringing','in-progress') then return false;end if;
 update icash_voice_meter_private.meters set confirmed_seconds=p_seconds,call_sid=p_call->>'sid',updated_at=icash_voice_meter_private.clock_now() where operation_key=p_operation;
 return true;
end $$;
create function public.icash_voice_meter_due(p_limit integer default 20) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 if p_limit not between 1 and 100 then raise exception 'Invalid metering batch';end if;
 -- Filter unbound/unknown dial admissions BEFORE pagination. Their exposure
 -- remains protected, but they must not starve calls with canonical identities.
 return coalesce((select jsonb_agg(icash_voice_meter_private.json(d.m)||jsonb_build_object('callSid',d.call_id)) from (
  select m,b.call_id from icash_voice_meter_private.meters m cross join lateral (
   select case when m.session_kind='outbound' then
    (select r.call_sid from public.icash_call_recordings r where r.id=m.session_id and r.account_id=m.account_id and r.operation_key=m.operation_key and (m.call_sid is null or m.call_sid=r.call_sid))
    else (select r.call_sid from icash_recorded_reception_private.sessions r where r.id=m.session_id and r.account_id=m.account_id and r.operation_key=m.operation_key and (m.call_sid is null or m.call_sid=r.call_sid)) end as call_id
  ) b where m.state in ('active','stopping') and m.next_check_at<=icash_voice_meter_private.clock_now() and b.call_id ~ '^CA[0-9a-fA-F]{32}$'
  order by m.next_check_at,m.operation_key limit p_limit
 ) d),'[]'::jsonb);
end $$;
-- Provider-start claims, rather than generic operation claims, are the final
-- boundary: the existing pipeline creates its recording session after claim.
create function icash_voice_meter_private.guard_provider_claim() returns trigger language plpgsql security definer set search_path='' as $$
declare flag boolean;claimed boolean;m icash_voice_meter_private.meters;
begin
 select enabled into flag from icash_voice_meter_private.settings where id=1;
 claimed:=case when tg_table_schema='public' then to_jsonb(old)->>'dial_claimed_at' is null and to_jsonb(new)->>'dial_claimed_at' is not null else to_jsonb(old)->>'setup_claimed_at' is null and to_jsonb(new)->>'setup_claimed_at' is not null end;
 if not claimed then return new;end if;
 select * into m from icash_voice_meter_private.meters where operation_key=new.operation_key and account_id=new.account_id and session_id=new.id;
 if not found and not flag then return new;end if;
 if not found or m.state<>'active' or m.authorized_seconds<>120
  or m.created_at<icash_voice_meter_private.clock_now()-interval '1 minute'
  or (m.policy_snapshot->>'valid_until')::timestamptz<=icash_voice_meter_private.clock_now()+make_interval(secs=>m.max_seconds+30)
  or not icash_voice_meter_private.enforcement_supported(m.policy_snapshot->'enforcement')
 then raise exception 'Funded voice meter required before provider start';end if;
 return new;
end $$;
create trigger voice_meter_dial_guard before update on public.icash_call_recordings for each row execute function icash_voice_meter_private.guard_provider_claim();
create trigger voice_meter_setup_guard before update on icash_recorded_reception_private.sessions for each row execute function icash_voice_meter_private.guard_provider_claim();
-- Keep business maximum/deadline unchanged; attest the actual short carrier
-- deadline installed for this metered call rather than claiming a 600s update.
do $$ declare d text;needle text:='p_payload->''timeLimitSeconds'' is distinct from to_jsonb(r.max_total_seconds)';begin
 d:=pg_get_functiondef('public.icash_transition_recorded_reception(uuid,uuid,text,bigint,text,jsonb)'::regprocedure);
 if position(needle in d)=0 then raise exception 'Reception cap attestation prerequisite changed';end if;
 execute replace(d,needle,'p_payload->''timeLimitSeconds'' is distinct from to_jsonb(coalesce((select m.confirmed_seconds from icash_voice_meter_private.meters m where m.operation_key=r.operation_key and m.account_id=r.account_id and m.session_id=r.id and m.confirmed_seconds=m.authorized_seconds and m.state=''active''),r.max_total_seconds))');
end $$;

alter function public.icash_reserve_credit(uuid,text,bigint) rename to icash_reserve_credit_before_meter;
create function public.icash_reserve_credit(p_account uuid,p_operation text,p_amount bigint) returns uuid language plpgsql security definer set search_path='' as $$
declare balance bigint;guard boolean;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account for update;
 select balance_cents into strict balance from public.icash_wallets where account_id=p_account for update;
 select enabled into guard from icash_voice_meter_private.settings where id=1;
 -- Voice maximum authorizations remain non-holds. Provider admission separately
 -- funds the initial bounded segment. Other paid actions protect their ceiling.
 if (guard or icash_voice_meter_private.exposure(p_account,null,true)>0) and not exists(select 1 from public.icash_credit_reservations where operation_key=p_operation)
  and p_operation not like 'voice:%' and p_operation not like 'recorded-reception:%'
  and balance-icash_voice_meter_private.exposure(p_account,p_operation)<p_amount then raise exception 'Credits committed to pending usage';end if;
 return public.icash_reserve_credit_before_meter(p_account,p_operation,p_amount);
end $$;
alter function public.icash_claim_operation(text) rename to icash_claim_operation_before_meter;
create function public.icash_claim_operation(p_operation text) returns boolean language plpgsql security definer set search_path='' as $$
declare o public.icash_operation_spend;balance bigint;guard boolean;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into o from public.icash_operation_spend where operation_key=p_operation for update;
 if not found then return false;end if;
 perform 1 from public.icash_accounts where id=o.account_id for update;
 select balance_cents into strict balance from public.icash_wallets where account_id=o.account_id for update;
 select enabled into guard from icash_voice_meter_private.settings where id=1;
 if (guard or icash_voice_meter_private.exposure(o.account_id,null,true)>0) and p_operation not like 'voice:%' and p_operation not like 'recorded-reception:%'
  and balance-icash_voice_meter_private.exposure(o.account_id,p_operation)<o.charge_cap_cents then return false;end if;
 return public.icash_claim_operation_before_meter(p_operation);
end $$;
alter function public.icash_finish_credit(uuid,text,bigint,text) rename to icash_finish_credit_before_meter;
create function public.icash_finish_credit(p_account uuid,p_operation text,p_charge bigint,p_evidence text) returns text language plpgsql security definer set search_path='' as $$
declare m icash_voice_meter_private.meters;r public.icash_credit_reservations;balance bigint;delta bigint;entry uuid;result text;protected bigint;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select balance_cents into strict balance from public.icash_wallets where account_id=p_account for update;
 select * into m from icash_voice_meter_private.meters where operation_key=p_operation for update;
 if not found then
  protected:=icash_voice_meter_private.exposure(p_account,p_operation,not exists(select 1 from public.icash_credit_reservations prior cross join icash_voice_meter_private.settings s where prior.operation_key=p_operation and s.enabled and prior.created_at>=s.enabled_at));
  if protected>0 and balance-protected<p_charge then raise exception 'Credits committed to active calls';end if;
  return public.icash_finish_credit_before_meter(p_account,p_operation,p_charge,p_evidence);
 end if;
 if m.account_id<>p_account or p_charge is null or p_charge<0 or p_evidence is null or length(btrim(p_evidence))<10 then raise exception 'Meter settlement binding required';end if;
 select * into strict r from public.icash_credit_reservations where operation_key=p_operation and account_id=p_account for update;
 if m.state='settled' then
  if m.final_charge_cents is distinct from p_charge or m.final_evidence is distinct from p_evidence then raise exception 'Meter settlement conflict';end if;
  return r.status;
 end if;
 if m.state<>'terminal' or m.terminal_at is null or r.status<>'reserved' or p_charge>r.amount_cents or p_charge>m.committed_cents
  or not exists(select 1 from public.icash_cost_manifests where operation_key=p_operation and charge_cents=p_charge and evidence_ref=p_evidence) then raise exception 'Meter final receipt or funded ceiling requires review';end if;
 delta:=p_charge-m.provisional_cents;
 if delta>0 and balance-icash_voice_meter_private.exposure(p_account,p_operation)<delta then raise exception 'Metered shortfall requires review; no platform coverage';end if;
 if delta<>0 then
  insert into public.icash_credit_ledger(account_id,event_key,kind,delta_cents,evidence_ref)
  values(p_account,case when delta>0 then 'usage:' else 'usage-meter-adjustment:' end||p_operation,case when delta>0 then 'usage' else 'grant' end,-delta,p_evidence) returning id into entry;
  update public.icash_wallets set balance_cents=balance_cents-delta where account_id=p_account;
 end if;
 result:=case when p_charge=0 then 'released' else 'settled' end;
 update public.icash_credit_reservations set status=result,settled_cents=case when p_charge>0 then p_charge else null end where operation_key=p_operation;
 update icash_voice_meter_private.meters set state='settled',final_charge_cents=p_charge,final_evidence=p_evidence,final_ledger_id=entry,updated_at=icash_voice_meter_private.clock_now() where operation_key=p_operation;
 return result;
end $$;
alter function public.icash_post_credit(uuid,text,text,bigint,text) rename to icash_post_credit_before_meter;
create function public.icash_post_credit(p_account uuid,p_event text,p_kind text,p_amount bigint,p_evidence text) returns uuid language plpgsql security definer set search_path='' as $$
declare balance bigint;
begin
 select balance_cents into strict balance from public.icash_wallets where account_id=p_account for update;
 if p_amount<0 and not exists(select 1 from public.icash_credit_ledger where event_key=p_event) and balance+p_amount<icash_voice_meter_private.exposure(p_account,null,not (select enabled from icash_voice_meter_private.settings where id=1)) then raise exception 'Credits committed to active calls';end if;
 return public.icash_post_credit_before_meter(p_account,p_event,p_kind,p_amount,p_evidence);
end $$;
-- Net provisional adjustments in the existing usage display; no new daily cap.
do $$ declare d text;needle text:='kind=''usage'' or event_key like ''usage-coverage:%''';begin
 d:=pg_get_functiondef('public.icash_daily_allowance(uuid)'::regprocedure);
 if position(needle in d)=0 then raise exception 'Available-credit allowance prerequisite changed';end if;
 execute replace(d,needle,needle||' or event_key like ''usage-meter-adjustment:%''');
end $$;
create function public.icash_voice_meter_settlement_valid(p_account uuid,p_operation text,p_charge bigint,p_evidence text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_voice_meter_private.meters m where m.account_id=p_account and m.operation_key=p_operation and m.state='settled' and m.final_charge_cents=p_charge and m.final_evidence=p_evidence
 and m.provisional_cents=coalesce((select sum(e.delta_cents) from icash_voice_meter_private.entries e join public.icash_credit_ledger l on l.id=e.ledger_id and l.account_id=p_account and l.kind='usage' and l.delta_cents=-e.delta_cents where e.operation_key=p_operation),0)
 and -p_charge=coalesce((select sum(l.delta_cents) from public.icash_credit_ledger l where l.id=m.final_ledger_id or exists(select 1 from icash_voice_meter_private.entries e where e.operation_key=p_operation and e.ledger_id=l.id)),0))
$$;
-- Preserve all original receipt checks; accept the summed metering ledger only
-- for a row finalized by the new accounting path, never for historical calls.
do $$ declare d text;needle text:='and ((o.charged_cents=0';replacement text:='and (public.icash_voice_meter_settlement_valid(o.account_id,o.operation_key,o.charged_cents,o.settlement_evidence) or (o.charged_cents=0';begin
 d:=pg_get_functiondef('public.icash_get_outbound_usage_settlement(uuid,uuid)'::regprocedure);
 if position(needle in d)=0 then raise exception 'Outbound settlement proof prerequisite changed';end if;
 execute replace(d,needle,replacement);
end $$;
alter table icash_voice_meter_private.settings enable row level security;
alter table icash_voice_meter_private.policies enable row level security;
alter table icash_voice_meter_private.meters enable row level security;
alter table icash_voice_meter_private.entries enable row level security;
revoke all on all tables in schema icash_voice_meter_private from public,anon,authenticated,service_role;
revoke all on all functions in schema icash_voice_meter_private from public,anon,authenticated,service_role;
revoke all on function public.icash_cancel_unstarted_voice_meter(uuid,text,uuid),public.icash_prepare_voice_meter(uuid,text,text,uuid),public.icash_advance_voice_meter(text,jsonb,timestamptz),public.icash_confirm_voice_meter_limit(text,bigint,integer,jsonb),public.icash_voice_meter_due(integer),public.icash_voice_meter_settlement_valid(uuid,text,bigint,text),public.icash_reserve_credit(uuid,text,bigint),public.icash_finish_credit(uuid,text,bigint,text),public.icash_post_credit(uuid,text,text,bigint,text) from public,anon,authenticated;
grant execute on function public.icash_cancel_unstarted_voice_meter(uuid,text,uuid),public.icash_prepare_voice_meter(uuid,text,text,uuid),public.icash_advance_voice_meter(text,jsonb,timestamptz),public.icash_confirm_voice_meter_limit(text,bigint,integer,jsonb),public.icash_voice_meter_due(integer),public.icash_voice_meter_settlement_valid(uuid,text,bigint,text),public.icash_reserve_credit(uuid,text,bigint),public.icash_finish_credit(uuid,text,bigint,text),public.icash_post_credit(uuid,text,text,bigint,text) to service_role;
-- Renamed entry points are not service bypasses for the commitment guards.
revoke all on function public.icash_reserve_credit_before_meter(uuid,text,bigint),public.icash_finish_credit_before_meter(uuid,text,bigint,text),public.icash_post_credit_before_meter(uuid,text,text,bigint,text) from public,anon,authenticated,service_role;
revoke all on function public.icash_claim_operation_before_meter(text) from public,anon,authenticated,service_role;
revoke all on function public.icash_claim_operation(text) from public,anon,authenticated;
grant execute on function public.icash_claim_operation(text) to service_role;
commit;
