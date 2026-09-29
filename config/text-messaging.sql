create table public.icash_text_senders(phone text primary key check(phone ~ '^\+[1-9][0-9]{7,14}$'),enabled boolean not null default false);
insert into public.icash_text_senders(phone,enabled) values('+14243948384',true);
create table public.icash_text_threads(
 id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),
 sender text not null references public.icash_text_senders(phone),recipient text not null check(recipient ~ '^\+[1-9][0-9]{7,14}$'),
 permission_until timestamptz,permission_evidence text,timezone text not null default 'America/Chicago',dnc_checked_at timestamptz,dnc_clear boolean not null default false,
 sms_rate_id uuid references public.icash_operation_rates(id),mms_rate_id uuid references public.icash_operation_rates(id),
 paused boolean not null default true,unique(sender,recipient)
);
create table public.icash_text_suppressions(phone text primary key,reason text not null,created_at timestamptz not null default now());
create table public.icash_text_assets(id uuid primary key default gen_random_uuid(),account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),url text not null,bytes integer not null check(bytes>0 and bytes<=5000000),verified_until timestamptz not null);
create table public.icash_text_messages(
 id uuid primary key default gen_random_uuid(),thread_id uuid references public.icash_text_threads(id),account_id uuid references public.icash_accounts(id),
 direction text not null check(direction in ('incoming','outgoing')),body text not null default '',attachments jsonb not null default '[]',asset_ids uuid[] not null default '{}',
 state text not null check(state in ('ready','dispatching','accepted','delivered','needs_review','received','cancelled')),
 request_key uuid unique,event_id text unique,provider_id text unique,last_delivery_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create table public.icash_text_events(id text primary key,type text not null,payload jsonb not null,received_at timestamptz not null default now());
create index icash_text_messages_thread on public.icash_text_messages(account_id,thread_id,created_at desc);
create index icash_text_threads_deal on public.icash_text_threads(account_id,deal_id);
alter table public.icash_text_senders enable row level security;
alter table public.icash_text_threads enable row level security;
alter table public.icash_text_suppressions enable row level security;
alter table public.icash_text_assets enable row level security;
alter table public.icash_text_messages enable row level security;
alter table public.icash_text_events enable row level security;
revoke all on public.icash_text_senders,public.icash_text_threads,public.icash_text_suppressions,public.icash_text_assets,public.icash_text_messages,public.icash_text_events from public,anon,authenticated;
grant all on public.icash_text_senders,public.icash_text_threads,public.icash_text_suppressions,public.icash_text_assets,public.icash_text_messages,public.icash_text_events to service_role;
create function public.icash_queue_text(p_account uuid,p_thread uuid,p_key uuid,p_body text,p_assets uuid[]) returns uuid language plpgsql set search_path='' as $$
declare t public.icash_text_threads;m public.icash_text_messages;urls jsonb;total bigint;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or not exists(select 1 from public.icash_deal_files where id=t.deal_id and account_id=p_account) then raise exception 'Thread not available';end if;
 if length(trim(p_body))=0 and cardinality(p_assets)=0 then raise exception 'Message required';end if;
 if length(p_body)>1000 or cardinality(p_assets)>3 then raise exception 'Message too large';end if;
 -- One SMS segment per reviewed rate; MMS has its own independent rate.
 if cardinality(p_assets)=0 and (length(p_body)>160 or (p_body ~ '[^A-Za-z0-9 .,!?]' and length(p_body)>35)) then raise exception 'Shorten the message';end if;
 select coalesce(jsonb_agg(url order by id),'[]'),coalesce(sum(bytes),0) into urls,total from public.icash_text_assets where id=any(p_assets) and account_id=p_account and deal_id=t.deal_id and verified_until>now();
 if jsonb_array_length(urls)<>cardinality(p_assets) or total>5000000 then raise exception 'Verified attachments required';end if;
 insert into public.icash_text_messages(thread_id,account_id,direction,body,asset_ids,attachments,state,request_key) values(t.id,p_account,'outgoing',p_body,p_assets,urls,'ready',p_key) on conflict(request_key) do nothing;
 select * into m from public.icash_text_messages where request_key=p_key;
 -- Insert uses the caller's idempotency key below; no cross-account lookup may return an ID.
 if m.id is null then raise exception 'Message key missing';end if;
 if m.account_id<>p_account or m.thread_id<>p_thread or m.body<>p_body or m.asset_ids<>p_assets then raise exception 'Message key conflict';end if;
 return m.id;
end $$;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;r uuid;h integer;prop text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
 if t.id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account for update;
 if not found or m.state<>'ready' or m.direction<>'outgoing' then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account for update;
 if not found or t.paused or t.sender<>p_sender or t.permission_until is null or t.permission_until<=now() or coalesce(length(t.permission_evidence),0)<10 or not t.dnc_clear or t.dnc_checked_at is null or t.dnc_checked_at<now()-interval '30 days' then return null;end if;
 if not exists(select 1 from public.icash_text_senders where phone=t.sender and enabled) then return null;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then return null;end if;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return null;end if;
 select s.snapshot->>'propertyId' into prop from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id where d.id=t.deal_id and d.account_id=p_account and d.stage not in ('cancelled','closed');
 if prop is null then return null;end if;
 h:=extract(hour from now() at time zone t.timezone);if h<9 or h>=20 then return null;end if;
 -- Human-authored API sends; automated generation/queueing is not enabled by this RPC.
 if cardinality(m.asset_ids)>0 and (select count(*) from public.icash_text_assets where id=any(m.asset_ids) and account_id=p_account and deal_id=t.deal_id and verified_until>now())<>cardinality(m.asset_ids) then return null;end if;
 if cardinality(m.asset_ids)>0 and (select jsonb_agg(url order by id) from public.icash_text_assets where id=any(m.asset_ids)) is distinct from m.attachments then return null;end if;
 r:=case when cardinality(m.asset_ids)>0 then t.mms_rate_id else t.sms_rate_id end;
 if not exists(select 1 from public.icash_operation_rates where id=r and operation=case when cardinality(m.asset_ids)>0 then 'mms_send' else 'sms_send' end and enabled and expires_at>now()) then return null;end if;
 perform public.icash_reserve_operation(p_account,'text:'||m.id,r,t.permission_until);
 if not public.icash_claim_operation('text:'||m.id) then raise exception 'Text already dispatched';end if;
 update public.icash_text_messages set state='dispatching',updated_at=now() where id=m.id;
 return jsonb_build_object('from',t.sender,'to',t.recipient,'message',m.body,'attachments',m.attachments);
end $$;
create function public.icash_ingest_text_event(p_event jsonb,p_optout boolean) returns void language plpgsql set search_path='' as $$
declare t public.icash_text_threads;typ text:=p_event->>'type';v jsonb:=p_event->'data';n integer;stamp timestamptz;
begin
 if v->>'message_id' is not null then perform pg_advisory_xact_lock(hashtextextended(v->>'message_id',75));end if;
 insert into public.icash_text_events(id,type,payload) values(p_event->>'id',typ,p_event) on conflict(id) do nothing;
 get diagnostics n=row_count;if n=0 then return;end if;
 if typ in ('text.incoming.sms','text.incoming.mms') then
 -- STOP applies even when the sender has never been mapped to a tenant.
 if p_optout then
 perform pg_advisory_xact_lock(hashtextextended(v->>'from',74));
 insert into public.icash_text_suppressions(phone,reason) values(v->>'from','Incoming opt-out') on conflict(phone) do nothing;
 update public.icash_text_messages m set state='cancelled',updated_at=now() from public.icash_text_threads th where m.thread_id=th.id and th.recipient=v->>'from' and m.direction='outgoing' and m.state='ready';
 end if;
 select * into t from public.icash_text_threads where sender=v->>'to' and recipient=v->>'from';
 insert into public.icash_text_messages(thread_id,account_id,direction,body,attachments,state,event_id) values(t.id,t.account_id,'incoming',coalesce(v->>'body',''),coalesce(v->'attachments','[]'),'received',p_event->>'id') on conflict(event_id) do nothing;
 elsif typ='numbers.substitution' then
 update public.icash_text_senders set enabled=false where phone=v->>'from';
 elsif typ in ('text.delivery.confirmed','text.delivery.failed','text.cancelled') then
 stamp:=to_timestamp((p_event->>'timestamp')::double precision);
 update public.icash_text_messages m set state=case when typ='text.delivery.confirmed' then 'delivered' when typ='text.cancelled' then 'cancelled' else 'needs_review' end,last_delivery_at=stamp,updated_at=now()
 from public.icash_text_threads th where m.thread_id=th.id and m.provider_id=v->>'message_id' and th.sender=v->>'from' and th.recipient=v->>'to' and m.direction='outgoing'
 and (m.last_delivery_at is null or m.last_delivery_at<=stamp) and (m.state<>'delivered' or typ='text.delivery.confirmed');
 end if;
end $$;
create function public.icash_accept_text(p_account uuid,p_message uuid,p_provider text) returns void language plpgsql set search_path='' as $$
declare ev jsonb;t public.icash_text_threads;
begin
 perform pg_advisory_xact_lock(hashtextextended(p_provider,75));
 update public.icash_text_messages set provider_id=p_provider,state='accepted',updated_at=now() where id=p_message and account_id=p_account and state='dispatching';
 if not found then raise exception 'Receipt needs reconciliation';end if;
 select th.* into t from public.icash_text_threads th join public.icash_text_messages m on m.thread_id=th.id where m.id=p_message and m.account_id=p_account;
 select payload into ev from public.icash_text_events where payload->'data'->>'message_id'=p_provider and payload->'data'->>'from'=t.sender and payload->'data'->>'to'=t.recipient and type in ('text.delivery.confirmed','text.delivery.failed','text.cancelled') order by (type='text.delivery.confirmed') desc,(payload->>'timestamp')::double precision desc limit 1;
 if ev is not null then
 update public.icash_text_messages set state=case when ev->>'type'='text.delivery.confirmed' then 'delivered' when ev->>'type'='text.cancelled' then 'cancelled' else 'needs_review' end,last_delivery_at=to_timestamp((ev->>'timestamp')::double precision) where id=p_message;
 end if;
end $$;
revoke all on function public.icash_queue_text(uuid,uuid,uuid,text,uuid[]),public.icash_claim_text(uuid,uuid,text),public.icash_ingest_text_event(jsonb,boolean),public.icash_accept_text(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_queue_text(uuid,uuid,uuid,text,uuid[]),public.icash_claim_text(uuid,uuid,text),public.icash_ingest_text_event(jsonb,boolean),public.icash_accept_text(uuid,uuid,text) to service_role;
