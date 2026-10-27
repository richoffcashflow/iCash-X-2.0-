-- Presentation only. Reading messages never changes automation, contact rules or provider receipts.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
create table public.icash_text_message_reads (
 account_id uuid not null references public.icash_accounts(id),
 message_id uuid not null references public.icash_text_messages(id),
 reader_user_id uuid not null,
 read_at timestamptz not null default now(),
 primary key(account_id,message_id)
);
alter table public.icash_text_message_reads enable row level security;
revoke all on public.icash_text_message_reads from public,anon,authenticated;
grant select,insert on public.icash_text_message_reads to service_role;
create index icash_text_message_reads_message on public.icash_text_message_reads(message_id);
create index icash_text_received_reply_cursor on public.icash_text_messages(account_id,thread_id,created_at desc,id desc) where direction='incoming' and state='received';

create function public.icash_mark_text_messages_read(p_account uuid,p_user uuid,p_thread uuid,p_messages uuid[]) returns boolean
language plpgsql security invoker set search_path='' as $$
declare changed integer;
begin
 if cardinality(p_messages) not between 1 and 20 or p_messages is null
  or not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_user)
  or exists(select 1 from unnest(p_messages) requested(id) where not exists(
   select 1 from public.icash_text_messages m join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
   where m.id=requested.id and m.account_id=p_account and m.thread_id=p_thread and m.direction='incoming' and m.state='received' and t.retired_at is null))
 then raise exception 'Invalid message read';end if;
 insert into public.icash_text_message_reads(account_id,message_id,reader_user_id)
 select p_account,id,p_user from unnest(p_messages) requested(id) on conflict do nothing;
 get diagnostics changed=row_count;
 if changed>0 then
  insert into public.icash_workspace_revisions(account_id) values(p_account)
  on conflict(account_id) do update set revision=public.icash_workspace_revisions.revision+1,changed_at=now();
 end if;
 return true;
end $$;

create function public.icash_text_thread_reply_summaries(p_account uuid,p_threads uuid[])
returns table(thread_id uuid,message_id uuid,preview text,received_at timestamptz,unread_count bigint)
language sql stable security invoker set search_path='' as $$
 select t.id,last.id,left(last.body,240),last.created_at,
 (select count(*) from public.icash_text_messages m where m.account_id=p_account and m.thread_id=t.id and m.direction='incoming' and m.state='received'
  and not exists(select 1 from public.icash_text_message_reads r where r.account_id=m.account_id and r.message_id=m.id))
 from public.icash_text_threads t
 join lateral (select m.id,m.body,m.created_at from public.icash_text_messages m where m.account_id=p_account and m.thread_id=t.id
  and m.direction='incoming' and m.state='received' order by m.created_at desc,m.id desc limit 1) last on true
 where t.account_id=p_account and t.retired_at is null and t.id=any(p_threads) and cardinality(p_threads)<=100;
$$;

create function public.icash_latest_seller_text_thread(p_account uuid,p_deal uuid) returns uuid
language sql stable security invoker set search_path='' as $$
 select t.id from public.icash_text_threads t
 left join lateral(select m.created_at,m.id,(r.message_id is null) unread from public.icash_text_messages m
  left join public.icash_text_message_reads r on r.account_id=m.account_id and r.message_id=m.id
  where m.account_id=p_account and m.thread_id=t.id and m.direction='incoming' and m.state='received'
  order by (r.message_id is null) desc,m.created_at desc,m.id desc limit 1) last on true
 where t.account_id=p_account and t.deal_id=p_deal and t.party='seller' and t.retired_at is null
 order by last.unread desc nulls last,last.created_at desc nulls last,last.id desc nulls last,t.id desc limit 1;
$$;

