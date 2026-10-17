begin;

-- Reply receipts and notification jobs commit together. These are support-only
-- capabilities: no account authentication, purchase lookup, or billing authority.
create table public.icash_support_customer_emails(
 id uuid primary key default gen_random_uuid(),source text not null check(source in ('access_help','chat')),source_id uuid not null,
 access_request_id uuid references public.icash_access_help_requests(id),
 thread_id uuid references public.icash_support_threads(id),account_id uuid references public.icash_accounts(id),customer_user_id uuid references auth.users(id),
 recipient text check(recipient is null or (length(recipient)<=254 and recipient ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$')),
 status text not null default 'pending' check(status in ('pending','sending','sent','needs_review')),
 message jsonb,link_hash text unique check(link_hash is null or link_hash ~ '^[a-f0-9]{64}$'),link_expires_at timestamptz,
 attempts integer not null default 0 check(attempts between 0 and 6),claim_token uuid,claimed_at timestamptz,first_attempt_at timestamptz,
 next_attempt_at timestamptz not null default now(),provider_id uuid unique,delivery text,delivery_at timestamptz,
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),unique(source,source_id),
 check((source='access_help' and access_request_id is not null and recipient is not null and thread_id is null and account_id is null and customer_user_id is null)
 or (source='chat' and access_request_id is null and thread_id is not null and account_id is not null and customer_user_id is not null and link_hash is null))
);
create index icash_support_customer_email_due on public.icash_support_customer_emails(next_attempt_at,created_at) where status in ('pending','sending');
create index icash_support_customer_email_recipient on public.icash_support_customer_emails(recipient,first_attempt_at);
create index icash_support_customer_email_access on public.icash_support_customer_emails(access_request_id,created_at desc);
create index icash_support_customer_email_thread on public.icash_support_customer_emails(thread_id,created_at desc);
create table public.icash_access_help_sessions(
 session_hash text primary key check(session_hash ~ '^[a-f0-9]{64}$'),request_id uuid not null references public.icash_access_help_requests(id),
 expires_at timestamptz not null default now()+interval '7 days',created_at timestamptz not null default now()
);
create index icash_access_help_sessions_request on public.icash_access_help_sessions(request_id);
alter table public.icash_support_customer_emails enable row level security;
alter table public.icash_access_help_sessions enable row level security;
revoke all on public.icash_support_customer_emails,public.icash_access_help_sessions from public,anon,authenticated;
grant select,insert,update on public.icash_support_customer_emails,public.icash_access_help_sessions to service_role;

create function public.icash_queue_customer_support_reply() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.role not in ('assistant','operator') then return new;end if;
 if tg_table_name='icash_access_help_messages' then
  insert into public.icash_support_customer_emails(source,source_id,access_request_id,recipient)
  select 'access_help',new.id,r.id,r.email from public.icash_access_help_requests r where r.id=new.request_id
  on conflict(source,source_id) do nothing;
 else
  insert into public.icash_support_customer_emails(source,source_id,thread_id,account_id,customer_user_id)
  select 'chat',new.id,t.id,t.account_id,a.owner_user_id from public.icash_support_threads t join public.icash_accounts a on a.id=t.account_id
  where t.id=new.thread_id and t.account_id=new.account_id on conflict(source,source_id) do nothing;
 end if;
 return new;
end $$;
create trigger icash_access_customer_reply after insert on public.icash_access_help_messages for each row execute function public.icash_queue_customer_support_reply();
create trigger icash_account_customer_reply after insert on public.icash_support_messages for each row execute function public.icash_queue_customer_support_reply();

create function public.icash_claim_support_customer_email() returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_support_customer_emails; i integer;
begin
 for i in 1..10 loop
  select * into e from public.icash_support_customer_emails where next_attempt_at<=now()
  and (status='pending' or (status='sending' and claimed_at<now()-interval '2 minutes'))
  order by next_attempt_at,created_at,id for update skip locked limit 1;
  if not found then return null;end if;
  if e.attempts>=6 or e.first_attempt_at<=now()-interval '23 hours'
  or (e.source='chat' and not exists(select 1 from public.icash_accounts where id=e.account_id and owner_user_id=e.customer_user_id))
  or exists(select 1 from public.icash_email_suppressions where email=e.recipient)
  or exists(select 1 from public.icash_support_customer_emails where recipient=e.recipient and delivery in ('bounced','complained','suppressed')) then
   update public.icash_support_customer_emails set status='needs_review',message=null,updated_at=now() where id=e.id;continue;
  end if;
  update public.icash_support_customer_emails set status='sending',claim_token=gen_random_uuid(),claimed_at=now(),attempts=attempts+1,updated_at=now()
  where id=e.id returning * into e;
  return jsonb_build_object('id',e.id,'claimToken',e.claim_token,'source',e.source,'recipient',e.recipient,
   'accessRequestId',e.access_request_id,'threadId',e.thread_id,'customerUserId',e.customer_user_id,'message',e.message);
 end loop;
 return null;
end $$;

create function public.icash_authorize_support_customer_email(p_id uuid,p_claim uuid,p_recipient text,p_message jsonb,p_link_hash text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare e public.icash_support_customer_emails; mail text:=lower(trim(p_recipient));
begin
 select * into e from public.icash_support_customer_emails where id=p_id for update;
 if not found or e.status<>'sending' or e.claim_token is distinct from p_claim or e.claimed_at<now()-interval '90 seconds' then return null;end if;
 if mail is null or length(mail)>254 or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Recipient unavailable';end if;
 perform pg_advisory_xact_lock(825,hashtext(mail));
 if e.first_attempt_at<=now()-interval '23 hours' or (e.recipient is not null and e.recipient<>mail)
 or (e.source='access_help' and not exists(select 1 from public.icash_access_help_requests where id=e.access_request_id and email=mail))
 or (e.source='chat' and not exists(select 1 from public.icash_accounts where id=e.account_id and owner_user_id=e.customer_user_id))
 or exists(select 1 from public.icash_email_suppressions where email=mail)
 or exists(select 1 from public.icash_support_customer_emails where recipient=mail and delivery in ('bounced','complained','suppressed'))
 or (e.first_attempt_at is null and (select count(*) from public.icash_support_customer_emails where recipient=mail and first_attempt_at>now()-interval '1 day')>=case when e.source='access_help' then 30 else 90 end) then
  update public.icash_support_customer_emails set status='needs_review',message=null,updated_at=now() where id=e.id;return null;
 end if;
 if e.message is null then
  if jsonb_typeof(p_message) is distinct from 'object' or p_message->'to' is distinct from jsonb_build_array(mail)
  or p_message ? 'cc' or p_message ? 'bcc' or p_message ? 'attachments' or length(p_message::text)>30000
  or (e.source='access_help' and (p_link_hash is null or p_link_hash !~ '^[a-f0-9]{64}$'))
  or (e.source='chat' and p_link_hash is not null) then raise exception 'Invalid customer notification';end if;
  update public.icash_support_customer_emails set recipient=mail,message=p_message,link_hash=p_link_hash,
   link_expires_at=case when source='access_help' then now()+interval '30 days' end where id=e.id;
 end if;
 update public.icash_support_customer_emails set first_attempt_at=coalesce(first_attempt_at,now()),updated_at=now() where id=e.id returning * into e;
 return e.message;
end $$;

create function public.icash_finish_support_customer_email(p_id uuid,p_claim uuid,p_provider uuid,p_retry boolean default false)
returns void language plpgsql security invoker set search_path='' as $$
declare e public.icash_support_customer_emails; retry boolean;
begin
 select * into e from public.icash_support_customer_emails where id=p_id for update;
 if not found or e.status<>'sending' or e.claim_token is distinct from p_claim then return;end if;
 retry:=p_retry and e.attempts<6 and (e.first_attempt_at is null or e.first_attempt_at>now()-interval '23 hours');
 update public.icash_support_customer_emails set status=case when p_provider is not null then 'sent' when retry then 'pending' else 'needs_review' end,
 provider_id=coalesce(p_provider,provider_id),message=case when p_provider is null and retry then message end,
 next_attempt_at=now()+make_interval(secs=>least(3600,60*power(2,e.attempts-1)::integer)),updated_at=now() where id=e.id;
end $$;

create function public.icash_support_customer_email_delivery(p_id uuid,p_provider uuid,p_recipient text,p_kind text)
returns void language plpgsql security invoker set search_path='' as $$
begin
 if p_kind not in ('delivered','bounced','complained','delivery_delayed','failed','suppressed') then return;end if;
 update public.icash_support_customer_emails set provider_id=p_provider,status='sent',message=null,
 delivery=case when delivery in ('bounced','complained','failed','suppressed') or (delivery='delivered' and p_kind='delivery_delayed') then delivery else p_kind end,delivery_at=now(),updated_at=now()
 where recipient=lower(trim(p_recipient)) and (provider_id=p_provider or (id=p_id and provider_id is null and first_attempt_at is not null));
end $$;

create function public.icash_access_help_return(p_link_hash text,p_session_hash text) returns boolean language plpgsql security invoker set search_path='' as $$
declare e public.icash_support_customer_emails;
begin
 if p_link_hash is null or p_link_hash !~ '^[a-f0-9]{64}$' or p_session_hash is null or p_session_hash !~ '^[a-f0-9]{64}$' then return false;end if;
 select * into e from public.icash_support_customer_emails where source='access_help' and link_hash=p_link_hash and link_expires_at>now() and first_attempt_at is not null for update;
 if not found then return false;end if;
 if exists(select 1 from public.icash_access_help_requests where session_hash=p_session_hash)
 or exists(select 1 from public.icash_access_help_sessions where session_hash=p_session_hash and request_id<>e.access_request_id) then return false;end if;
 insert into public.icash_access_help_sessions(session_hash,request_id) values(p_session_hash,e.access_request_id)
 on conflict(session_hash) do update set expires_at=now()+interval '7 days';
 update public.icash_access_help_requests set expires_at=greatest(expires_at,now()+interval '7 days') where id=e.access_request_id;
 return true;
end $$;

-- Keep the existing browser proof valid when another device opens the email.
-- Reusable, expiring email links are not consumed by mail scanners.
alter function public.icash_access_help_read(text) rename to icash_access_help_read_browser;
alter function public.icash_access_help_submit(text,uuid,text,text,text) rename to icash_access_help_submit_browser;
create function public.icash_access_help_read(p_hash text) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare s public.icash_access_help_sessions; canonical text:=p_hash; result jsonb;
begin
 select * into s from public.icash_access_help_sessions where session_hash=p_hash;
 if found then
  if s.expires_at<=now() then return jsonb_build_object('expired',true);end if;
  select session_hash into canonical from public.icash_access_help_requests where id=s.request_id;
 end if;
 result:=public.icash_access_help_read_browser(canonical);
 if result->>'id' is not null then
  result:=result||jsonb_build_object('notification',(select jsonb_build_object('status',status,'delivery',delivery) from public.icash_support_customer_emails where access_request_id=(result->>'id')::uuid order by created_at desc,id desc limit 1));
 end if;
 return result;
end $$;
create function public.icash_access_help_submit(p_hash text,p_key uuid,p_email text,p_phone text,p_message text) returns uuid language plpgsql security invoker set search_path='' as $$
declare s public.icash_access_help_sessions; canonical text:=p_hash; case_id uuid;
begin
 select * into s from public.icash_access_help_sessions where session_hash=p_hash;
 if found then
  if s.expires_at<=now() then raise exception 'Access session expired';end if;
  select session_hash into canonical from public.icash_access_help_requests where id=s.request_id;
 end if;
 case_id:=public.icash_access_help_submit_browser(canonical,p_key,p_email,p_phone,p_message);
 if s.request_id is not null then update public.icash_access_help_sessions set expires_at=now()+interval '7 days' where session_hash=p_hash;end if;
 return case_id;
end $$;

-- One notification for the latest reply in a currently waiting, recent guest
-- conversation. Do not mail old histories or resolved cases during rollout.
insert into public.icash_support_customer_emails(source,source_id,access_request_id,recipient)
select 'access_help',m.id,r.id,r.email from public.icash_access_help_requests r
cross join lateral(select id,role from public.icash_access_help_messages where request_id=r.id order by created_at desc,id desc limit 1) m
where r.status='waiting_on_customer' and r.updated_at>now()-interval '1 day' and m.role in ('assistant','operator')
order by r.updated_at desc limit 50 on conflict(source,source_id) do nothing;

revoke all on function public.icash_queue_customer_support_reply(),public.icash_claim_support_customer_email(),public.icash_authorize_support_customer_email(uuid,uuid,text,jsonb,text),public.icash_finish_support_customer_email(uuid,uuid,uuid,boolean),public.icash_support_customer_email_delivery(uuid,uuid,text,text),public.icash_access_help_return(text,text),public.icash_access_help_read(text),public.icash_access_help_submit(text,uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.icash_queue_customer_support_reply(),public.icash_claim_support_customer_email(),public.icash_authorize_support_customer_email(uuid,uuid,text,jsonb,text),public.icash_finish_support_customer_email(uuid,uuid,uuid,boolean),public.icash_support_customer_email_delivery(uuid,uuid,text,text),public.icash_access_help_return(text,text),public.icash_access_help_read(text),public.icash_access_help_submit(text,uuid,text,text,text) to service_role;
commit;
