begin;
alter table public.icash_access_help_requests add column needs_operator boolean not null default false;
alter table public.icash_access_help_messages drop constraint icash_access_help_messages_role_check;
alter table public.icash_access_help_messages add constraint icash_access_help_messages_role_check check(role in ('user','operator','assistant'));
alter table public.icash_access_help_messages add column reply_token uuid;
alter table public.icash_access_help_messages add column reply_claimed_at timestamptz;
alter table public.icash_access_help_messages add column reply_completed_at timestamptz;
alter table public.icash_access_help_messages add column in_reply_to uuid unique references public.icash_access_help_messages(id);
create index icash_access_help_unanswered on public.icash_access_help_messages(request_id,created_at desc) where role='user' and reply_completed_at is null;

create function public.icash_access_help_claim_reply(p_id uuid,p_key uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.icash_access_help_requests; m public.icash_access_help_messages; token uuid:=gen_random_uuid();
begin
 select * into r from public.icash_access_help_requests where id=p_id for update;
 if not found or r.expires_at<=now() or r.status='resolved' then return null;end if;
 select * into m from public.icash_access_help_messages where request_id=p_id and request_key=p_key and role='user' for update;
 if not found or m.reply_completed_at is not null or m.reply_claimed_at>now()-interval '1 minute' then return null;end if;
 if exists(select 1 from public.icash_access_help_messages where request_id=p_id and role in ('user','operator') and (created_at,id)>(m.created_at,m.id)) then
  update public.icash_access_help_messages set reply_completed_at=now() where id=m.id;return null;
 end if;
 update public.icash_access_help_messages set reply_token=token,reply_claimed_at=now() where id=m.id;
 return jsonb_build_object('token',token,'handedOff',r.needs_operator,'messages',
  (select jsonb_agg(jsonb_build_object('role',x.role,'content',x.content) order by x.created_at,x.id) from
   (select role,content,created_at,id from public.icash_access_help_messages where request_id=p_id order by created_at desc,id desc limit 20) x));
end $$;

create function public.icash_access_help_finish_reply(p_id uuid,p_key uuid,p_token uuid,p_reply text,p_status text,p_handoff boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare r public.icash_access_help_requests; m public.icash_access_help_messages;
begin
 if p_reply is null or length(trim(p_reply)) not between 1 and 3000 or p_status is null or p_status not in ('open','waiting_on_customer','resolved') or p_handoff is null then raise exception 'Invalid reply';end if;
 select * into r from public.icash_access_help_requests where id=p_id for update;
 if not found or r.expires_at<=now() or r.status='resolved' then return false;end if;
 select * into m from public.icash_access_help_messages where request_id=p_id and request_key=p_key and role='user' for update;
 if not found or p_token is null or m.reply_token is distinct from p_token or m.reply_completed_at is not null then return false;end if;
 update public.icash_access_help_messages set reply_completed_at=now() where id=m.id;
 if exists(select 1 from public.icash_access_help_messages where request_id=p_id and role in ('user','operator') and (created_at,id)>(m.created_at,m.id)) then return false;end if;
 insert into public.icash_access_help_messages(request_id,request_key,role,content,in_reply_to) values(p_id,gen_random_uuid(),'assistant',p_reply,m.id) on conflict(in_reply_to) do nothing;
 update public.icash_access_help_requests set status=p_status,needs_operator=needs_operator or p_handoff,updated_at=now() where id=p_id;
 update public.icash_support_owner_copies set reply=p_reply,reply_status='saved',next_attempt_at=now(),updated_at=now()
 where source='access_help' and source_id=m.id and message is null and status='pending';
 return true;
end $$;

create function public.icash_access_help_pending_replies() returns jsonb
language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('id',x.request_id,'key',x.request_key)),'[]'::jsonb) from (
 select m.request_id,m.request_key from public.icash_access_help_messages m join public.icash_access_help_requests r on r.id=m.request_id
 where m.role='user' and m.reply_completed_at is null and (m.reply_claimed_at is null or m.reply_claimed_at<=now()-interval '1 minute')
 and r.expires_at>now() and r.status<>'resolved'
 and not exists(select 1 from public.icash_access_help_messages newer where newer.request_id=m.request_id and newer.role in ('user','operator') and (newer.created_at,newer.id)>(m.created_at,m.id))
 order by m.created_at limit 10) x;
$$;

-- Give the reply transaction a short opportunity to add the actual answer to
-- the existing durable owner copy. An interrupted reply never blocks it forever.
create function public.icash_delay_access_help_copy() returns trigger
language plpgsql security invoker set search_path='' as $$
begin
 if new.source='access_help' then new.next_attempt_at:=now()+interval '2 minutes';end if;
 return new;
end $$;
create trigger icash_delay_access_help_copy before insert on public.icash_support_owner_copies for each row execute function public.icash_delay_access_help_copy();

create function public.icash_support_finish_conversation(p_account uuid,p_user uuid,p_thread uuid,p_request uuid,p_message text,p_evidence jsonb,p_status text,p_notify boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare t public.icash_support_threads; m public.icash_support_messages;
begin
 if p_status is null or p_status not in ('waiting_on_customer','escalated','resolved') then raise exception 'Invalid reply status';end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account unavailable';end if;
 select * into t from public.icash_support_threads where id=p_thread and account_id=p_account for update;
 if not found then raise exception 'Conversation unavailable';end if;
 select * into m from public.icash_support_messages where account_id=p_account and thread_id=p_thread and request_id=p_request and role='user';
 if not found then raise exception 'Message unavailable';end if;
 if exists(select 1 from public.icash_support_messages where account_id=p_account and request_id=p_request and role='assistant') then return true;end if;
 if exists(select 1 from public.icash_support_messages where thread_id=p_thread and role in ('operator','user') and (created_at,id)>(m.created_at,m.id)) then return false;end if;
 perform public.icash_support_finish_message(p_account,p_user,p_thread,p_request,p_message,p_evidence);
 update public.icash_support_threads set status=case when t.status='escalated' then 'escalated' else p_status end,updated_at=now() where id=p_thread;
 if p_notify then perform public.icash_queue_support_chat_copy(p_account,p_user,p_request);end if;
 return true;
end $$;

revoke all on function public.icash_access_help_claim_reply(uuid,uuid),public.icash_access_help_finish_reply(uuid,uuid,uuid,text,text,boolean),public.icash_access_help_pending_replies(),public.icash_delay_access_help_copy(),public.icash_support_finish_conversation(uuid,uuid,uuid,uuid,text,jsonb,text,boolean) from public,anon,authenticated;
grant execute on function public.icash_access_help_claim_reply(uuid,uuid),public.icash_access_help_finish_reply(uuid,uuid,uuid,text,text,boolean),public.icash_access_help_pending_replies(),public.icash_support_finish_conversation(uuid,uuid,uuid,uuid,text,jsonb,text,boolean) to service_role;
commit;
