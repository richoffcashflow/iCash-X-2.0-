begin;
create table public.icash_custom_voices (
 account_id uuid primary key references public.icash_accounts(id),
 id uuid not null unique default gen_random_uuid(),
 state text not null check(state in ('creating','ready','verification_required','unknown','failed')),
 voice_id text unique check(voice_id ~ '^[A-Za-z0-9_-]{5,100}$'),
 enabled boolean not null default true,
 consent_version text not null check(consent_version='own-voice-2026-10-07.1'),
 consent_user uuid not null,
 sample_sha256 text not null check(sample_sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
alter table public.icash_custom_voices enable row level security;
revoke all on public.icash_custom_voices from public,anon,authenticated;
grant all on public.icash_custom_voices to service_role;

create function public.icash_begin_custom_voice(p_user uuid,p_account uuid,p_hash text,p_consent text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare v public.icash_custom_voices;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found or not public.icash_vip_active(p_account) then raise exception 'VIP required';end if;
 if p_consent is distinct from 'own-voice-2026-10-07.1' or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then raise exception 'Voice consent required';end if;
 select * into v from public.icash_custom_voices where account_id=p_account for update;
 if found and v.state<>'failed' then return jsonb_build_object('started',false,'voice',to_jsonb(v));end if;
 if found and v.updated_at>now()-interval '1 minute' then raise exception 'Please wait before retrying';end if;
 insert into public.icash_custom_voices(account_id,state,consent_version,consent_user,sample_sha256)
 values(p_account,'creating',p_consent,p_user,p_hash)
 on conflict(account_id) do update set id=gen_random_uuid(),state='creating',voice_id=null,enabled=true,consent_version=excluded.consent_version,consent_user=excluded.consent_user,sample_sha256=excluded.sample_sha256,created_at=now(),updated_at=now()
 returning * into v;
 return jsonb_build_object('started',true,'voice',to_jsonb(v));
end $$;
create function public.icash_set_custom_voice_enabled(p_user uuid,p_account uuid,p_enabled boolean)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found or p_enabled is null then raise exception 'Account required';end if;
 if p_enabled and not public.icash_vip_active(p_account) then raise exception 'VIP required';end if;
 update public.icash_custom_voices set enabled=p_enabled,updated_at=now() where account_id=p_account and (not p_enabled or state='ready');
 if not found then raise exception 'Voice is not ready';end if;
end $$;
create function public.icash_vip_call_voice(p_account uuid) returns text language sql stable security invoker set search_path='' as $$
 select voice_id from public.icash_custom_voices where account_id=p_account and state='ready' and enabled and public.icash_vip_active(p_account)
$$;
revoke all on function public.icash_begin_custom_voice(uuid,uuid,text,text),public.icash_set_custom_voice_enabled(uuid,uuid,boolean),public.icash_vip_call_voice(uuid) from public,anon,authenticated;
grant execute on function public.icash_begin_custom_voice(uuid,uuid,text,text),public.icash_set_custom_voice_enabled(uuid,uuid,boolean),public.icash_vip_call_voice(uuid) to service_role;
commit;
