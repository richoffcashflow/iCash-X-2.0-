begin;
create or replace function public.icash_support_finish_conversation(p_account uuid,p_user uuid,p_thread uuid,p_request uuid,p_message text,p_evidence jsonb,p_status text,p_notify boolean) returns boolean
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
 -- Status-only operator resolutions have a system receipt, not an operator message.
 if t.status='resolved' then return false;end if;
 if exists(select 1 from public.icash_support_messages where thread_id=p_thread and role in ('operator','user') and (created_at,id)>(m.created_at,m.id)) then return false;end if;
 perform public.icash_support_finish_message(p_account,p_user,p_thread,p_request,p_message,p_evidence);
 update public.icash_support_threads set status=case when t.status='escalated' then 'escalated' else p_status end,updated_at=now() where id=p_thread;
 if p_notify then perform public.icash_queue_support_chat_copy(p_account,p_user,p_request);end if;
 return true;
end $$;
commit;
