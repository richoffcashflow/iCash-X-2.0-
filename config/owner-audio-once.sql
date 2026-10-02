begin;
-- LOCAL REVIEW CANDIDATE ONLY. Do not install or arm without separate approval.
-- The fixed 60-second provider-native candidate needs explicit duration approval.
-- An isolated, one-ever owner AUDIO test. No wallet, ledger, seller, routing,
-- provider, or business-work writes. The server still validates provider receipts.
-- Install as the trusted database owner, never as service_role. A database owner
-- can replace database objects; the one-use boundary protects application roles.
create table public.icash_owner_audio_once (
 id integer primary key check (id=1),
 account_id uuid not null check (account_id='48dfb798-8c1a-404f-88c0-c396cc067062'::uuid),
 owner_user_id uuid not null check (owner_user_id='592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid),
 state text not null check (state in ('armed','inspecting','claimed','passed','failed','needs_review','cancelled')),
 config_hash text not null check (config_hash ~ '^[a-f0-9]{64}$'),
 version_id text not null check (length(btrim(version_id)) between 1 and 160),
 branch_name text not null check (length(btrim(branch_name)) between 8 and 100),
 challenge_salt text not null check (challenge_salt ~ '^[a-f0-9]{64}$'),
 challenge_hash text not null check (challenge_hash ~ '^[a-f0-9]{64}$'),
 armed_at timestamptz not null,
 expires_at timestamptz not null,
 claimed_at timestamptz,
 call_sid text check (call_sid ~ '^CA[a-fA-F0-9]{32}$'),
 conversation_id text check (conversation_id ~ '^conv_[A-Za-z0-9]{1,160}$'),
 result jsonb,
 check (isfinite(armed_at) and isfinite(expires_at) and expires_at=armed_at+interval '5 minutes'),
 check (claimed_at is null or (isfinite(claimed_at) and claimed_at>=armed_at and claimed_at<expires_at)),
 check (state not in ('armed','inspecting','cancelled') or claimed_at is null),
 check (state not in ('claimed','passed') or claimed_at is not null),
 check ((state in ('armed','cancelled') and call_sid is null and conversation_id is null)
     or (state not in ('armed','cancelled') and call_sid is not null and conversation_id is not null)),
 check ((state in ('armed','inspecting','claimed','cancelled') and result is null)
     or (state in ('passed','failed','needs_review') and result is not null))
);

-- Defense in depth against accidental future write grants. No delete, truncate,
-- rearm, rebinding, timestamp extension, or backward state transition exists.
create function public.icash_owner_audio_once_guard()
returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if TG_OP in ('DELETE','TRUNCATE') then
  raise exception 'Owner audio one-use record cannot be removed';
 end if;
 if TG_OP='INSERT' then
  if new.state<>'armed' or new.claimed_at is not null or new.call_sid is not null or new.conversation_id is not null or new.result is not null then
   raise exception 'Owner audio must start armed';
  end if;
  return new;
 end if;
 if row(new.id,new.account_id,new.owner_user_id,new.config_hash,new.version_id,new.branch_name,
        new.challenge_salt,new.challenge_hash,new.armed_at,new.expires_at)
  is distinct from row(old.id,old.account_id,old.owner_user_id,old.config_hash,old.version_id,old.branch_name,
        old.challenge_salt,old.challenge_hash,old.armed_at,old.expires_at) then
  raise exception 'Owner audio binding is immutable';
 end if;
 if old.state in ('passed','failed','cancelled') then
  raise exception 'Owner audio terminal record is immutable';
 end if;
 if old.call_sid is not null and row(new.call_sid,new.conversation_id) is distinct from row(old.call_sid,old.conversation_id) then
  raise exception 'Owner audio call identity is immutable';
 end if;
 -- Preserve admission provenance through needs_review. Otherwise an inspection
 -- failure could be promoted via inspecting -> needs_review -> passed.
 if old.claimed_at is not null and new.claimed_at is distinct from old.claimed_at then
  raise exception 'Owner audio admission time is immutable';
 end if;
 if old.claimed_at is null and new.claimed_at is not null
  and not (old.state='inspecting' and new.state='claimed') then
  raise exception 'Owner audio admission marker requires claim';
 end if;
 if not (
  (old.state='armed' and new.state in ('inspecting','cancelled'))
  or (old.state='inspecting' and new.state in ('claimed','failed','needs_review'))
  or (old.state='claimed' and new.state in ('passed','failed','needs_review'))
  or (old.state='needs_review' and new.state in ('passed','failed','needs_review'))
 ) then raise exception 'Owner audio replay or backward transition forbidden'; end if;
 if new.state in ('inspecting','claimed') and new.expires_at<=clock_timestamp() then
  raise exception 'Owner audio admission expired';
 end if;
 if new.result is not null then
  -- These four compact facts are the entire storage allowlist. Never persist a
  -- transcript, audio, challenge plaintext, phone number, or raw provider body.
  if jsonb_typeof(new.result)<>'object'
   or not (new.result ?& array['status','forwarding','durationSeconds','challenge'])
   or (select count(*) from jsonb_object_keys(new.result))<>4
   or jsonb_typeof(new.result->'status')<>'string'
   or new.result->>'status' not in ('passed','failed','needs_review')
   or new.result->>'status' is distinct from new.state
   or jsonb_typeof(new.result->'forwarding')<>'string'
   or new.result->>'forwarding' not in ('verified','unverified','mismatch')
   or jsonb_typeof(new.result->'challenge')<>'string'
   or new.result->>'challenge' not in ('passed','failed','unverified')
   or jsonb_typeof(new.result->'durationSeconds') not in ('number','null') then
   raise exception 'Invalid compact owner audio result';
  end if;
  if jsonb_typeof(new.result->'durationSeconds')='number'
   and ((new.result->>'durationSeconds')::numeric<0 or (new.result->>'durationSeconds')::numeric>9007199254740991) then
   raise exception 'Invalid owner audio duration';
  end if;
  if new.state='passed' and (
   new.claimed_at is null
   or new.result->>'challenge'<>'passed'
   or new.result->>'forwarding'='mismatch'
   or jsonb_typeof(new.result->'durationSeconds')<>'number'
   or (new.result->>'durationSeconds')::numeric not between 1 and 60
  ) then raise exception 'Owner audio success evidence required'; end if;
 end if;
 return new;
end $$;
create trigger icash_owner_audio_once_immutable
before insert or update or delete on public.icash_owner_audio_once
for each row execute function public.icash_owner_audio_once_guard();
create trigger icash_owner_audio_once_no_truncate
before truncate on public.icash_owner_audio_once
for each statement execute function public.icash_owner_audio_once_guard();

create function public.icash_arm_owner_audio_once(
 p_account uuid,p_user uuid,p_hash text,p_version text,p_branch_name text,p_salt text,p_challenge_hash text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_owner_audio_once; t timestamptz:=clock_timestamp();
begin
 if p_account is distinct from '48dfb798-8c1a-404f-88c0-c396cc067062'::uuid
  or p_user is distinct from '592171a0-2bb9-484e-8c9a-dd5d2b43b5f7'::uuid
  or p_hash is null or p_hash !~ '^[a-f0-9]{64}$'
  or p_version is null or length(btrim(p_version)) not between 1 and 160
  or p_branch_name is null or length(btrim(p_branch_name)) not between 8 and 100
  or p_salt is null or p_salt !~ '^[a-f0-9]{64}$'
  or p_challenge_hash is null or p_challenge_hash !~ '^[a-f0-9]{64}$' then return null; end if;
 -- Deliberately no UPSERT update: the singleton is the permanent consumption
 -- record, even after cancellation, failure, expiry, or unresolved review.
 insert into public.icash_owner_audio_once(id,account_id,owner_user_id,state,config_hash,version_id,
  branch_name,challenge_salt,challenge_hash,armed_at,expires_at)
 values(1,p_account,p_user,'armed',p_hash,p_version,p_branch_name,p_salt,p_challenge_hash,t,t+interval '5 minutes')
 on conflict(id) do nothing returning * into r;
 if not found then return null; end if;
 return to_jsonb(r);
end $$;

create function public.icash_attempt_owner_audio_once(p_call_sid text,p_conversation text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_owner_audio_once;
begin
 if p_call_sid is null or p_call_sid !~ '^CA[a-fA-F0-9]{32}$'
  or p_conversation is null or p_conversation !~ '^conv_[A-Za-z0-9]{1,160}$' then return null; end if;
 -- Lock before checking wall-clock expiry. now() would freeze at transaction
 -- start and could admit an already expired call after waiting for a lock.
 select * into r from public.icash_owner_audio_once where id=1 for update;
 if not found or r.state<>'armed' or r.expires_at<=clock_timestamp() then return null; end if;
 update public.icash_owner_audio_once set state='inspecting',call_sid=p_call_sid,conversation_id=p_conversation
 where id=1 and state='armed' returning * into r;
 return to_jsonb(r);
end $$;

create function public.icash_claim_owner_audio_once(p_call_sid text,p_conversation text,p_hash text,p_version text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_owner_audio_once;
begin
 select * into r from public.icash_owner_audio_once where id=1 for update;
 if not found or r.state<>'inspecting' or r.expires_at<=clock_timestamp()
  or r.call_sid is distinct from p_call_sid or r.conversation_id is distinct from p_conversation
  or r.config_hash is distinct from p_hash or r.version_id is distinct from p_version then return null; end if;
 update public.icash_owner_audio_once set state='claimed',claimed_at=clock_timestamp()
 where id=1 and state='inspecting' returning * into r;
 return to_jsonb(r);
end $$;

create function public.icash_finish_owner_audio_once(p_call_sid text,p_conversation text,p_result jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_owner_audio_once;
begin
 select * into r from public.icash_owner_audio_once where id=1 for update;
 if not found or r.state not in ('inspecting','claimed','needs_review')
  or r.call_sid is distinct from p_call_sid or r.conversation_id is distinct from p_conversation then return null; end if;
 if p_result is null or jsonb_typeof(p_result)<>'object'
  or p_result->>'status' is null or p_result->>'status' not in ('passed','failed','needs_review') then
  raise exception 'Invalid compact owner audio result';
 end if;
 -- Completion may arrive after the admission window. It never admits another
 -- call. A passed AUDIO result does not imply verified forwarding evidence.
 if r.claimed_at is null and p_result->>'status'='passed' then return null; end if;
 update public.icash_owner_audio_once set state=p_result->>'status',result=p_result
 where id=1 and state in ('inspecting','claimed','needs_review') returning * into r;
 return to_jsonb(r);
end $$;

create function public.icash_cancel_owner_audio_once(p_account uuid,p_user uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r public.icash_owner_audio_once;
begin
 update public.icash_owner_audio_once set state='cancelled'
 where id=1 and state='armed' and account_id=p_account and owner_user_id=p_user returning * into r;
 if not found then return null; end if;
 return to_jsonb(r);
end $$;

-- Definers are necessary because service_role has no direct write privilege.
-- Revoke default PUBLIC/anon/authenticated grants in the same transaction as
-- creation, including Supabase's role-specific default privileges.
alter table public.icash_owner_audio_once enable row level security;
revoke all on table public.icash_owner_audio_once from public,anon,authenticated,service_role;
grant select on table public.icash_owner_audio_once to service_role;
create policy icash_owner_audio_once_service_read on public.icash_owner_audio_once
for select to service_role using (true);
revoke all on function public.icash_owner_audio_once_guard() from public,anon,authenticated,service_role;
revoke all on function public.icash_arm_owner_audio_once(uuid,uuid,text,text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.icash_attempt_owner_audio_once(text,text) from public,anon,authenticated,service_role;
revoke all on function public.icash_claim_owner_audio_once(text,text,text,text) from public,anon,authenticated,service_role;
revoke all on function public.icash_finish_owner_audio_once(text,text,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.icash_cancel_owner_audio_once(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.icash_arm_owner_audio_once(uuid,uuid,text,text,text,text,text) to service_role;
grant execute on function public.icash_attempt_owner_audio_once(text,text) to service_role;
grant execute on function public.icash_claim_owner_audio_once(text,text,text,text) to service_role;
grant execute on function public.icash_finish_owner_audio_once(text,text,jsonb) to service_role;
grant execute on function public.icash_cancel_owner_audio_once(uuid,uuid) to service_role;
commit;
