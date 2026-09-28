-- Isolated owner acceptance tests: never connected to wallets, sellers or live callbacks.
create table public.icash_voice_test_config (
 id integer primary key check(id=1), agent_id text, provisioning_claimed boolean not null default false,
 enabled boolean not null default false, created_at timestamptz not null default now()
);
insert into public.icash_voice_test_config(id) values(1);
create table public.icash_voice_test_access (
 token_hash text primary key check(token_hash ~ '^[a-f0-9]{64}$'),
 expires_at timestamptz not null, max_sessions integer not null default 3 check(max_sessions between 1 and 5),
 used_sessions integer not null default 0 check(used_sessions>=0), revoked boolean not null default false
);
create table public.icash_voice_test_sessions (
 id uuid primary key default gen_random_uuid(), token_hash text not null references public.icash_voice_test_access(token_hash),
 agent_id text not null, conversation_id text unique,
 state text not null default 'reserved' check(state in ('reserved','issued','complete','error')),
 created_at timestamptz not null default now(), last_poll_at timestamptz, completed_at timestamptz,
 result jsonb, callback_status text, callback_due_at timestamptz,
 check(callback_status is null or callback_status in ('not_requested','needs_confirmation','blocked_opt_out','scheduled_test'))
);
create index icash_voice_test_access_sessions on public.icash_voice_test_sessions(token_hash,created_at desc);
create index icash_voice_test_due on public.icash_voice_test_sessions(callback_due_at) where callback_status='scheduled_test';
alter table public.icash_voice_test_config enable row level security;
alter table public.icash_voice_test_access enable row level security;
alter table public.icash_voice_test_sessions enable row level security;
revoke all on public.icash_voice_test_config,public.icash_voice_test_access,public.icash_voice_test_sessions from public,anon,authenticated;
grant select,insert,update,delete on public.icash_voice_test_config,public.icash_voice_test_access,public.icash_voice_test_sessions to service_role;

create function public.icash_reserve_voice_test(p_hash text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare a public.icash_voice_test_access; cfg public.icash_voice_test_config; sid uuid;
begin
 select * into a from public.icash_voice_test_access where token_hash=p_hash for update;
 if not found or a.revoked or a.expires_at<=now() or a.used_sessions>=a.max_sessions then raise exception 'VOICE_TEST_ACCESS_DENIED'; end if;
 select * into cfg from public.icash_voice_test_config where id=1 for update;
 if not cfg.enabled or cfg.agent_id is null then raise exception 'VOICE_TEST_NOT_READY'; end if;
 -- Also serialize across test grants; stale unknown sessions block for the token expiry plus max call duration.
 if exists(select 1 from public.icash_voice_test_sessions where state in ('reserved','issued') and created_at>now()-interval '20 minutes') then raise exception 'VOICE_TEST_IN_PROGRESS'; end if;
 update public.icash_voice_test_access set used_sessions=used_sessions+1 where token_hash=p_hash;
 insert into public.icash_voice_test_sessions(token_hash,agent_id) values(p_hash,cfg.agent_id) returning id into sid;
 return sid;
end $$;
revoke all on function public.icash_reserve_voice_test(text) from public,anon,authenticated;
grant execute on function public.icash_reserve_voice_test(text) to service_role;

create function public.icash_voice_test_poll(p_id uuid,p_hash text) returns boolean
language sql security invoker set search_path='' as $$
 with changed as (
 update public.icash_voice_test_sessions s set last_poll_at=now()
 where s.id=p_id and s.token_hash=p_hash and s.state='issued'
 and (s.last_poll_at is null or s.last_poll_at<now()-interval '5 seconds')
 and exists(select 1 from public.icash_voice_test_access a where a.token_hash=p_hash and not a.revoked and a.expires_at>now()) returning s.id
 ) select exists(select 1 from changed);
$$;
revoke all on function public.icash_voice_test_poll(uuid,text) from public,anon,authenticated;
grant execute on function public.icash_voice_test_poll(uuid,text) to service_role;
