-- Private acceptance results only; never used by an outbound dispatcher.
alter table public.icash_voice_test_sessions add column source text not null default 'browser' check(source in ('browser','phone_import'));
alter table public.icash_voice_test_access add column last_import_at timestamptz;
create function public.icash_import_voice_test(p_hash text,p_conversation text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare a public.icash_voice_test_access; cfg public.icash_voice_test_config; sid uuid;
begin
 select * into a from public.icash_voice_test_access where token_hash=p_hash for update;
 if not found or a.revoked or a.expires_at<=now() then raise exception 'ACCESS_DENIED'; end if;
 if p_conversation !~ '^conv_[a-zA-Z0-9_-]{1,120}$' then raise exception 'INVALID_CONVERSATION'; end if;
 select id into sid from public.icash_voice_test_sessions where conversation_id=p_conversation and token_hash=p_hash;
 if found then return sid; end if;
 if a.last_import_at>now()-interval '5 seconds' then raise exception 'IMPORT_RATE_LIMIT'; end if;
 if (select count(*) from public.icash_voice_test_sessions where token_hash=p_hash and source='phone_import')>=10 then raise exception 'IMPORT_LIMIT'; end if;
 select * into cfg from public.icash_voice_test_config where id=1;
 if not cfg.enabled or cfg.agent_id is null then raise exception 'NOT_READY'; end if;
 insert into public.icash_voice_test_sessions(token_hash,agent_id,conversation_id,state,source)
 values(p_hash,cfg.agent_id,p_conversation,'issued','phone_import') returning id into sid;
 update public.icash_voice_test_access set last_import_at=now() where token_hash=p_hash;
 return sid;
end $$;
revoke all on function public.icash_import_voice_test(text,text) from public,anon,authenticated;
grant execute on function public.icash_import_voice_test(text,text) to service_role;