create function public.icash_workspace_seller_texts(p_account uuid,p_screenings uuid[] default null)
returns table(screening_id uuid,thread_id uuid,message_id uuid,preview text,received_at timestamptz,unread_count bigint)
language sql stable security invoker set search_path='' as $$
 with replies as (
  select d.screening_id,t.id thread_id,m.id message_id,m.body,m.created_at,
   case when r.message_id is null then 1 else 0 end unread
  from public.icash_text_threads t
  join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
  join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id and m.direction='incoming' and m.state='received'
  left join public.icash_text_message_reads r on r.account_id=m.account_id and r.message_id=m.id
  where t.account_id=p_account and t.party='seller' and t.retired_at is null
   and s.state in ('complete','awaiting_address') and coalesce(s.snapshot->>'practice','false')<>'true'
   and coalesce(s.result->'property'->>'propertyId','') not like 'practice_%' and coalesce(d.terms->>'practice','false')<>'true'
   and (p_screenings is null or cardinality(p_screenings)<=100 and s.id=any(p_screenings))
 ), ranked as (
  select *,sum(unread) over(partition by screening_id) unread_count,
   row_number() over(partition by screening_id order by unread desc,created_at desc,message_id desc) position from replies
 ) select screening_id,thread_id,message_id,left(body,240),created_at,unread_count from ranked where position=1;
$$;

create function public.icash_workspace_text_reply_counts(p_account uuid) returns jsonb
language sql stable security invoker set search_path='' as $$
 select jsonb_build_object('properties',count(*),'unreadProperties',count(*) filter(where unread_count>0),'unreadMessages',coalesce(sum(unread_count),0))
 from public.icash_workspace_seller_texts(p_account,null);
$$;

create function public.icash_workspace_text_reply_ids(p_account uuid,p_query text default '',p_offset integer default 0,p_limit integer default 7,p_unread_only boolean default false)
returns table(screening_id uuid,state text)
language sql stable security invoker set search_path='' as $$
 select s.id,s.state from public.icash_workspace_seller_texts(p_account,null) r
 join public.icash_screening_jobs s on s.account_id=p_account and s.id=r.screening_id
 where (not p_unread_only or r.unread_count>0) and (p_query='' or position(lower(p_query) in lower(coalesce(s.result->'property'->>'address','')))>0)
 order by (r.unread_count>0) desc,r.received_at desc,r.message_id desc,s.id desc
 limit greatest(1,least(25,p_limit)) offset greatest(0,least(60000,p_offset));
$$;

-- Preserve the existing financial/scope predicates and add unread-first ordering
-- before pagination. Actual incoming texts do not depend on the outcome refresh job.
do $$ declare signature text;definition text;needle text;begin
 foreach signature in array array['public.icash_workspace_opportunities(uuid,text,integer,integer,boolean)','public.icash_workspace_ready_opportunities(uuid,text,integer,integer)','public.icash_workspace_response_counts(uuid)'] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id';
  if position(needle in definition)=0 or (signature<>'public.icash_workspace_response_counts(uuid)' and position('order by coalesce(o.purchase_signed,false) desc' in definition)=0) then raise exception 'Workspace predicate changed';end if;
  definition:=replace(definition,needle,needle||E'\n left join public.icash_workspace_seller_texts(p_account,null) reply on reply.screening_id=s.id');
  definition:=replace(definition,'coalesce(o.responded,false)','(coalesce(o.responded,false) or reply.message_id is not null)');
  definition:=replace(definition,'order by coalesce(o.purchase_signed,false) desc','order by (coalesce(reply.unread_count,0)>0) desc,coalesce(o.purchase_signed,false) desc');
  definition:=replace(definition,'o.response_at desc nulls last','greatest(o.response_at,reply.received_at) desc nulls last');
  execute definition;
 end loop;
end $$;

revoke all on function public.icash_mark_text_messages_read(uuid,uuid,uuid,uuid[]),public.icash_text_thread_reply_summaries(uuid,uuid[]),public.icash_latest_seller_text_thread(uuid,uuid),public.icash_workspace_seller_texts(uuid,uuid[]),public.icash_workspace_text_reply_counts(uuid),public.icash_workspace_text_reply_ids(uuid,text,integer,integer,boolean) from public,anon,authenticated;
grant execute on function public.icash_mark_text_messages_read(uuid,uuid,uuid,uuid[]),public.icash_text_thread_reply_summaries(uuid,uuid[]),public.icash_latest_seller_text_thread(uuid,uuid),public.icash_workspace_seller_texts(uuid,uuid[]),public.icash_workspace_text_reply_counts(uuid),public.icash_workspace_text_reply_ids(uuid,text,integer,integer,boolean) to service_role;
commit;
