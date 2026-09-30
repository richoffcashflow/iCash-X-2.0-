begin;
-- A single explicitly configured owner-phone acceptance check. No seed, no business
-- permission, no wallet mutation, no worker ticket and no ability to re-arm via API.
create table public.icash_owner_voice_acceptance_config(
 id integer primary key default 1 check(id=1),
 account_id uuid not null references public.icash_accounts(id),
 owner_user_id uuid not null references auth.users(id),
 phone text not null check(phone ~ '^\+[1-9][0-9]{7,14}$'),
 agent_id text not null check(agent_id ~ '^agent_[A-Za-z0-9]+$'),
 phone_number_id text not null check(phone_number_id ~ '^phnum_[A-Za-z0-9]+$'),
 branch_id text not null check(branch_id ~ '^agtbr[a-z]*_[A-Za-z0-9]+$'),
 branch_name text not null check(length(branch_name) between 8 and 100),
 reviewed_config_hash text check(reviewed_config_hash ~ '^[a-f0-9]{64}$'),
 reviewed_version_id text,
 enabled boolean not null default false,
 approval_ref text not null check(length(trim(approval_ref)) between 12 and 1000),
 created_at timestamptz not null default now(),
 expires_at timestamptz not null,
 check(isfinite(expires_at) and expires_at>created_at and expires_at<=created_at+interval '24 hours'),
 check(not enabled or (reviewed_config_hash is not null and reviewed_version_id is not null))
);
create table public.icash_owner_voice_acceptance_runs(
 id uuid primary key default gen_random_uuid(),
 config_id integer not null unique references public.icash_owner_voice_acceptance_config(id),
 account_id uuid not null references public.icash_accounts(id),
 owner_user_id uuid not null references auth.users(id),
 state text not null default 'claimed' check(state in ('claimed','accepted','needs_review')),
 configuration jsonb not null,
 claimed_at timestamptz not null default now(),
 conversation_id text,provider_call_sid text,
 updated_at timestamptz not null default now()
);
alter table public.icash_owner_voice_acceptance_config enable row level security;
alter table public.icash_owner_voice_acceptance_runs enable row level security;
revoke all on public.icash_owner_voice_acceptance_config,public.icash_owner_voice_acceptance_runs from public,anon,authenticated;
grant select,insert,update on public.icash_owner_voice_acceptance_config to service_role;
grant select,insert,update on public.icash_owner_voice_acceptance_runs to service_role;
create function public.icash_claim_owner_voice_acceptance(p_account uuid,p_user uuid,p_hash text,p_version text,p_expected jsonb)
returns jsonb language plpgsql set search_path='' as $$
declare c public.icash_owner_voice_acceptance_config;r public.icash_owner_voice_acceptance_runs;
begin
 select * into c from public.icash_owner_voice_acceptance_config where id=1 and account_id=p_account and owner_user_id=p_user for update;
 if not found or not c.enabled or c.expires_at<=now() or c.reviewed_config_hash is distinct from p_hash or c.reviewed_version_id is distinct from p_version or p_hash is null or p_version is null then return null;end if;
 if p_expected is null or to_jsonb(c) is distinct from to_jsonb(jsonb_populate_record(null::public.icash_owner_voice_acceptance_config,p_expected)) then return null;end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then return null;end if;
 insert into public.icash_owner_voice_acceptance_runs(config_id,account_id,owner_user_id,configuration)
 values(c.id,p_account,p_user,to_jsonb(c)) on conflict(config_id) do nothing returning * into r;
 if not found then return null;end if;
 -- Consumed before any provider write. Timeout, cancellation, process death and
 -- ambiguous receipt can never restore this one-use authorization.
 update public.icash_owner_voice_acceptance_config set enabled=false where id=c.id;
 return jsonb_build_object('id',r.id,'configuration',r.configuration);
end $$;
create function public.icash_finish_owner_voice_acceptance(p_account uuid,p_user uuid,p_run uuid,p_conversation text,p_sid text)
returns void language plpgsql set search_path='' as $$
begin
 if p_conversation is not null and (p_conversation !~ '^conv_[A-Za-z0-9]+$' or p_sid is null or p_sid !~ '^CA[a-fA-F0-9]{32}$') then raise exception 'Invalid owner-test receipt';end if;
 update public.icash_owner_voice_acceptance_runs set state=case when p_conversation is null then 'needs_review' else 'accepted' end,conversation_id=p_conversation,provider_call_sid=p_sid,updated_at=now()
 where id=p_run and account_id=p_account and owner_user_id=p_user and state='claimed';
end $$;
revoke all on function public.icash_claim_owner_voice_acceptance(uuid,uuid,text,text,jsonb),public.icash_finish_owner_voice_acceptance(uuid,uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_claim_owner_voice_acceptance(uuid,uuid,text,text,jsonb),public.icash_finish_owner_voice_acceptance(uuid,uuid,uuid,text,text) to service_role;
commit;
