begin;
-- LOCAL REVIEW CANDIDATE ONLY. This migration creates a fixed-owner forwarding
-- command audit. It changes no existing setup/receipt, provider, routing, wallet,
-- rate, budget, lease, key, or call. Provider GET checks and the separately
-- authorized POST remain in the server control, never inside these RPCs.
create table icash_reception_private.forwarding_attempt (
 id integer primary key default 1 check(id=1),
 account_id uuid not null check(account_id='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid),
 owner_user_id uuid not null check(owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid),
 source_number text not null check(source_number='+14243948384'),
 destination_number text not null check(destination_number='+17816093521'),
 nonce text not null unique check(nonce ~ '^[a-f0-9]{32}$'),
 fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
 state text not null default 'started' check(state in ('started','accepted')),
 started_at timestamptz not null default clock_timestamp() check(isfinite(started_at)),
 accepted_at timestamptz check(isfinite(accepted_at)),
 -- Only the settings the approved provider POST changes, normalized without
 -- invented defaults. Require verified disabled forwarding with no destination.
 original_setting jsonb not null check(original_setting='{"enabled":false,"to":null}'::jsonb),
 provider_status text check(provider_status in ('active','queued')),
 result jsonb,
 check((state='started' and accepted_at is null and provider_status is null and result is null)
  or (state='accepted' and accepted_at is not null and accepted_at>=started_at
   and provider_status is not null and result is not null
   and result=jsonb_build_object('enabled',true,'to','+17816093521','status',provider_status)))
);
alter table icash_reception_private.forwarding_attempt enable row level security;
revoke all on icash_reception_private.forwarding_attempt from public,anon,authenticated,service_role;

create function icash_reception_private.guard_forwarding_audit()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP in ('DELETE','TRUNCATE') then raise exception 'Forwarding audit cannot be removed'; end if;
 if TG_OP='INSERT' then
  if new.state<>'started' then raise exception 'Forwarding attempt must start unconfirmed'; end if;
  return new;
 end if;
 if old.state<>'started' then raise exception 'Accepted forwarding audit is immutable'; end if;
 if (to_jsonb(new)-array['state','accepted_at','provider_status','result'])
  is distinct from (to_jsonb(old)-array['state','accepted_at','provider_status','result']) then
  raise exception 'Forwarding identity and original setting are immutable';
 end if;
 if new.state<>'accepted' then raise exception 'Forwarding attempt cannot be reset'; end if;
 return new;
end $$;
revoke all on function icash_reception_private.guard_forwarding_audit() from public,anon,authenticated,service_role;
create trigger reception_forwarding_audit before insert or update or delete on icash_reception_private.forwarding_attempt
 for each row execute function icash_reception_private.guard_forwarding_audit();
create trigger reception_forwarding_no_truncate before truncate on icash_reception_private.forwarding_attempt
 for each statement execute function icash_reception_private.guard_forwarding_audit();

create function public.icash_get_reception_forwarding()
returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('schema_version',1,'attempt',(
  select jsonb_build_object('state',a.state,'started_at',a.started_at,'accepted_at',a.accepted_at,
   'source_number',a.source_number,'destination_number',a.destination_number,'provider_status',a.provider_status)
  from icash_reception_private.forwarding_attempt a where id=1));
$$;

create function public.icash_claim_reception_forwarding(p_nonce text,p_fingerprint text,p_original_setting jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare c icash_reception_private.config;t timestamptz;
begin
 if p_nonce is null or p_nonce !~ '^[a-f0-9]{32}$'
  or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
  or p_original_setting is distinct from '{"enabled":false,"to":null}'::jsonb then return false; end if;
 -- The same singleton lock serializes reception route/config and this one-shot
 -- command. A provider timeout leaves state started forever; no retry RPC exists.
 select * into c from icash_reception_private.config where id=1 for update;
 t:=clock_timestamp();
 if not found or c.account_id<>'48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  or c.owner_user_id<>'592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or c.called_number<>'+17816093521' or not c.enabled
  or c.funding_mode<>'customer_credits' or c.receipt_mode<>'provider_readback'
  or c.branch_id is null or c.config_hash is null or c.reviewed_version_id is null
  or c.approved_at is null or c.approved_at>t
  or c.reviewed_until is null or c.reviewed_until<t+make_interval(secs=>c.max_duration_seconds+60)
  or not exists(select 1 from public.icash_accounts owner_account where owner_account.id=c.account_id
   and owner_account.owner_user_id=c.owner_user_id
   and (not owner_account.bot_paused or (c.allow_inbound_while_paused and c.inbound_pause_approval_reference is not null)))
  or not exists(select 1 from public.icash_operation_rates rate where rate.id=c.rate_id
   and rate.enabled and rate.operation='incoming_call' and rate.verified_at<=t
   and rate.expires_at>=t+make_interval(secs=>c.max_duration_seconds+60)
   and rate.voice_max_duration_seconds=c.max_duration_seconds and rate.charge_cents=c.customer_charge_cap_cents)
  or not exists(select 1 from icash_reception_private.setup_attempts where action='route' and state='verified')
  or exists(select 1 from icash_reception_private.setup_attempts where action='restore')
  or exists(select 1 from icash_reception_private.forwarding_attempt where id=1) then return false; end if;
 insert into icash_reception_private.forwarding_attempt(account_id,owner_user_id,source_number,destination_number,
  nonce,fingerprint,original_setting,started_at)
 values(c.account_id,c.owner_user_id,'+14243948384','+17816093521',p_nonce,p_fingerprint,p_original_setting,t);
 return true;
end $$;

create function public.icash_complete_reception_forwarding(p_nonce text,p_fingerprint text,p_result jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare a icash_reception_private.forwarding_attempt;
begin
 if p_nonce is null or p_fingerprint is null or jsonb_typeof(p_result) is distinct from 'object'
  or (select count(*) from jsonb_object_keys(p_result))<>3
  or p_result->'enabled' is distinct from 'true'::jsonb
  or p_result->>'to' is distinct from '+17816093521'
  or p_result->>'status' is null or p_result->>'status' not in ('active','queued') then return false; end if;
 perform 1 from icash_reception_private.config where id=1 for update;
 select * into a from icash_reception_private.forwarding_attempt where id=1 for update;
 if not found or a.nonce<>p_nonce or a.fingerprint<>p_fingerprint then return false; end if;
 if a.state='accepted' then return a.result=p_result; end if;
 update icash_reception_private.forwarding_attempt set state='accepted',accepted_at=clock_timestamp(),
  provider_status=p_result->>'status',result=p_result where id=1;
 return true;
end $$;
-- Accepted records describe the original authenticated POST response only.
-- queued is not live success. Later provider GET polling reports current state
-- without updating this immutable audit or replaying the POST.
revoke all on function public.icash_get_reception_forwarding(),
 public.icash_claim_reception_forwarding(text,text,jsonb),
 public.icash_complete_reception_forwarding(text,text,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.icash_get_reception_forwarding(),
 public.icash_claim_reception_forwarding(text,text,jsonb),
 public.icash_complete_reception_forwarding(text,text,jsonb) to service_role;
commit;
