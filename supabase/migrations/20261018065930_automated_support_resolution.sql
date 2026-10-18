begin;
create or replace function public.icash_support_finish_conversation(p_account uuid,p_user uuid,p_thread uuid,p_request uuid,p_message text,p_evidence jsonb,p_status text,p_notify boolean) returns boolean
language plpgsql security invoker set search_path='' as $$
declare t public.icash_support_threads; m public.icash_support_messages;
begin
 if p_status is null or p_status not in ('open','waiting_on_customer','escalated','resolved') then raise exception 'Invalid reply status';end if;
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account unavailable';end if;
 select * into t from public.icash_support_threads where id=p_thread and account_id=p_account for update;
 if not found then raise exception 'Conversation unavailable';end if;
 select * into m from public.icash_support_messages where account_id=p_account and thread_id=p_thread and request_id=p_request and role='user';
 if not found then raise exception 'Message unavailable';end if;
 if exists(select 1 from public.icash_support_messages where account_id=p_account and request_id=p_request and role='assistant') then return true;end if;
 -- Status-only operator resolutions have a system receipt, not an operator message.
 if t.status='resolved' then return false;end if;
 if exists(select 1 from public.icash_support_messages where thread_id=p_thread and role in ('operator','user') and (created_at,id)>(m.created_at,m.id)) then return false;end if;
 perform public.icash_support_finish_message(p_account,p_user,p_thread,p_request,p_message,p_evidence);
 update public.icash_support_threads set status=case when p_status='escalated' then 'open' else p_status end,updated_at=now() where id=p_thread;
 if p_notify then perform public.icash_queue_support_chat_copy(p_account,p_user,p_request);end if;
 return true;
end $$;

create or replace function public.icash_access_help_finish_reply(p_id uuid,p_key uuid,p_token uuid,p_reply text,p_status text,p_handoff boolean) returns boolean
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
 update public.icash_access_help_requests set status=p_status,needs_operator=false,updated_at=now() where id=p_id;
 update public.icash_support_owner_copies set reply=p_reply,reply_status='saved',next_attempt_at=now(),updated_at=now()
 where source='access_help' and source_id=m.id and message is null and status='pending';
 return true;
end $$;


-- Only a claimed support turn can initiate identity-safe account repair. The
-- request email never becomes authentication and no account details are returned.
create function public.icash_access_help_recover(p_id uuid,p_key uuid,p_token uuid) returns void
language plpgsql security invoker set search_path='' as $$
declare verified_user uuid;
begin
 select u.id into verified_user from public.icash_access_help_requests r
 join public.icash_access_help_messages m on m.request_id=r.id and m.request_key=p_key and m.role='user'
 join auth.users u on lower(u.email)=lower(r.email) and u.email_confirmed_at is not null
 where r.id=p_id and r.expires_at>now() and m.reply_token=p_token and m.reply_completed_at is null
 and u.deleted_at is null and (u.banned_until is null or u.banned_until<=now());
 if verified_user is not null then perform public.icash_claim_funding(verified_user,'live');end if;
end $$;
revoke all on function public.icash_access_help_recover(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_access_help_recover(uuid,uuid,uuid) to service_role;
-- Legacy status values remain readable, but future replies never hand off.
update public.icash_support_threads set status='open' where status='escalated';
update public.icash_access_help_requests set needs_operator=false where needs_operator;
commit;
