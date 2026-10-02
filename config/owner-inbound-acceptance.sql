begin;
-- PARAMETERIZED INSTALLATION TEMPLATE. Render only with an explicitly reviewed
-- private deployment account SID using renderOwnerInboundSchema. The renderer
-- materializes an exact literal CHECK; the template cannot execute as-is.
-- The production migration is ALREADY APPLIED; do not repeat it.
-- LOCAL REVIEW CANDIDATE ONLY. No seed, migration, activation, provider write or
-- business-work permission. Every reviewed authorization permits ONE owner test.
-- Prerequisites: existing icash_accounts/wallets/credit ledger/reservations and
-- icash_finish_credit. This isolated reservation deliberately does not unpause
-- business work or reuse a seller-call authorization.
create table public.icash_owner_inbound_acceptance_config (
 id uuid primary key default gen_random_uuid(),
 account_id uuid not null references public.icash_accounts(id) check(account_id='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid),
 owner_user_id uuid not null references auth.users(id) check(owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid),
 owner_phone text not null check(owner_phone='+12142185280'),
 source_phone text not null check(source_phone='+14243948384'),
 ingress_phone text not null check(ingress_phone='+17816093521'),
 twilio_account_sid text not null check(twilio_account_sid={{OWNER_INBOUND_TWILIO_ACCOUNT_SID}}),
 agent_id text not null check(agent_id='agent_7801m3qsygdwfv5tggatf7w68y3d'),
 elevenlabs_region text not null check(elevenlabs_region in ('global','us','eu','in','sg')),
 twilio_region text not null check(twilio_region in ('us1','ie1','au1')),
 all_in_cost_reviewed boolean not null default false,
 forwarding_no_incremental_cost boolean not null default false,
 provider_extras_disabled boolean not null default false,
 phone_number_id text not null check(phone_number_id='phnum_9501m3qxddgne8gtr99wcce2h0gn'),
 branch_id text not null check(branch_id='agtbrch_8901m3sw5tn6fvkae4d334netswh'),
 branch_name text not null check(length(branch_name) between 8 and 100),
 reviewed_config_hash text not null check(reviewed_config_hash ~ '^[a-f0-9]{64}$'),
 reviewed_version_id text not null check(length(trim(reviewed_version_id)) between 1 and 160),
 approval_ref text not null check(length(trim(approval_ref)) between 12 and 1000),
 enabled boolean not null default false,
 max_duration_seconds integer not null check(max_duration_seconds=60),
 quote_cap_cents bigint not null check(quote_cap_cents between 1 and 10000),
 twilio_micros_per_minute bigint not null check(twilio_micros_per_minute between 0 and 100000000),
 elevenlabs_micros_per_minute bigint not null check(elevenlabs_micros_per_minute between 0 and 100000000),
 customer_cost_multiplier numeric not null check(customer_cost_multiplier between 1 and 10),
 rate_reviewed_at timestamptz not null,
 rate_expires_at timestamptz not null,
 rate_evidence_hash text not null check(rate_evidence_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 check(isfinite(created_at) and isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '24 hours'),
 check(isfinite(rate_reviewed_at) and isfinite(rate_expires_at) and rate_expires_at>rate_reviewed_at),
 -- A caller cannot under-reserve the explicitly reviewed worst-case quote.
 check(quote_cap_cents>=ceil((ceil(max_duration_seconds::numeric/60)*twilio_micros_per_minute+max_duration_seconds::numeric/60*elevenlabs_micros_per_minute)*customer_cost_multiplier/10000))
);
create table public.icash_owner_inbound_acceptance_runs (
 id uuid primary key default gen_random_uuid(),
 config_id uuid not null unique references public.icash_owner_inbound_acceptance_config(id),
 account_id uuid not null references public.icash_accounts(id),
 owner_user_id uuid not null references auth.users(id),
 state text not null default 'armed' check(state in ('armed','inspecting','claimed','passed','failed','needs_review','cancelled','expired')),
 configuration jsonb not null check(jsonb_typeof(configuration)='object'),
 challenge_salt text not null check(challenge_salt ~ '^[a-f0-9]{64}$'),
 challenge_hash text not null check(challenge_hash ~ '^[a-f0-9]{64}$'),
 operation_key text not null unique,
 credit_reservation_id uuid not null unique references public.icash_credit_reservations(id),
 quote_cap_cents bigint not null check(quote_cap_cents>0),
 reserved_cents bigint generated always as (case when settled_at is null then quote_cap_cents else 0 end) stored,
 armed_at timestamptz not null default now(),
 expires_at timestamptz not null,
 attempted_at timestamptz,
 admitted_at timestamptz,
 provider_call_sid text unique check(provider_call_sid ~ '^CA[a-fA-F0-9]{32}$'),
 conversation_id text unique check(conversation_id ~ '^conv_[A-Za-z0-9]+$'),
 admission_receipt_hash text unique check(admission_receipt_hash ~ '^[a-f0-9]{64}$'),
 evidence jsonb,
 charged_cents bigint check(charged_cents between 0 and quote_cap_cents),
 -- Customer debit (including reviewed multiplier), not supplier subtotal.
 actual_cost_cents bigint generated always as (charged_cents) stored,
 settled_at timestamptz,
 updated_at timestamptz not null default now(),
 check(isfinite(expires_at) and expires_at>armed_at and expires_at<=armed_at+interval '5 minutes'),
 check((attempted_at is null and provider_call_sid is null and conversation_id is null) or (attempted_at is not null and provider_call_sid is not null and conversation_id is not null)),
 check(admitted_at is null or (attempted_at is not null and admission_receipt_hash is not null)),
 check((settled_at is null and charged_cents is null) or (settled_at is not null and charged_cents is not null)),
 check(state not in ('passed','failed') or settled_at is not null),
 check(state<>'passed' or admitted_at is not null),
 check(state not in ('cancelled','expired') or (attempted_at is null and settled_at is not null and charged_cents=0))
);
-- Another reviewed config cannot start while any attempt still holds budget.
create unique index icash_owner_inbound_one_unresolved on public.icash_owner_inbound_acceptance_runs(account_id) where settled_at is null;
-- Twilio SIDs cannot be replayed by changing hexadecimal letter case.
create unique index icash_owner_inbound_call_sid_identity on public.icash_owner_inbound_acceptance_runs(lower(provider_call_sid)) where provider_call_sid is not null;
create index icash_owner_inbound_runs_account on public.icash_owner_inbound_acceptance_runs(account_id,armed_at desc);
create table public.icash_owner_inbound_acceptance_audit (
 id uuid primary key default gen_random_uuid(),
 run_id uuid not null references public.icash_owner_inbound_acceptance_runs(id),
 account_id uuid not null references public.icash_accounts(id),
 event text not null check(event in ('armed','attempted','admitted','passed','failed','needs_review','cancelled','expired','settled')),
 state text not null,
 receipt_hash text check(receipt_hash ~ '^[a-f0-9]{64}$'),
 charged_cents bigint check(charged_cents>=0),
 created_at timestamptz not null default now()
);
create index icash_owner_inbound_audit_run on public.icash_owner_inbound_acceptance_audit(run_id,created_at);
-- Typed config snapshots and strictly allowlisted evidence only. Never store
-- challenge plaintext, conversation transcripts, audio, or raw provider bodies.
create function public.icash_owner_inbound_immutable() returns trigger language plpgsql set search_path='' as $$
begin
 if TG_TABLE_NAME='icash_owner_inbound_acceptance_audit' or TG_OP='DELETE' then raise exception 'Owner inbound audit and consumed records are immutable';end if;
 if TG_TABLE_NAME='icash_owner_inbound_acceptance_config' then
  if exists(select 1 from public.icash_owner_inbound_acceptance_runs where config_id=old.id)
   and (to_jsonb(new)-'enabled' is distinct from to_jsonb(old)-'enabled' or new.enabled) then
   raise exception 'Owner inbound authorization already consumed';end if;
 else
  if row(new.id,new.config_id,new.account_id,new.owner_user_id,new.configuration,new.challenge_salt,new.challenge_hash,new.operation_key,new.credit_reservation_id,new.quote_cap_cents,new.armed_at,new.expires_at)
   is distinct from row(old.id,old.config_id,old.account_id,old.owner_user_id,old.configuration,old.challenge_salt,old.challenge_hash,old.operation_key,old.credit_reservation_id,old.quote_cap_cents,old.armed_at,old.expires_at)
   then raise exception 'Owner inbound run binding immutable';end if;
  if old.attempted_at is not null and row(new.attempted_at,new.provider_call_sid,new.conversation_id) is distinct from row(old.attempted_at,old.provider_call_sid,old.conversation_id) then raise exception 'Owner inbound provider binding immutable';end if;
  if old.admitted_at is not null and row(new.admitted_at,new.admission_receipt_hash) is distinct from row(old.admitted_at,old.admission_receipt_hash) then raise exception 'Owner inbound admission immutable';end if;
  if old.settled_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then raise exception 'Owner inbound settlement immutable';end if;
  if new.state is distinct from old.state and not (
   (old.state='armed' and new.state in ('inspecting','cancelled','expired'))
   or (old.state='inspecting' and new.state in ('claimed','needs_review','failed'))
   or (old.state='claimed' and new.state in ('passed','failed','needs_review'))
   or (old.state='needs_review' and new.state in ('failed','passed'))
  ) then raise exception 'Owner inbound retry or backward transition forbidden';end if;
  if new.state='passed' and (new.admitted_at is null or new.settled_at is null
   or new.evidence->>'challenge_passed' is distinct from 'true'
   or new.evidence->>'audio_passed' is distinct from 'true'
   or new.evidence->>'duration_seconds' is null
   or (new.evidence->>'duration_seconds')::numeric not between 1 and (new.configuration->>'max_duration_seconds')::integer
   or new.evidence->>'result_receipt_hash' is null
   or new.evidence->>'twilio_receipt_hash' is null
   or new.evidence->>'elevenlabs_receipt_hash' is null
   or new.evidence->>'twilio_cost_micros' is null
   or new.evidence->>'elevenlabs_cost_micros' is null) then raise exception 'Owner inbound success evidence required';end if;
 end if;
 return new;
end $$;
create trigger icash_owner_inbound_config_immutable before update or delete on public.icash_owner_inbound_acceptance_config for each row execute function public.icash_owner_inbound_immutable();
create trigger icash_owner_inbound_run_immutable before update or delete on public.icash_owner_inbound_acceptance_runs for each row execute function public.icash_owner_inbound_immutable();
create trigger icash_owner_inbound_audit_immutable before update or delete on public.icash_owner_inbound_acceptance_audit for each row execute function public.icash_owner_inbound_immutable();

create function public.icash_arm_owner_inbound_acceptance(p_account uuid,p_user uuid,p_config uuid,p_hash text,p_version text,p_expected jsonb,p_challenge_salt text,p_challenge_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare c public.icash_owner_inbound_acceptance_config;r public.icash_owner_inbound_acceptance_runs;a public.icash_accounts;w public.icash_wallets;used numeric;cr uuid;rid uuid:=gen_random_uuid();op text;
begin
 select * into c from public.icash_owner_inbound_acceptance_config where id=p_config and account_id=p_account and owner_user_id=p_user for update;
 if not found or not c.enabled or not c.all_in_cost_reviewed or not c.forwarding_no_incremental_cost or not c.provider_extras_disabled or c.expires_at<=now() or c.rate_reviewed_at>now() or c.rate_expires_at<=least(now()+interval '5 minutes',c.expires_at)+interval '60 seconds'
  or c.reviewed_config_hash is distinct from p_hash or c.reviewed_version_id is distinct from p_version
  or p_expected is null or to_jsonb(c) is distinct from p_expected then return null;end if;
 if p_challenge_salt is null or p_challenge_salt !~ '^[a-f0-9]{64}$' or p_challenge_hash is null or p_challenge_hash !~ '^[a-f0-9]{64}$' then return null;end if;
 if exists(select 1 from public.icash_owner_inbound_acceptance_runs where config_id=c.id) then return null;end if;
 -- Serialize wallet admission with the existing credit reservation path. The
 -- owner-only test is allowed while business work stays paused; budget is not.
 select * into a from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then return null;end if;
 if exists(select 1 from public.icash_owner_inbound_acceptance_runs where account_id=p_account and settled_at is null) then return null;end if;
 select * into w from public.icash_wallets where account_id=p_account for update;
 if not found or w.currency<>'USD' then raise exception 'Owner inbound wallet missing';end if;
 if w.balance_cents-w.reserved_cents<c.quote_cap_cents then raise exception 'Insufficient owner inbound credits';end if;
 select coalesce(sum(-delta_cents),0) into used from public.icash_credit_ledger where account_id=p_account and kind='usage' and created_at>now()-interval '24 hours';
 if used+w.reserved_cents+c.quote_cap_cents>a.daily_limit_cents then raise exception 'Owner inbound daily budget reached';end if;
 op:='owner-inbound-test:'||rid;
 insert into public.icash_credit_reservations(account_id,operation_key,amount_cents) values(p_account,op,c.quote_cap_cents) returning id into cr;
 update public.icash_wallets set reserved_cents=reserved_cents+c.quote_cap_cents where account_id=p_account;
 insert into public.icash_owner_inbound_acceptance_runs(id,config_id,account_id,owner_user_id,configuration,challenge_salt,challenge_hash,operation_key,credit_reservation_id,quote_cap_cents,expires_at)
 values(rid,c.id,p_account,p_user,to_jsonb(c),p_challenge_salt,p_challenge_hash,op,cr,c.quote_cap_cents,least(now()+interval '5 minutes',c.expires_at)) returning * into r;
 update public.icash_owner_inbound_acceptance_config set enabled=false where id=c.id;
 insert into public.icash_owner_inbound_acceptance_audit(run_id,account_id,event,state) values(r.id,r.account_id,'armed',r.state);
 return to_jsonb(r);
end $$;

-- This consumes the attempt BEFORE receipt/provider reads. The signed webhook
-- caller/ingress/agent filter is a service boundary, not a database assertion of
-- Twilio forwarding proof. Provider authority is separately checked before claim.
create function public.icash_attempt_owner_inbound_acceptance(p_account uuid,p_user uuid,p_run uuid,p_call_sid text,p_conversation text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.icash_owner_inbound_acceptance_runs;
begin
 select * into r from public.icash_owner_inbound_acceptance_runs where id=p_run and account_id=p_account and owner_user_id=p_user for update;
 if not found or r.state<>'armed' or r.expires_at<=now() or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user)
  or p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$' or p_conversation is null or p_conversation !~ '^conv_[A-Za-z0-9]+$' then return null;end if;
 if exists(select 1 from public.icash_owner_inbound_acceptance_runs where lower(provider_call_sid)=lower(p_call_sid) or conversation_id=p_conversation) then return null;end if;
 update public.icash_owner_inbound_acceptance_runs set state='inspecting',attempted_at=now(),provider_call_sid=p_call_sid,conversation_id=p_conversation,updated_at=now() where id=r.id returning * into r;
 insert into public.icash_owner_inbound_acceptance_audit(run_id,account_id,event,state) values(r.id,r.account_id,'attempted',r.state);
 return to_jsonb(r);
end $$;
create function public.icash_claim_owner_inbound_acceptance(p_account uuid,p_user uuid,p_run uuid,p_call_sid text,p_conversation text,p_hash text,p_version text,p_receipt_hash text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.icash_owner_inbound_acceptance_runs;
begin
 select * into r from public.icash_owner_inbound_acceptance_runs where id=p_run and account_id=p_account and owner_user_id=p_user for update;
 if not found or r.state<>'inspecting' or r.expires_at<=now() or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user)
  or r.provider_call_sid is distinct from p_call_sid or r.conversation_id is distinct from p_conversation
  or r.configuration->>'reviewed_config_hash' is distinct from p_hash or r.configuration->>'reviewed_version_id' is distinct from p_version
  or p_receipt_hash is null or p_receipt_hash !~ '^[a-f0-9]{64}$' then return null;end if;
 if exists(select 1 from public.icash_owner_inbound_acceptance_runs where admission_receipt_hash=p_receipt_hash) then return null;end if;
 update public.icash_owner_inbound_acceptance_runs set state='claimed',admitted_at=now(),admission_receipt_hash=p_receipt_hash,updated_at=now() where id=r.id returning * into r;
 insert into public.icash_owner_inbound_acceptance_audit(run_id,account_id,event,state,receipt_hash) values(r.id,r.account_id,'admitted',r.state,p_receipt_hash);
 return to_jsonb(r);
end $$;

create function public.icash_finish_owner_inbound_acceptance(p_account uuid,p_user uuid,p_run uuid,p_call_sid text,p_conversation text,p_evidence jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.icash_owner_inbound_acceptance_runs;k text;v jsonb;charge bigint;known boolean;outcome text;receipt text;tw numeric;el numeric;dur numeric;
begin
 select * into r from public.icash_owner_inbound_acceptance_runs where id=p_run and account_id=p_account and owner_user_id=p_user for update;
 if not found or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user)
  or r.attempted_at is null or r.provider_call_sid is distinct from p_call_sid or r.conversation_id is distinct from p_conversation then return null;end if;
 if p_evidence is null or jsonb_typeof(p_evidence)<>'object' then raise exception 'Owner inbound evidence required';end if;
 for k,v in select * from jsonb_each(p_evidence) loop
  if not(k=any(array['outcome','challenge_passed','audio_passed','duration_seconds','result_receipt_hash','twilio_cost_micros','elevenlabs_cost_micros','twilio_receipt_hash','elevenlabs_receipt_hash'])) then raise exception 'Unknown owner inbound evidence field';end if;
  if k in ('challenge_passed','audio_passed') and jsonb_typeof(v) not in ('boolean','null') then raise exception 'Invalid owner inbound result';end if;
  if k in ('result_receipt_hash','twilio_receipt_hash','elevenlabs_receipt_hash') and v<>'null'::jsonb and (jsonb_typeof(v)<>'string' or (p_evidence->>k) !~ '^[a-f0-9]{64}$') then raise exception 'Invalid owner inbound receipt hash';end if;
  if k in ('duration_seconds','twilio_cost_micros','elevenlabs_cost_micros') and v<>'null'::jsonb then
   if jsonb_typeof(v)<>'number' then raise exception 'Invalid owner inbound cost';end if;
   if (v::text)::numeric<0 or (v::text)::numeric<>trunc((v::text)::numeric) or (v::text)::numeric>9007199254740991 then raise exception 'Invalid owner inbound cost';end if;
  end if;
 end loop;
 outcome:=p_evidence->>'outcome';receipt:=p_evidence->>'result_receipt_hash';
 if outcome is null or outcome not in ('passed','failed','needs_review') then raise exception 'Invalid owner inbound outcome';end if;
 if r.settled_at is not null then
  if r.evidence is distinct from p_evidence then raise exception 'Owner inbound settlement conflict';end if;
  return to_jsonb(r);
 end if;
 if r.state not in ('inspecting','claimed','needs_review') then return null;end if;
 -- Once observed, an authoritative cost/receipt pair cannot be silently revised
 -- downwards to turn an overspend hold into a refund. Manual investigation needs
 -- a separate explicit correction, never another attempt or a changed replay.
 foreach k in array array['twilio','elevenlabs'] loop
  if r.evidence->>(k||'_cost_micros') is not null and r.evidence->>(k||'_receipt_hash') is not null
   and (r.evidence->(k||'_cost_micros') is distinct from p_evidence->(k||'_cost_micros')
    or r.evidence->>(k||'_receipt_hash') is distinct from p_evidence->>(k||'_receipt_hash')) then
   raise exception 'Owner inbound authoritative cost receipt conflict';end if;
 end loop;
 tw:=(p_evidence->>'twilio_cost_micros')::numeric;el:=(p_evidence->>'elevenlabs_cost_micros')::numeric;dur:=(p_evidence->>'duration_seconds')::numeric;
 known:=tw is not null and el is not null and p_evidence->>'twilio_receipt_hash' is not null and p_evidence->>'elevenlabs_receipt_hash' is not null and receipt is not null;
 charge:=case when known then ceil((tw+el)*(r.configuration->>'customer_cost_multiplier')::numeric/10000)::bigint else null end;
 if outcome='passed' and (r.admitted_at is null or p_evidence->>'challenge_passed' is distinct from 'true' or p_evidence->>'audio_passed' is distinct from 'true' or dur is null or dur<=0 or dur>(r.configuration->>'max_duration_seconds')::integer or receipt is null) then raise exception 'Owner inbound success unproven';end if;
 if not known or charge>r.quote_cap_cents then outcome:='needs_review';end if;
 if known and charge<=r.quote_cap_cents then
  -- Immutable exact receipt references, no fabricated free zero for unknown usage.
  perform public.icash_finish_credit(p_account,r.operation_key,charge,'owner-inbound-receipt-sha256:'||receipt);
  update public.icash_owner_inbound_acceptance_runs set state=outcome,evidence=p_evidence,charged_cents=charge,settled_at=now(),updated_at=now() where id=r.id returning * into r;
 else
  -- No retries, expiry or cancellation can turn an attempted/unknown bill into a refund.
  if r.state='needs_review' and r.evidence=p_evidence then return to_jsonb(r);end if;
  update public.icash_owner_inbound_acceptance_runs set state='needs_review',evidence=p_evidence,updated_at=now() where id=r.id returning * into r;
 end if;
 insert into public.icash_owner_inbound_acceptance_audit(run_id,account_id,event,state,receipt_hash,charged_cents) values(r.id,r.account_id,r.state,r.state,receipt,r.charged_cents);
 return to_jsonb(r);
end $$;

-- Explicit POST cancellation/expiry only; status GET never invokes this function.
create function public.icash_cancel_owner_inbound_acceptance(p_account uuid,p_user uuid,p_run uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare r public.icash_owner_inbound_acceptance_runs;outcome text;
begin
 select * into r from public.icash_owner_inbound_acceptance_runs where id=p_run and account_id=p_account and owner_user_id=p_user for update;
 if not found or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then return null;end if;
 if r.settled_at is not null then return to_jsonb(r);end if;
 if r.state='armed' and r.attempted_at is null and r.admitted_at is null and r.provider_call_sid is null and r.conversation_id is null then
  outcome:=case when r.expires_at<=now() then 'expired' else 'cancelled' end;
  perform public.icash_finish_credit(p_account,r.operation_key,0,'owner-inbound-unclaimed:'||r.id);
  update public.icash_owner_inbound_acceptance_runs set state=outcome,charged_cents=0,settled_at=now(),updated_at=now() where id=r.id returning * into r;
 elsif r.state in ('inspecting','claimed') then
  update public.icash_owner_inbound_acceptance_runs set state='needs_review',updated_at=now() where id=r.id returning * into r;
 else return to_jsonb(r);end if;
 insert into public.icash_owner_inbound_acceptance_audit(run_id,account_id,event,state,charged_cents) values(r.id,r.account_id,r.state,r.state,r.charged_cents);
 return to_jsonb(r);
end $$;

do $$ declare t text;f record;begin
 foreach t in array array['icash_owner_inbound_acceptance_config','icash_owner_inbound_acceptance_runs','icash_owner_inbound_acceptance_audit'] loop
  execute format('alter table public.%I enable row level security',t);
  execute format('revoke all on public.%I from public,anon,authenticated,service_role',t);
  execute format('grant select,insert on public.%I to service_role',t);
  execute format('create policy service_only on public.%I to service_role using (true) with check (true)',t);
 end loop;
 grant update on public.icash_owner_inbound_acceptance_config,public.icash_owner_inbound_acceptance_runs to service_role;
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and (p.proname like 'icash_%_owner_inbound_acceptance' or p.proname='icash_owner_inbound_immutable') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);
  execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
