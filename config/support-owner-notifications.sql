begin;

-- Private owner copies only. Neither customer text nor an inbound From chooses the destination.
create table public.icash_support_owner_copies(
 id uuid primary key default gen_random_uuid(),
 source text not null check(source in ('chat','email')),source_id uuid not null,
 thread_id uuid references public.icash_support_threads(id),
 customer_user_id uuid references auth.users(id),customer_email text,subject text not null check(length(subject) between 1 and 180),
 question text not null check(length(question) between 1 and 6000),reply text check(length(reply)<=6000),
 reply_status text not null check(reply_status in ('saved','accepted','unconfirmed','none')),
 status text not null default 'pending' check(status in ('pending','sending','sent','needs_review')),
 recipient text,owner_user_id uuid references auth.users(id),message jsonb,
 attempts integer not null default 0 check(attempts between 0 and 6),
 claim_token uuid,claimed_at timestamptz,first_attempt_at timestamptz,
 next_attempt_at timestamptz not null default now(),provider_id uuid unique,
 delivery text,delivery_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 unique(source,source_id)
);
create index icash_support_owner_copies_due on public.icash_support_owner_copies(next_attempt_at,created_at) where status in ('pending','sending');
create index icash_support_owner_copies_suppressed on public.icash_support_owner_copies(recipient) where delivery in ('bounced','complained','suppressed');
create index icash_support_owner_copies_thread on public.icash_support_owner_copies(thread_id) where thread_id is not null;
alter table public.icash_support_owner_copies enable row level security;
revoke all on public.icash_support_owner_copies from public,anon,authenticated;
grant select,insert,update on public.icash_support_owner_copies to service_role;

create function public.icash_queue_support_chat_copy(p_account uuid,p_user uuid,p_request uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user) then raise exception 'Account unavailable';end if;
 insert into public.icash_support_owner_copies(source,source_id,thread_id,customer_user_id,subject,question,reply,reply_status)
 select 'chat',answer.id,answer.thread_id,a.owner_user_id,t.subject,question.content,answer.content,'saved'
 from public.icash_support_messages answer
 join public.icash_support_messages question on question.account_id=answer.account_id and question.thread_id=answer.thread_id and question.request_id=answer.request_id and question.role='user'
 join public.icash_support_threads t on t.id=answer.thread_id and t.account_id=answer.account_id
 join public.icash_accounts a on a.id=answer.account_id
 where answer.account_id=p_account and answer.request_id=p_request and answer.role='assistant'
 on conflict(source,source_id) do nothing;
end $$;

-- New wrapper preserves the existing function for previews and older deployments.
-- Reply and notification are committed together; the copy uses the winning saved reply.
create function public.icash_support_finish_and_notify(p_account uuid,p_user uuid,p_thread uuid,p_request uuid,p_message text,p_evidence jsonb)
returns void language plpgsql security invoker set search_path='' as $$
begin
 perform public.icash_support_finish_message(p_account,p_user,p_thread,p_request,p_message,p_evidence);
 perform public.icash_queue_support_chat_copy(p_account,p_user,p_request);
end $$;

