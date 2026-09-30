-- Staged only. Apply after review to the existing account schema. No customer/owner is granted operator access here.
begin;
create table if not exists public.icash_support_threads(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 subject text not null check(length(subject) between 1 and 120),
 status text not null default 'open' check(status in ('open','escalated','waiting_on_customer','resolved')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(id,account_id)
);
create index if not exists icash_support_threads_queue on public.icash_support_threads(status,updated_at desc);
create table if not exists public.icash_support_messages(
 id uuid primary key default gen_random_uuid(),thread_id uuid not null,account_id uuid not null,
 request_id uuid not null,role text not null check(role in ('user','assistant','operator','system')),
 content text not null check(length(content) between 1 and 6000),evidence jsonb not null default '[]',
 actor_user_id uuid references auth.users(id),created_at timestamptz not null default now(),
 foreign key(thread_id,account_id) references public.icash_support_threads(id,account_id),
 unique(account_id,request_id,role),check(jsonb_typeof(evidence)='array'),check(pg_column_size(evidence)<32000)
);
create index if not exists icash_support_messages_thread on public.icash_support_messages(thread_id,created_at);
create table if not exists public.icash_support_cancel_requests(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),
 user_id uuid not null references auth.users(id),mode text not null check(mode in ('test','live')),source text not null check(source in ('account','email')),
 provider_email_id uuid unique,state text not null default 'awaiting_confirmation' check(state in ('awaiting_confirmation','processing','cancelled','needs_review')),
 nonce_hash text,expires_at timestamptz,consumed_at timestamptz,confirmed_at timestamptz,
 result text,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index if not exists icash_support_cancellations_account on public.icash_support_cancel_requests(account_id,created_at desc);
create or replace function public.icash_support_begin_message(p_account uuid,p_user uuid,p_thread uuid,p_request uuid,p_message text)
returns jsonb language plpgsql set search_path='' as $$
declare t public.icash_support_threads;m public.icash_support_messages;response public.icash_support_messages;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;
 if not found then raise exception 'Account unavailable';end if;
 if p_message is null or length(trim(p_message)) not between 1 and 2000 or p_request is null then raise exception 'Invalid message';end if;
 select * into m from public.icash_support_messages where account_id=p_account and request_id=p_request and role='user';
 if found then
  if m.content<>p_message or (p_thread is not null and m.thread_id<>p_thread) then raise exception 'Request mismatch';end if;
  select * into response from public.icash_support_messages where account_id=p_account and request_id=p_request and role='assistant';
  return jsonb_build_object('threadId',m.thread_id,'replay',true,'response',case when response.id is not null then to_jsonb(response) else null end);
 end if;
 if (select count(*) from public.icash_support_messages where account_id=p_account and role='user' and created_at>now()-interval '1 minute')>=6
 or (select count(*) from public.icash_support_messages where account_id=p_account and role='user' and created_at>now()-interval '1 day')>=60 then return jsonb_build_object('rateLimited',true);end if;
 if p_thread is not null then select * into t from public.icash_support_threads where id=p_thread and account_id=p_account;
  if not found then raise exception 'Conversation unavailable';end if;
 else select * into t from public.icash_support_threads where account_id=p_account and status<>'resolved' order by updated_at desc limit 1;
 end if;
 if t.id is null then insert into public.icash_support_threads(account_id,subject) values(p_account,left(p_message,120)) returning * into t;end if;
 insert into public.icash_support_messages(thread_id,account_id,request_id,role,content,actor_user_id) values(t.id,p_account,p_request,'user',p_message,p_user);
 update public.icash_support_threads set updated_at=now(),status=case when status in ('resolved','waiting_on_customer') then 'open' else status end where id=t.id;
 return jsonb_build_object('threadId',t.id,'replay',false);
end $$;
create or replace function public.icash_support_finish_message(p_account uuid,p_user uuid,p_thread uuid,p_request uuid,p_message text,p_evidence jsonb)
returns void language plpgsql set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) or not exists(select 1 from public.icash_support_messages where account_id=p_account and thread_id=p_thread and request_id=p_request and role='user') then raise exception 'Conversation unavailable';end if;
 insert into public.icash_support_messages(thread_id,account_id,request_id,role,content,evidence) values(p_thread,p_account,p_request,'assistant',p_message,p_evidence) on conflict(account_id,request_id,role) do nothing;
 update public.icash_support_threads set updated_at=now() where id=p_thread and account_id=p_account;
