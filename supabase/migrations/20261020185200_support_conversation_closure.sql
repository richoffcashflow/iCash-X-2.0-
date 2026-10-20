begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Closing archives a conversation, not a claim that its issue was resolved.
alter table public.icash_support_threads drop constraint icash_support_threads_status_check;
alter table public.icash_support_threads add constraint icash_support_threads_status_check check(status in ('open','escalated','waiting_on_customer','resolved','closed'));
alter table public.icash_access_help_requests drop constraint icash_access_help_requests_status_check;
alter table public.icash_access_help_requests add constraint icash_access_help_requests_status_check check(status in ('open','waiting_on_customer','resolved','closed'));
alter table public.icash_access_help_messages drop constraint icash_access_help_messages_role_check;
alter table public.icash_access_help_messages add constraint icash_access_help_messages_role_check check(role in ('user','assistant','operator','system'));

-- Preserve the installed authorization, receipt, token and race checks. Refuse
-- deployment if any expected clause has independently changed.
do $patch$
declare item record; definition text;
begin
 for item in select * from (values
 ('public.icash_support_begin_message(uuid,uuid,uuid,uuid,text)', 'status<>''resolved''', 'status not in (''resolved'',''closed'')'),
 ('public.icash_support_begin_message(uuid,uuid,uuid,uuid,text)', 'status in (''resolved'',''waiting_on_customer'')', 'status in (''resolved'',''closed'',''waiting_on_customer'')'),
 ('public.icash_support_begin_message(uuid,uuid,uuid,uuid,text)', 'where id=p_thread and account_id=p_account;', 'where id=p_thread and account_id=p_account for update;'),
 ('public.icash_support_begin_message(uuid,uuid,uuid,uuid,text)', 'order by updated_at desc limit 1;', 'order by updated_at desc limit 1 for update;'),
 ('public.icash_support_finish_conversation(uuid,uuid,uuid,uuid,text,jsonb,text,boolean)', '(''open'',''waiting_on_customer'',''escalated'',''resolved'')', '(''open'',''waiting_on_customer'',''escalated'',''resolved'',''closed'')'),
 ('public.icash_support_finish_conversation(uuid,uuid,uuid,uuid,text,jsonb,text,boolean)', 't.status=''resolved''', 't.status in (''resolved'',''closed'')'),
 ('public.icash_support_operator_update(uuid,uuid,text,text,uuid)', '(''open'',''escalated'',''waiting_on_customer'',''resolved'')', '(''open'',''escalated'',''waiting_on_customer'',''resolved'',''closed'')'),
 ('public.icash_access_help_operator_update(uuid,uuid,uuid,text,text)', '(''open'',''waiting_on_customer'',''resolved'')', '(''open'',''waiting_on_customer'',''resolved'',''closed'')'),
 ('public.icash_access_help_finish_reply(uuid,uuid,uuid,text,text,boolean)', '(''open'',''waiting_on_customer'',''resolved'')', '(''open'',''waiting_on_customer'',''resolved'',''closed'')'),
 ('public.icash_access_help_finish_reply(uuid,uuid,uuid,text,text,boolean)', 'r.status=''resolved''', 'r.status in (''resolved'',''closed'')'),
 ('public.icash_access_help_claim_reply(uuid,uuid)', 'r.status=''resolved''', 'r.status in (''resolved'',''closed'')'),
 ('public.icash_access_help_pending_replies()', 'r.status<>''resolved''', 'r.status not in (''resolved'',''closed'')')
 ) as changes(signature,needle,replacement)
 loop
  definition:=pg_get_functiondef(item.signature::regprocedure);
  if (length(definition)-length(replace(definition,item.needle,'')))/length(item.needle)<>1 then
   raise exception 'Support closure source changed: % / %',item.signature,item.needle;
  end if;
  execute replace(definition,item.needle,item.replacement);
 end loop;
end $patch$;

create index icash_support_waiting_expiry on public.icash_support_threads(updated_at,id) where status='waiting_on_customer';
create index icash_access_help_waiting_expiry on public.icash_access_help_requests(updated_at,id) where status='waiting_on_customer';

-- Existing authenticated maintenance invokes this bounded batch. Inactivity
-- never closes an unanswered customer turn, active troubleshooting or a claim.
-- System notices stay in chat; they do not enqueue customer email notifications.
create function public.icash_close_inactive_support() returns jsonb
language plpgsql security invoker set search_path='' as $$
declare t record; latest record; account_count integer:=0; access_count integer:=0;
 notice constant text:='I haven’t heard back, so I’m closing this chat for now. Reply here whenever you’re ready and we can pick up where we left off.';
begin
 for t in select x.id,x.account_id from public.icash_support_threads x
  cross join lateral (select role,created_at from public.icash_support_messages where thread_id=x.id and account_id=x.account_id order by created_at desc,id desc limit 1) m
  where x.status='waiting_on_customer' and x.updated_at<=now()-interval '24 hours'
   and m.role in ('assistant','operator') and m.created_at<=now()-interval '24 hours'
   and not exists(select 1 from public.icash_support_cancel_requests where account_id=x.account_id and state in ('processing','needs_review'))
  order by x.updated_at,x.id limit 100 for update of x skip locked
 loop
  select role,created_at into latest from public.icash_support_messages where thread_id=t.id and account_id=t.account_id order by created_at desc,id desc limit 1;
  if not found or latest.role not in ('assistant','operator') or latest.created_at>now()-interval '24 hours' then continue;end if;
  if exists(select 1 from public.icash_support_cancel_requests where account_id=t.account_id and state in ('processing','needs_review')) then continue;end if;
  insert into public.icash_support_messages(thread_id,account_id,request_id,role,content) values(t.id,t.account_id,gen_random_uuid(),'system',notice);
  update public.icash_support_threads set status='closed',updated_at=now() where id=t.id;
  account_count:=account_count+1;
 end loop;
 for t in select x.id from public.icash_access_help_requests x
  cross join lateral (select role,created_at from public.icash_access_help_messages where request_id=x.id order by created_at desc,id desc limit 1) m
  where x.status='waiting_on_customer' and not x.needs_operator and x.updated_at<=now()-interval '24 hours'
   and m.role in ('assistant','operator') and m.created_at<=now()-interval '24 hours'
   and not exists(select 1 from public.icash_access_help_messages where request_id=x.id and role='user' and reply_claimed_at>now()-interval '1 minute' and reply_completed_at is null)
  order by x.updated_at,x.id limit 100 for update of x skip locked
 loop
  select role,created_at into latest from public.icash_access_help_messages where request_id=t.id order by created_at desc,id desc limit 1;
  if not found or latest.role not in ('assistant','operator') or latest.created_at>now()-interval '24 hours' then continue;end if;
  if exists(select 1 from public.icash_access_help_messages where request_id=t.id and role='user' and reply_claimed_at>now()-interval '1 minute' and reply_completed_at is null) then continue;end if;
  insert into public.icash_access_help_messages(request_id,request_key,role,content) values(t.id,gen_random_uuid(),'system',notice);
  update public.icash_access_help_requests set status='closed',updated_at=now() where id=t.id;
  access_count:=access_count+1;
 end loop;
 return jsonb_build_object('accountChats',account_count,'guestChats',access_count);
end $$;
revoke all on function public.icash_close_inactive_support() from public,anon,authenticated;
grant execute on function public.icash_close_inactive_support() to service_role;
commit;