create function public.icash_queue_support_email_copy(p_provider uuid,p_sender text,p_subject text,p_question text,p_receipt text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_provider is null or p_sender is null or length(p_sender)>254 or p_sender !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Invalid support email';end if;
 insert into public.icash_support_owner_copies(source,source_id,customer_email,subject,question,reply,reply_status)
 values('email',p_provider,lower(trim(p_sender)),p_subject,p_question,p_receipt,case when p_receipt is null then 'none' else 'unconfirmed' end)
 on conflict(source,source_id) do nothing;
end $$;

create function public.icash_claim_support_owner_copy(p_owner uuid,p_recipient text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_support_owner_copies; mail text; receipt text;
begin
 -- The server verifies this fixed platform owner with the Auth admin API before calling.
 mail:=lower(trim(p_recipient));
 if p_owner is null or mail is null or length(mail)>254 or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Owner email unavailable';end if;
 select * into e from public.icash_support_owner_copies where next_attempt_at<=now()
 and (status='pending' or (status='sending' and claimed_at<now()-interval '2 minutes'))
 order by next_attempt_at,created_at,id for update skip locked limit 1;
 if not found then return null;end if;
 if e.attempts>=6 or e.first_attempt_at<=now()-interval '23 hours'
 or (e.message is not null and (e.recipient is distinct from mail or e.owner_user_id is distinct from p_owner))
 or exists(select 1 from public.icash_email_suppressions where email=mail)
 or exists(select 1 from public.icash_support_owner_copies where recipient=mail and delivery in ('bounced','complained','suppressed')) then
  update public.icash_support_owner_copies set status='needs_review',updated_at=now() where id=e.id;return null;
 end if;
 if e.source='email' and e.reply is not null and e.message is null then
  select receipt_state into receipt from public.icash_support_cancel_requests where provider_email_id=e.source_id;
  -- Let the original bounded receipt finish before describing its outcome.
  if (receipt is null or receipt in ('pending','claimed')) and e.created_at>now()-interval '2 minutes' then
   update public.icash_support_owner_copies set next_attempt_at=now()+interval '30 seconds',updated_at=now() where id=e.id;return null;
  end if;
  update public.icash_support_owner_copies set reply_status=case when receipt='accepted' then 'accepted' when receipt in ('claimed','needs_review') then 'unconfirmed' else 'none' end,
   reply=case when receipt in ('accepted','claimed','needs_review') then reply else null end where id=e.id;
 end if;
 update public.icash_support_owner_copies set status='sending',recipient=mail,owner_user_id=p_owner,claim_token=gen_random_uuid(),claimed_at=now(),attempts=attempts+1,updated_at=now()
 where id=e.id returning * into e;
 return jsonb_build_object('id',e.id,'claimToken',e.claim_token,'recipient',e.recipient,'source',e.source,'sourceId',e.source_id,'threadId',e.thread_id,
 'customerUserId',e.customer_user_id,'customerEmail',e.customer_email,'subject',e.subject,'question',e.question,'reply',e.reply,'replyStatus',e.reply_status,'createdAt',e.created_at,'message',e.message);
end $$;

create function public.icash_authorize_support_owner_copy(p_id uuid,p_claim uuid,p_message jsonb) returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_support_owner_copies;
begin
 select * into e from public.icash_support_owner_copies where id=p_id for update;
 if not found or e.status<>'sending' or e.claim_token is distinct from p_claim or e.claimed_at<now()-interval '90 seconds' then return null;end if;
 if e.first_attempt_at<=now()-interval '23 hours'
 or exists(select 1 from public.icash_email_suppressions where email=e.recipient)
 or exists(select 1 from public.icash_support_owner_copies where recipient=e.recipient and delivery in ('bounced','complained','suppressed')) then
  update public.icash_support_owner_copies set status='needs_review',updated_at=now() where id=e.id;return null;
 end if;
 if e.message is null then
  if jsonb_typeof(p_message) is distinct from 'object' or p_message->'to' is distinct from jsonb_build_array(e.recipient)
  or p_message ? 'cc' or p_message ? 'bcc' or p_message ? 'reply_to' or length(p_message::text)>100000 then raise exception 'Invalid owner copy';end if;
  update public.icash_support_owner_copies set message=p_message where id=e.id;
 end if;
 update public.icash_support_owner_copies set first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now() where id=e.id returning * into e;
 return e.message;
end $$;

create function public.icash_finish_support_owner_copy(p_id uuid,p_claim uuid,p_provider uuid,p_retry boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare e public.icash_support_owner_copies;
begin
 select * into e from public.icash_support_owner_copies where id=p_id for update;
 if not found or e.status<>'sending' or e.claim_token is distinct from p_claim then return;end if;
 update public.icash_support_owner_copies set status=case when p_provider is not null then 'sent' when p_retry and e.attempts<6 and (e.first_attempt_at is null or e.first_attempt_at>now()-interval '23 hours') then 'pending' else 'needs_review' end,
 provider_id=coalesce(p_provider,provider_id),next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,e.attempts-1)::integer)),updated_at=now() where id=e.id;
end $$;

create function public.icash_support_owner_copy_delivery(p_id uuid,p_provider uuid,p_recipient text,p_kind text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_kind not in ('delivered','bounced','complained','delivery_delayed','failed','suppressed') then return;end if;
 update public.icash_support_owner_copies set provider_id=p_provider,status='sent',
 delivery=case when delivery in ('bounced','complained','failed','suppressed') then delivery else p_kind end,delivery_at=now(),updated_at=now()
 where recipient=lower(trim(p_recipient)) and (provider_id=p_provider or (id=p_id and provider_id is null and first_attempt_at is not null));
end $$;

revoke all on function public.icash_queue_support_chat_copy(uuid,uuid,uuid),public.icash_support_finish_and_notify(uuid,uuid,uuid,uuid,text,jsonb),public.icash_queue_support_email_copy(uuid,text,text,text,text),public.icash_claim_support_owner_copy(uuid,text),public.icash_authorize_support_owner_copy(uuid,uuid,jsonb),public.icash_finish_support_owner_copy(uuid,uuid,uuid,boolean),public.icash_support_owner_copy_delivery(uuid,uuid,text,text) from public,anon,authenticated;
grant execute on function public.icash_queue_support_chat_copy(uuid,uuid,uuid),public.icash_support_finish_and_notify(uuid,uuid,uuid,uuid,text,jsonb),public.icash_queue_support_email_copy(uuid,text,text,text,text),public.icash_claim_support_owner_copy(uuid,text),public.icash_authorize_support_owner_copy(uuid,uuid,jsonb),public.icash_finish_support_owner_copy(uuid,uuid,uuid,boolean),public.icash_support_owner_copy_delivery(uuid,uuid,text,text) to service_role;
commit;
