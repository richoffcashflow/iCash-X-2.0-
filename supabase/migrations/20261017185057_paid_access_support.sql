begin;

-- A browser can ask for help without proving payment or email ownership. This
-- conversation never grants an account, discloses a purchase, or changes billing.
create table public.icash_access_help_requests(
 id uuid primary key default gen_random_uuid(),session_hash text not null unique check(session_hash ~ '^[a-f0-9]{64}$'),
 email text not null check(length(email)<=254 and email ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'),
 phone text check(phone is null or phone ~ '^\+[1-9][0-9]{7,14}$'),
 status text not null default 'open' check(status in ('open','waiting_on_customer','resolved')),
 created_at timestamptz not null default now(),updated_at timestamptz not null default now(),
 expires_at timestamptz not null default now()+interval '7 days'
);
create index icash_access_help_queue on public.icash_access_help_requests(updated_at) where status<>'resolved';
create index icash_access_help_email on public.icash_access_help_requests(email,created_at);
create table public.icash_access_help_messages(
 id uuid primary key default gen_random_uuid(),request_id uuid not null references public.icash_access_help_requests(id),
 request_key uuid not null,role text not null check(role in ('user','operator')),
 content text not null check(length(content) between 1 and 3000),operator_id uuid references auth.users(id),
 created_at timestamptz not null default now(),unique(request_id,request_key)
);
create table public.icash_access_help_updates(
 request_key uuid primary key,request_id uuid not null references public.icash_access_help_requests(id),
 operator_id uuid not null references auth.users(id),status text not null,reply text,created_at timestamptz not null default now()
);
create table public.icash_purchase_access_notices(
 membership_id uuid primary key references public.icash_memberships(id),batch_id uuid not null,created_at timestamptz not null default now()
);
alter table public.icash_access_help_requests enable row level security;
alter table public.icash_access_help_messages enable row level security;
alter table public.icash_access_help_updates enable row level security;
alter table public.icash_purchase_access_notices enable row level security;
revoke all on public.icash_access_help_requests,public.icash_access_help_messages,public.icash_access_help_updates,public.icash_purchase_access_notices from public,anon,authenticated;
grant select,insert,update on public.icash_access_help_requests,public.icash_access_help_messages,public.icash_access_help_updates,public.icash_purchase_access_notices to service_role;
alter table public.icash_support_owner_copies drop constraint icash_support_owner_copies_source_check;
alter table public.icash_support_owner_copies add constraint icash_support_owner_copies_source_check check(source in ('chat','email','access_help','purchase_access'));

create function public.icash_access_help_read(p_hash text) returns jsonb language sql stable security invoker set search_path='' as $$
 select case when r.expires_at<=now() then jsonb_build_object('expired',true) else jsonb_build_object('id',r.id,'email',r.email,'phone',r.phone,'status',r.status,
 'messages',coalesce((select jsonb_agg(jsonb_build_object('id',m.id,'requestId',m.request_key,'role',m.role,'content',m.content,'createdAt',m.created_at) order by m.created_at,m.id)
 from (select * from public.icash_access_help_messages where request_id=r.id order by created_at desc,id desc limit 60) m),'[]'::jsonb)) end
 from public.icash_access_help_requests r where session_hash=p_hash;
$$;

create function public.icash_access_help_submit(p_hash text,p_key uuid,p_email text,p_phone text,p_message text) returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.icash_access_help_requests; prior public.icash_access_help_messages; message_id uuid; mail text:=lower(trim(p_email));
begin
 if p_hash is null or p_hash !~ '^[a-f0-9]{64}$' or p_key is null or mail is null or length(mail)>254
 or mail !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
 or (p_phone is not null and p_phone !~ '^\+[1-9][0-9]{7,14}$')
 or p_message is null or length(trim(p_message)) not between 1 and 2000 then raise exception 'Invalid access request';end if;
 perform pg_advisory_xact_lock(824,hashtext(mail));
 select * into r from public.icash_access_help_requests where session_hash=p_hash for update;
 if found then
  if r.expires_at<=now() or r.email<>mail or r.phone is distinct from p_phone then raise exception 'Access request changed';end if;
  select * into prior from public.icash_access_help_messages where request_id=r.id and request_key=p_key;
  if found then
   if prior.role<>'user' or prior.content<>p_message then raise exception 'Request key reused';end if;
   return r.id;
  end if;
  if (select count(*) from public.icash_access_help_messages where request_id=r.id and role='user' and created_at>now()-interval '1 day')>=10 then raise exception 'Access help limit';end if;
 else
  if (select count(*) from public.icash_access_help_requests where email=mail and created_at>now()-interval '1 day')>=3 then raise exception 'Access help limit';end if;
  insert into public.icash_access_help_requests(session_hash,email,phone) values(p_hash,mail,p_phone) returning * into r;
 end if;
 insert into public.icash_access_help_messages(request_id,request_key,role,content) values(r.id,p_key,'user',p_message) returning id into message_id;
 update public.icash_access_help_requests set status='open',updated_at=now(),expires_at=now()+interval '7 days' where id=r.id;
 insert into public.icash_support_owner_copies(source,source_id,customer_email,subject,question,reply,reply_status)
 values('access_help',message_id,mail,'Buyer needs help getting into their account',p_message,
 'Your request is saved. Keep this page to read the team’s reply in this browser. You do not need to pay again.','saved');
 return r.id;
end $$;

create function public.icash_access_help_operator_update(p_operator uuid,p_id uuid,p_key uuid,p_status text,p_reply text) returns void
language plpgsql security invoker set search_path='' as $$
declare old public.icash_access_help_updates;
begin
 if not exists(select 1 from public.icash_trusted_operators where user_id=p_operator and revoked_at is null and expires_at>now() and scopes @> array['support']::text[]) then raise exception 'Operator required';end if;
 if p_key is null or p_status not in ('open','waiting_on_customer','resolved') or (p_reply is not null and length(trim(p_reply)) not between 1 and 3000) then raise exception 'Invalid support update';end if;
 perform 1 from public.icash_access_help_requests where id=p_id for update;if not found then raise exception 'Request unavailable';end if;
 select * into old from public.icash_access_help_updates where request_key=p_key;
 if found then
  if old.request_id<>p_id or old.operator_id<>p_operator or old.status<>p_status or old.reply is distinct from p_reply then raise exception 'Request key reused';end if;
  return;
 end if;
 insert into public.icash_access_help_updates values(p_key,p_id,p_operator,p_status,p_reply,now());
 if p_reply is not null then insert into public.icash_access_help_messages(request_id,request_key,role,content,operator_id) values(p_id,p_key,'operator',p_reply,p_operator);end if;
 update public.icash_access_help_requests set status=p_status,updated_at=now(),expires_at=greatest(expires_at,now()+interval '7 days') where id=p_id;
end $$;

-- Live, positive settled payments only. Unclaimed means no linked account; it
-- does not assert that a message was read or that the buyer attempted sign-in.
create view public.icash_purchase_access_attention with(security_invoker=true) as
with purchases as (
 select m.id,m.payer_email as email,m.created_at,min(i.recorded_at) as paid_at,
 e.status as email_status,e.delivery as email_delivery,
 (select f.status from public.icash_purchase_access_followups f where f.membership_id=m.id and f.channel='sms') as text_status,
 (select f.delivery from public.icash_purchase_access_followups f where f.membership_id=m.id and f.channel='sms') as text_delivery,
 (e.status in ('failed','needs_review','canceled') or e.delivery in ('bounced','complained','failed','suppressed') or exists(
  select 1 from public.icash_purchase_access_followups f where f.membership_id=m.id and (f.status in ('failed','needs_review','unknown') or f.delivery in ('bounced','complained','failed','suppressed','undelivered')))) as delivery_problem
 from public.icash_memberships m join public.icash_membership_invoices i on i.membership_id=m.id and i.amount_cents>0
 left join public.icash_purchase_access_emails e on e.membership_id=m.id
 where m.mode='live' and m.state='active' and m.paid_through>now() and m.account_id is null and m.created_at>now()-interval '30 days'
 group by m.id,m.payer_email,m.created_at,e.status,e.delivery
)
select *,case when delivery_problem then 'delivery_problem' when email_status is distinct from 'sent' and paid_at<now()-interval '5 minutes' then 'delivery_pending' else 'unclaimed' end as reason
from purchases where delivery_problem or (email_status is distinct from 'sent' and paid_at<now()-interval '5 minutes') or paid_at<now()-interval '20 minutes';
revoke all on public.icash_purchase_access_attention from public,anon,authenticated;
grant select on public.icash_purchase_access_attention to service_role;

create function public.icash_queue_purchase_access_attention() returns integer language plpgsql security invoker set search_path='' as $$
declare batch uuid:=gen_random_uuid(); amount integer;
begin
 perform pg_advisory_xact_lock(824,2);
 -- One owner digest at most every 15 minutes; each purchase is flagged once.
 if exists(select 1 from public.icash_purchase_access_notices where created_at>now()-interval '15 minutes') then return 0;end if;
 insert into public.icash_purchase_access_notices(membership_id,batch_id)
 select a.id,batch from public.icash_purchase_access_attention a where not exists(select 1 from public.icash_purchase_access_notices n where n.membership_id=a.id)
 order by a.paid_at limit 50 on conflict do nothing;
 get diagnostics amount=row_count;
 if amount>0 then
  insert into public.icash_support_owner_copies(source,source_id,subject,question,reply_status)
  values('purchase_access',batch,'Check paid buyer access',amount||' paid purchase(s) were flagged for access follow-up. The support desk shows current delivery status and whether an account has been linked. A sent or delivered message is not proof that a buyer got into the account. Review current status before contacting anyone.','none');
 end if;
 return amount;
end $$;

revoke all on function public.icash_access_help_read(text),public.icash_access_help_submit(text,uuid,text,text,text),public.icash_access_help_operator_update(uuid,uuid,uuid,text,text),public.icash_queue_purchase_access_attention() from public,anon,authenticated;
grant execute on function public.icash_access_help_read(text),public.icash_access_help_submit(text,uuid,text,text,text),public.icash_access_help_operator_update(uuid,uuid,uuid,text,text),public.icash_queue_purchase_access_attention() to service_role;
commit;
