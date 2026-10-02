begin;
-- LOCAL REVIEW CANDIDATE ONLY. Installation, approved budget/rate configuration,
-- and enablement require separate authorization. This file enables nothing.
-- This is a conservative provider-spend envelope, NOT a customer wallet, billed
-- charge, verified identity, seller record, or permission to perform business work.
-- Install as trusted database owner. No application-role write/renewal RPC exists.
create schema icash_reception_private;
revoke all on schema icash_reception_private from public,anon,authenticated,service_role;

create table icash_reception_private.config (
 id integer primary key default 1 check (id=1),
 account_id uuid not null default '48dfb798-8c1a-404f-88c0-c396cc067062'
  check (account_id='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid),
 owner_user_id uuid not null default '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'
  check (owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid),
 called_number text not null default '+17816093521' check (called_number='+17816093521'),
 enabled boolean not null default false,
 config_hash text check (config_hash ~ '^[a-f0-9]{64}$'),
 agent_id text check (agent_id ~ '^agent_[A-Za-z0-9]{1,160}$'),
 branch_id text check (branch_id ~ '^agtbrch_[A-Za-z0-9]{1,160}$'
  and branch_id<>'agtbrch_8901m3sw5tn6fvkae4d334netswh'),
 reviewed_version_id text check (reviewed_version_id ~ '^agtvrsn_[A-Za-z0-9]{1,160}$'),
 max_duration_seconds integer not null default 60 check (max_duration_seconds between 60 and 300),
 max_concurrent_calls integer not null default 1 check (max_concurrent_calls=1),
 caller_window_seconds integer not null default 3600 check (caller_window_seconds between 60 and 86400),
 caller_max_calls integer not null default 2 check (caller_max_calls between 1 and 5),
 approved_budget_usd_micros bigint check (approved_budget_usd_micros between 1 and 1000000000),
 period_starts_at timestamptz,
 period_ends_at timestamptz,
 approved_at timestamptz,
 approval_reference text check (length(btrim(approval_reference)) between 1 and 500),
 twilio_rate_usd_micros_per_minute bigint check (twilio_rate_usd_micros_per_minute between 1 and 100000000),
 elevenlabs_rate_usd_micros_per_minute bigint check (elevenlabs_rate_usd_micros_per_minute between 1 and 100000000),
 connection_reserve_usd_micros bigint check (connection_reserve_usd_micros between 1 and 100000000),
 ai_overhead_usd_micros bigint check (ai_overhead_usd_micros between 1 and 100000000),
 per_call_reservation_usd_micros bigint check (per_call_reservation_usd_micros between 1 and 1000000000),
 rates_verified_at timestamptz,
 rate_evidence text check (length(btrim(rate_evidence)) between 1 and 2000),
 check (period_starts_at is null or isfinite(period_starts_at)),
 check (period_ends_at is null or isfinite(period_ends_at)),
 check (approved_at is null or isfinite(approved_at)),
 check (rates_verified_at is null or isfinite(rates_verified_at)),
 check (period_ends_at>period_starts_at),
 -- Unknown rates do not have an allow/override flag. Each component must have a
 -- verified conservative ceiling before enablement. One extra minute covers
 -- connectivity at BOTH provider ceilings, plus explicit fixed/AI overheads.
 constraint reception_enabled_approval check (not enabled or (
  config_hash is not null and agent_id is not null and branch_id is not null
  and reviewed_version_id is not null and approved_budget_usd_micros is not null
  and period_starts_at is not null and period_ends_at is not null
  and approved_at is not null and approval_reference is not null
  and twilio_rate_usd_micros_per_minute is not null
  and elevenlabs_rate_usd_micros_per_minute is not null
  and connection_reserve_usd_micros is not null and ai_overhead_usd_micros is not null
  and per_call_reservation_usd_micros is not null and rates_verified_at is not null
  and rate_evidence is not null and rates_verified_at<=approved_at
  and approved_at<=period_starts_at
  and period_ends_at>=period_starts_at+make_interval(secs=>max_duration_seconds+60)
  and per_call_reservation_usd_micros<=approved_budget_usd_micros
  and per_call_reservation_usd_micros>=
   ((max_duration_seconds+119)/60)::bigint
    *(twilio_rate_usd_micros_per_minute+elevenlabs_rate_usd_micros_per_minute)
    +connection_reserve_usd_micros+ai_overhead_usd_micros
 ))
);
insert into icash_reception_private.config(id) values(1);

create table icash_reception_private.receipts (
 receipt_id uuid primary key default gen_random_uuid(),
 account_id uuid not null check (account_id='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid),
 call_sid text not null unique check (call_sid ~ '^CA[a-fA-F0-9]{32}$'),
 called_number text not null check (called_number='+17816093521'),
 caller_hash text not null check (caller_hash ~ '^[a-f0-9]{64}$'),
 receipt_nonce text not null unique check (receipt_nonce ~ '^[a-f0-9]{64}$'),
 config_hash text not null check (config_hash ~ '^[a-f0-9]{64}$'),
 agent_id text not null check (agent_id ~ '^agent_[A-Za-z0-9]{1,160}$'),
 branch_id text not null check (branch_id ~ '^agtbrch_[A-Za-z0-9]{1,160}$'
  and branch_id<>'agtbrch_8901m3sw5tn6fvkae4d334netswh'),
 reviewed_version_id text not null check (reviewed_version_id ~ '^agtvrsn_[A-Za-z0-9]{1,160}$'),
 max_duration_seconds integer not null check (max_duration_seconds between 60 and 300),
 reserved_usd_micros bigint not null check (reserved_usd_micros between 1 and 1000000000),
 period_starts_at timestamptz not null check (isfinite(period_starts_at)),
 period_ends_at timestamptz not null check (isfinite(period_ends_at)),
 reserved_at timestamptz not null check (isfinite(reserved_at)),
 state text not null default 'reserved' check (state in ('reserved','completed','failed')),
 conversation_id text unique check (conversation_id ~ '^conv_[A-Za-z0-9]{1,160}$'),
 terminal_at timestamptz check (isfinite(terminal_at)),
 intake jsonb,
 check (reserved_at>=period_starts_at and reserved_at<period_ends_at),
 check (terminal_at is null or terminal_at>=reserved_at),
 check ((state='reserved' and conversation_id is null and terminal_at is null and intake is null)
  or (state in ('completed','failed') and conversation_id is not null and terminal_at is not null and intake is not null))
);
-- Exact text remains immutable; alternate hex casing cannot consume twice.
create unique index reception_callsid_canonical on icash_reception_private.receipts(lower(call_sid));
create index reception_caller_window on icash_reception_private.receipts(caller_hash,reserved_at desc);
create index reception_active on icash_reception_private.receipts(state) where state='reserved';

create function icash_reception_private.guard_config()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP in ('DELETE','TRUNCATE') then raise exception 'Reception configuration cannot be removed'; end if;
 if exists(select 1 from icash_reception_private.receipts)
  and (to_jsonb(new)-'enabled') is distinct from (to_jsonb(old)-'enabled') then
  raise exception 'Consumed reception approval is immutable; separately reviewed renewal required';
 end if;
 return new;
end $$;
create trigger reception_config_guard before update or delete on icash_reception_private.config
for each row execute function icash_reception_private.guard_config();
create trigger reception_config_no_truncate before truncate on icash_reception_private.config
for each statement execute function icash_reception_private.guard_config();

create function icash_reception_private.guard_receipt()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP in ('DELETE','TRUNCATE') then raise exception 'Reception budget reservations cannot be removed'; end if;
 if TG_OP='INSERT' then
  if new.state<>'reserved' or new.conversation_id is not null or new.terminal_at is not null or new.intake is not null then
   raise exception 'Reception receipt must start reserved';
  end if;
  return new;
 end if;
 if old.state<>'reserved' then raise exception 'Terminal reception receipt is immutable'; end if;
 if (to_jsonb(new)-array['state','conversation_id','terminal_at','intake'])
  is distinct from (to_jsonb(old)-array['state','conversation_id','terminal_at','intake']) then
  raise exception 'Reception reservation and binding are immutable';
 end if;
 if new.state not in ('completed','failed') then raise exception 'Reception receipt requires signed terminal evidence'; end if;
 if jsonb_typeof(new.intake) is distinct from 'object'
  or not(new.intake ?& array['verification','caller_statements'])
  or (select count(*) from jsonb_object_keys(new.intake))<>2
  or new.intake->>'verification' is distinct from 'UNVERIFIED'
  or jsonb_typeof(new.intake->'caller_statements') is distinct from 'array' then
  raise exception 'Reception intake must be UNVERIFIED caller statements';
 end if;
 if jsonb_array_length(new.intake->'caller_statements')>20
  or exists(select 1 from jsonb_array_elements(new.intake->'caller_statements') s
   where jsonb_typeof(s) is distinct from 'string' or length(s#>>'{}') not between 1 and 2000) then
  raise exception 'Reception caller statements exceed storage allowlist';
 end if;
 return new;
end $$;
create trigger reception_receipt_guard before insert or update or delete on icash_reception_private.receipts
for each row execute function icash_reception_private.guard_receipt();
create trigger reception_receipt_no_truncate before truncate on icash_reception_private.receipts
for each statement execute function icash_reception_private.guard_receipt();

create function public.icash_get_general_reception_config()
returns jsonb language sql stable security definer set search_path='' as $$
 select to_jsonb(c) from icash_reception_private.config c where id=1;
$$;

create function public.icash_reserve_general_reception(
 p_call_sid text,p_called_number text,p_caller_hash text,p_receipt_nonce text,
 p_config_hash text,p_reviewed_version_id text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare c icash_reception_private.config; r icash_reception_private.receipts;
 t timestamptz; total numeric;
begin
 if p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$'
  or p_called_number is distinct from '+17816093521'
  or p_caller_hash is null or p_caller_hash !~ '^[a-f0-9]{64}$'
  or p_receipt_nonce is null or p_receipt_nonce !~ '^[a-f0-9]{64}$'
  or p_config_hash is null or p_config_hash !~ '^[a-f0-9]{64}$'
  or p_reviewed_version_id is null then
  return jsonb_build_object('allowed',false,'reason','invalid_input');
 end if;
 -- All admissions serialize on this singleton. Read wall time AFTER acquiring
 -- the lock. Never hold this transaction open across a provider network call.
 select * into c from icash_reception_private.config where id=1 for update;
 t:=clock_timestamp();
 if not found or not c.enabled then return jsonb_build_object('allowed',false,'reason','disabled'); end if;
 if c.config_hash is distinct from p_config_hash or c.reviewed_version_id is distinct from p_reviewed_version_id then
  return jsonb_build_object('allowed',false,'reason','config_changed');
 end if;
 if t<c.period_starts_at or t+make_interval(secs=>c.max_duration_seconds+60)>c.period_ends_at then
  return jsonb_build_object('allowed',false,'reason','outside_period');
 end if;
 if exists(select 1 from icash_reception_private.receipts where lower(call_sid)=lower(p_call_sid)) then
  -- A duplicate NEVER returns the prior permitted response/nonce, including
  -- after a crash or ambiguous registration. A second provider call is unsafe.
  return jsonb_build_object('allowed',false,'reason','duplicate_call');
 end if;
 if exists(select 1 from icash_reception_private.receipts where receipt_nonce=p_receipt_nonce) then
  return jsonb_build_object('allowed',false,'reason','duplicate_nonce');
 end if;
 if (select count(*) from icash_reception_private.receipts where state='reserved')>=c.max_concurrent_calls then
  return jsonb_build_object('allowed',false,'reason','concurrency_limit');
 end if;
 if (select count(*) from icash_reception_private.receipts where caller_hash=p_caller_hash
  and reserved_at>t-make_interval(secs=>c.caller_window_seconds))>=c.caller_max_calls then
  return jsonb_build_object('allowed',false,'reason','caller_throttled');
 end if;
 -- All-time sum deliberately includes completed, failed and unresolved calls.
 -- No automatic reset, expiry, failed-registration refund or cost reconciliation
 -- exists. A later period requires its own reviewed renewal design.
 select coalesce(sum(reserved_usd_micros),0) into total from icash_reception_private.receipts;
 if total+c.per_call_reservation_usd_micros>c.approved_budget_usd_micros then
  return jsonb_build_object('allowed',false,'reason','budget_exhausted');
 end if;
 insert into icash_reception_private.receipts(account_id,call_sid,called_number,caller_hash,receipt_nonce,
  config_hash,agent_id,branch_id,reviewed_version_id,max_duration_seconds,reserved_usd_micros,
  period_starts_at,period_ends_at,reserved_at)
 values(c.account_id,p_call_sid,c.called_number,p_caller_hash,p_receipt_nonce,c.config_hash,c.agent_id,c.branch_id,
  c.reviewed_version_id,c.max_duration_seconds,c.per_call_reservation_usd_micros,c.period_starts_at,c.period_ends_at,t)
 returning * into r;
 return jsonb_build_object('allowed',true,'reason','reserved','receipt',to_jsonb(r));
end $$;

create function public.icash_finish_general_reception(
 p_call_sid text,p_receipt_nonce text,p_agent_id text,p_agent_version text,p_branch_id text,
 p_conversation_id text,p_status text,p_caller_statements jsonb
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r icash_reception_private.receipts; intake_result jsonb;
begin
 -- Only the server may call this RPC, AFTER verifying the provider signature,
 -- timestamp, pinned branch, terminal event, and server-injected dynamic vars.
 -- SQL does not claim to verify an HMAC itself. A failed or unknown registration
 -- must remain reserved until a positively authenticated terminal receipt.
 if p_conversation_id is null or p_conversation_id !~ '^conv_[A-Za-z0-9]{1,160}$'
  or p_status is null or p_status not in ('completed','failed')
  or jsonb_typeof(p_caller_statements) is distinct from 'array' then return null; end if;
 if jsonb_array_length(p_caller_statements)>20
  or exists(select 1 from jsonb_array_elements(p_caller_statements) s
   where jsonb_typeof(s) is distinct from 'string' or length(s#>>'{}') not between 1 and 2000) then return null; end if;
 -- Consistent config -> receipt lock ordering also serializes unique conversation
 -- binding, so two competing receipts cannot claim one provider conversation.
 perform 1 from icash_reception_private.config where id=1 for update;
 select * into r from icash_reception_private.receipts where call_sid=p_call_sid for update;
 if not found or r.receipt_nonce is distinct from p_receipt_nonce
  or r.agent_id is distinct from p_agent_id or r.reviewed_version_id is distinct from p_agent_version
  or r.branch_id is distinct from p_branch_id then return null; end if;
 intake_result:=jsonb_build_object('verification','UNVERIFIED','caller_statements',p_caller_statements);
 if r.state<>'reserved' then
  if r.conversation_id=p_conversation_id and r.state=p_status and r.intake=intake_result then return to_jsonb(r); end if;
  return null;
 end if;
 if exists(select 1 from icash_reception_private.receipts where conversation_id=p_conversation_id) then return null; end if;
 update icash_reception_private.receipts set state=p_status,conversation_id=p_conversation_id,
  terminal_at=clock_timestamp(),intake=intake_result where receipt_id=r.receipt_id returning * into r;
 return to_jsonb(r);
end $$;

-- Definers are intentional narrowly granted RPC entry points. The application
-- cannot write configuration or tables directly. Empty search paths prevent
-- object substitution. RLS is an additional closed-by-default boundary.
alter table icash_reception_private.config enable row level security;
alter table icash_reception_private.receipts enable row level security;
revoke all on all tables in schema icash_reception_private from public,anon,authenticated,service_role;
revoke all on all functions in schema icash_reception_private from public,anon,authenticated,service_role;
revoke all on function public.icash_get_general_reception_config() from public,anon,authenticated,service_role;
revoke all on function public.icash_reserve_general_reception(text,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.icash_finish_general_reception(text,text,text,text,text,text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_get_general_reception_config() to service_role;
grant execute on function public.icash_reserve_general_reception(text,text,text,text,text,text) to service_role;
grant execute on function public.icash_finish_general_reception(text,text,text,text,text,text,text,jsonb) to service_role;
commit;
