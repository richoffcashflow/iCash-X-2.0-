begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.icash_assistant_action_settings(id integer primary key check(id=1),enabled boolean not null default false);
insert into public.icash_assistant_action_settings(id) values(1);
create table public.icash_assistant_text_actions(
 question_id uuid not null references public.icash_workspace_questions(id),
 action_index integer not null check(action_index between 0 and 2),
 account_id uuid not null references public.icash_accounts(id),
 message_id uuid not null unique references public.icash_text_messages(id),
 source_message_id uuid references public.icash_text_messages(id),
 created_at timestamptz not null default now(),
 primary key(question_id,action_index)
);
alter table public.icash_assistant_action_settings enable row level security;
alter table public.icash_assistant_text_actions enable row level security;
revoke all on public.icash_assistant_action_settings,public.icash_assistant_text_actions from public,anon,authenticated;
grant select on public.icash_assistant_action_settings to service_role;
grant select,insert on public.icash_assistant_text_actions to service_role;

create function public.icash_queue_assistant_text(p_actor uuid,p_account uuid,p_question uuid,p_index integer,p_key uuid,p_body text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare q public.icash_workspace_questions;a jsonb;t public.icash_text_threads;d public.icash_deal_files;
 prior public.icash_text_messages;source uuid;latest uuid;queued jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor for update;
 if not found then raise exception 'Account owner required';end if;
 if not exists(select 1 from public.icash_assistant_action_settings where id=1 and enabled) then return jsonb_build_object('error','Reply actions are temporarily unavailable. Open the conversation to continue.');end if;
 if p_index is null or p_index not between 0 and 2 or p_key is null or p_body is null or length(trim(p_body)) not between 1 and 160 then raise exception 'Invalid action';end if;
 select * into q from public.icash_workspace_questions where id=p_question and account_id=p_account and state='complete' and archived_at is null for update;
 if not found then raise exception 'Saved reply unavailable';end if;
 a:=q.answer->'actions'->p_index;
 if a->>'kind' is distinct from 'property' or a->'draft'->>'threadId' is null or a->>'threadId' is distinct from a->'draft'->>'threadId' then raise exception 'Saved text action required';end if;
 -- Inbound message FK checks can hold KEY SHARE before their observer takes
 -- the budget lock. Never wait for that thread while owning the budget lock.
 begin
  select * into t from public.icash_text_threads where id=(a->>'threadId')::uuid and account_id=p_account and retired_at is null for update nowait;
 exception when lock_not_available then return jsonb_build_object('error','A new message is arriving. Check the conversation before sending.');end;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and screening_id=(a->>'screeningId')::uuid;
 if t.id is null or d.id is null or coalesce(d.terms->>'practice','false')='true' then raise exception 'Lead conversation unavailable';end if;
 select m.* into prior from public.icash_assistant_text_actions x join public.icash_text_messages m on m.id=x.message_id and m.account_id=x.account_id
 where x.question_id=q.id and x.action_index=p_index and x.account_id=p_account;
 if prior.id is not null then
  if prior.thread_id<>t.id or prior.customer_author_id is distinct from p_actor or prior.body<>p_body then return jsonb_build_object('error','This action already has a saved text. Check its delivery before preparing another reply.');end if;
  return jsonb_build_object('id',prior.id,'threadId',t.id,'manual',true);
 end if;
 if q.completed_at is null or q.completed_at<now()-interval '24 hours' then return jsonb_build_object('error','This suggestion has expired. Ask for a fresh reply using the current conversation.');end if;
 if exists(select 1 from public.icash_text_messages where request_key=p_key) then raise exception 'Message key conflict';end if;
 source:=nullif(a->'draft'->>'latestMessageId','')::uuid;
 select id into latest from public.icash_text_messages where account_id=p_account and thread_id=t.id order by created_at desc,id desc limit 1;
 if latest is distinct from source then return jsonb_build_object('error','The conversation changed. Review the latest messages and ask for a fresh reply.');end if;
 queued:=public.icash_queue_customer_text(p_actor,p_account,t.id,p_key,p_body,'{}'::uuid[]);
 if queued->>'error' is not null or queued->>'id' is null then return queued;end if;
 insert into public.icash_assistant_text_actions(question_id,action_index,account_id,message_id,source_message_id)
 values(q.id,p_index,p_account,(queued->>'id')::uuid,source);
 return queued||jsonb_build_object('threadId',t.id);
end $$;

-- All manual dispatch paths, including deferred recovery, consult the same
-- durable source fence immediately before the existing one-use provider claim.
alter function public.icash_claim_customer_text(uuid,uuid,text) rename to icash_claim_customer_text_before_assistant;
create function public.icash_claim_customer_text(p_account uuid,p_message uuid,p_sender text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a public.icash_assistant_text_actions;m public.icash_text_messages;latest uuid;
begin
 select * into a from public.icash_assistant_text_actions where account_id=p_account and message_id=p_message;
 if a.message_id is not null then
  perform 1 from public.icash_operating_budget where id=1 for update;
  perform 1 from public.icash_accounts where id=p_account for update;
  select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
  begin
   perform 1 from public.icash_text_threads where id=m.thread_id and account_id=p_account for update nowait;
  exception when lock_not_available then return null;end;
  if m.state<>'ready' then return null;end if;
  if not exists(select 1 from public.icash_assistant_action_settings where id=1 and enabled) then return null;end if;
  select id into latest from public.icash_text_messages where account_id=p_account and thread_id=m.thread_id and id<>m.id order by created_at desc,id desc limit 1;
  if latest is distinct from a.source_message_id then
   update public.icash_text_messages set state='cancelled',updated_at=now() where id=m.id and account_id=p_account and state='ready';
   return null;
  end if;
 end if;
 return public.icash_claim_customer_text_before_assistant(p_account,p_message,p_sender);
end $$;
revoke all on function public.icash_queue_assistant_text(uuid,uuid,uuid,integer,uuid,text),public.icash_claim_customer_text(uuid,uuid,text),public.icash_claim_customer_text_before_assistant(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_queue_assistant_text(uuid,uuid,uuid,integer,uuid,text),public.icash_claim_customer_text(uuid,uuid,text),public.icash_claim_customer_text_before_assistant(uuid,uuid,text) to service_role;
commit;