end $$;
create or replace function public.icash_support_escalate(p_account uuid,p_user uuid,p_thread uuid)
returns boolean language plpgsql set search_path='' as $$
declare t public.icash_support_threads;
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account unavailable';end if;
 select * into t from public.icash_support_threads where id=p_thread and account_id=p_account for update;
 if not found then return false;end if;
 if t.status<>'escalated' then
  update public.icash_support_threads set status='escalated',updated_at=now() where id=t.id;
  insert into public.icash_support_messages(thread_id,account_id,request_id,role,content,actor_user_id) values(t.id,p_account,gen_random_uuid(),'system','Sent to the support queue with this conversation and its status checks. No response time is guaranteed.',p_user);
 end if;
 return true;
end $$;
revoke all on function public.icash_support_escalate(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_support_escalate(uuid,uuid,uuid) to service_role;
-- A verified webhook is evidence of delivery only. Even a matching From address grants NO cancellation authority.
create or replace function public.icash_support_request_email_cancel(p_email text,p_provider uuid,p_mode text)
returns void language plpgsql set search_path='' as $$
declare a uuid;u uuid;
begin
 if p_mode is null or p_mode not in ('test','live') then raise exception 'Mode required';end if;
 select ac.id,au.id into a,u from public.icash_accounts ac join auth.users au on au.id=ac.owner_user_id
 where lower(au.email)=lower(trim(p_email)) and au.email_confirmed_at is not null;
 if a is null or p_provider is null or (select count(*) from public.icash_accounts ac join auth.users au on au.id=ac.owner_user_id where lower(au.email)=lower(trim(p_email)) and au.email_confirmed_at is not null)<>1 then return;end if;
 if exists(select 1 from public.icash_support_cancel_requests where provider_email_id=p_provider) then return;end if;
 perform 1 from public.icash_accounts where id=a for update;
 if (select count(*) from public.icash_support_cancel_requests where account_id=a and source='email' and created_at>now()-interval '1 hour')>=3 then return;end if;
 insert into public.icash_support_cancel_requests(account_id,user_id,mode,source,provider_email_id) values(a,u,p_mode,'email',p_provider) on conflict(provider_email_id) do nothing;
end $$;
create or replace function public.icash_support_prepare_cancel(p_account uuid,p_user uuid,p_mode text,p_request uuid,p_nonce text)
returns uuid language plpgsql set search_path='' as $$
declare r public.icash_support_cancel_requests;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;if not found then raise exception 'Account unavailable';end if;
 if p_mode is null or p_mode not in ('test','live') then raise exception 'Mode required';end if;
 if p_nonce is null or p_nonce!~'^[a-f0-9]{64}$' then raise exception 'Invalid confirmation';end if;
 if p_request is not null then select * into r from public.icash_support_cancel_requests where id=p_request and account_id=p_account and user_id=p_user and mode=p_mode for update;
  if not found or r.state='cancelled' or (r.state='processing' and r.updated_at>now()-interval '5 minutes') then raise exception 'Confirmation unavailable';end if;
 else select * into r from public.icash_support_cancel_requests where account_id=p_account and user_id=p_user and mode=p_mode and state in ('awaiting_confirmation','needs_review') order by created_at desc limit 1 for update;
 end if;
 if r.id is null then insert into public.icash_support_cancel_requests(account_id,user_id,mode,source) values(p_account,p_user,p_mode,'account') returning * into r;end if;
 update public.icash_support_cancel_requests set state='awaiting_confirmation',nonce_hash=p_nonce,expires_at=now()+interval '10 minutes',consumed_at=null,updated_at=now() where id=r.id;
 return r.id;
end $$;
create or replace function public.icash_support_claim_cancel(p_account uuid,p_user uuid,p_mode text,p_request uuid,p_nonce text)
returns boolean language plpgsql set search_path='' as $$
declare r public.icash_support_cancel_requests;
begin
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_user for update;if not found then raise exception 'Account unavailable';end if;
 select * into r from public.icash_support_cancel_requests where id=p_request and account_id=p_account and user_id=p_user and mode=p_mode for update;
 if not found or r.state<>'awaiting_confirmation' or r.consumed_at is not null or r.expires_at<=now() or r.nonce_hash is distinct from p_nonce then return false;end if;
 update public.icash_support_cancel_requests set state='processing',consumed_at=now(),confirmed_at=now(),updated_at=now() where id=r.id;
 update public.icash_accounts set bot_paused=true where id=p_account;
 -- This is the existing durable daily-renewal stop queue; a crash cannot undo the pause/stop intent.
 update public.icash_daily_plans set state='stop_requested' where account_id=p_account and mode=p_mode and state<>'stopped';
 return true;
end $$;
-- Depends on reviewed-action-authority's provisioned icash_trusted_operators table.
create or replace function public.icash_support_operator_update(p_operator uuid,p_thread uuid,p_status text,p_reply text,p_request uuid)
returns void language plpgsql set search_path='' as $$
declare t public.icash_support_threads;
begin
 if not exists(select 1 from public.icash_trusted_operators where user_id=p_operator and revoked_at is null and expires_at>now() and scopes @> ARRAY['support']::text[]) then raise exception 'Operator required';end if;
 if p_request is null then raise exception 'Request required';end if;
 if p_status not in ('open','escalated','waiting_on_customer','resolved') or (p_reply is not null and length(trim(p_reply)) not between 1 and 3000) then raise exception 'Invalid update';end if;
 select * into t from public.icash_support_threads where id=p_thread for update;if not found then raise exception 'Conversation unavailable';end if;
 if exists(select 1 from public.icash_support_messages where request_id=p_request and role='system' and actor_user_id=p_operator and thread_id=p_thread) then return;end if;
 if p_reply is not null then insert into public.icash_support_messages(thread_id,account_id,request_id,role,content,actor_user_id) values(t.id,t.account_id,p_request,'operator',p_reply,p_operator);end if;
 insert into public.icash_support_messages(thread_id,account_id,request_id,role,content,actor_user_id) values(t.id,t.account_id,p_request,'system','Support status set to '||replace(p_status,'_',' ')||'.',p_operator);
 update public.icash_support_threads set status=p_status,updated_at=now() where id=t.id;
end $$;
revoke all on function public.icash_support_operator_update(uuid,uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.icash_support_operator_update(uuid,uuid,text,text,uuid) to service_role;
alter table public.icash_support_threads enable row level security;
alter table public.icash_support_messages enable row level security;
alter table public.icash_support_cancel_requests enable row level security;
revoke all on public.icash_support_threads,public.icash_support_messages,public.icash_support_cancel_requests from public,anon,authenticated;
grant all on public.icash_support_threads,public.icash_support_messages,public.icash_support_cancel_requests to service_role;
revoke all on function public.icash_support_begin_message(uuid,uuid,uuid,uuid,text),public.icash_support_finish_message(uuid,uuid,uuid,uuid,text,jsonb),public.icash_support_request_email_cancel(text,uuid,text),public.icash_support_prepare_cancel(uuid,uuid,text,uuid,text),public.icash_support_claim_cancel(uuid,uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_support_begin_message(uuid,uuid,uuid,uuid,text),public.icash_support_finish_message(uuid,uuid,uuid,uuid,text,jsonb),public.icash_support_request_email_cancel(text,uuid,text),public.icash_support_prepare_cancel(uuid,uuid,text,uuid,text),public.icash_support_claim_cancel(uuid,uuid,text,uuid,text) to service_role;
commit;
