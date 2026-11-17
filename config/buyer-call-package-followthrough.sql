-- Installed disabled. The migration runner owns DDL plus ledger transaction.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $guard$
declare p record;item record;
begin
 select pg_get_functiondef(oid) definition,proowner,proacl into p from pg_proc where oid='public.icash_claim_text(uuid,uuid,text)'::regprocedure;
 if md5(p.definition)<>'a59a859edb0742485bddd04e49975d60' or pg_get_userbyid(p.proowner)<>'postgres'
  or p.proacl is distinct from '{postgres=X/postgres,service_role=X/postgres}'::aclitem[]
  or to_regnamespace('icash_buyer_call_package_private') is not null
 then raise exception 'Buyer call package dispatch prerequisite changed';end if;
 for item in select * from (values
  ('public.icash_buyer_request_action(text)','44916db06dbd021456247df4816cfd94'),
  ('public.icash_save_buyer_inbound_history(uuid,text,jsonb)','aa8596d51b98a17a940d6daba615559d')
 ) expected(signature,hash) loop
  if not exists(select 1 from pg_proc where oid=item.signature::regprocedure and md5(pg_get_functiondef(oid))=item.hash
   and pg_get_userbyid(proowner)='postgres' and proacl is not distinct from '{postgres=X/postgres,service_role=X/postgres}'::aclitem[])
  then raise exception 'Buyer call package source prerequisite changed';end if;
 end loop;
end $guard$;

create schema icash_buyer_call_package_private;
revoke all on schema icash_buyer_call_package_private from public,anon,authenticated,service_role;
create table icash_buyer_call_package_private.settings(
 id integer primary key check(id=1),enabled boolean not null default false,enabled_at timestamptz,
 policy text not null default 'buyer-call-package-v1' check(policy='buyer-call-package-v1'),
 check(not enabled or enabled_at is not null)
);
insert into icash_buyer_call_package_private.settings(id) values(1);
create table icash_buyer_call_package_private.sources(
 session_id uuid primary key references icash_recorded_reception_private.sessions(id),
 account_id uuid not null references public.icash_accounts(id),deal_id uuid not null references public.icash_deal_files(id),
 thread_id uuid not null references public.icash_text_threads(id),conversation_id text not null,
 from_phone text not null,to_phone text not null,call_sid text not null,provider_account_sid text not null,
 call_started_at timestamptz not null,completed_at timestamptz not null,source jsonb not null,source_hash text not null,
 request_quote text,request_at timestamptz,followup_id uuid,followup_snapshot jsonb,created_at timestamptz not null default now(),
 check((request_quote is null)=(request_at is null)),check((followup_id is null)=(followup_snapshot is null))
);
create table icash_buyer_call_package_private.source_conflicts(
 session_id uuid primary key references icash_buyer_call_package_private.sources(session_id),
 observed_hash text not null,created_at timestamptz not null default now()
);
create table icash_buyer_call_package_private.actions(
 id uuid primary key default gen_random_uuid(),session_id uuid not null unique references icash_buyer_call_package_private.sources(session_id),
 message_id uuid unique references public.icash_text_messages(id),link_id uuid references public.icash_buyer_package_links(id),body text,asking_price_cents bigint,purchase_envelope_id uuid,
 state text not null default 'ready' check(state in ('ready','accepted','sent','needs_review','cancelled')),
 next_attempt_at timestamptz not null default now(),attempts integer not null default 0,
 check((message_id is null)=(link_id is null) and (message_id is null)=(body is null) and (message_id is null)=(asking_price_cents is null) and (message_id is null)=(purchase_envelope_id is null))
);
alter table icash_buyer_call_package_private.settings enable row level security;
alter table icash_buyer_call_package_private.sources enable row level security;
alter table icash_buyer_call_package_private.actions enable row level security;
alter table icash_buyer_call_package_private.source_conflicts enable row level security;
revoke all on all tables in schema icash_buyer_call_package_private from public,anon,authenticated,service_role;
create index buyer_call_package_due on icash_buyer_call_package_private.actions(next_attempt_at,id) where state in ('ready','accepted');
create index buyer_call_package_source_thread on icash_buyer_call_package_private.sources(account_id,thread_id,request_at);
create index recorded_reception_buyer_source_clock on icash_recorded_reception_private.sessions(account_id,from_phone,created_at desc);

create function icash_buyer_call_package_private.immutable_source() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Original buyer call source is immutable';end $$;
create trigger buyer_call_package_source_immutable before update or delete on icash_buyer_call_package_private.sources for each row execute function icash_buyer_call_package_private.immutable_source();
create trigger buyer_call_package_source_no_truncate before truncate on icash_buyer_call_package_private.sources for each statement execute function icash_buyer_call_package_private.immutable_source();
create trigger buyer_call_package_conflict_immutable before update or delete on icash_buyer_call_package_private.source_conflicts for each row execute function icash_buyer_call_package_private.immutable_source();
create trigger buyer_call_package_conflict_no_truncate before truncate on icash_buyer_call_package_private.source_conflicts for each statement execute function icash_buyer_call_package_private.immutable_source();
create function icash_buyer_call_package_private.action_identity() returns trigger language plpgsql set search_path='' as $$
begin
 if row(new.id,new.session_id) is distinct from row(old.id,old.session_id)
  or old.message_id is not null and row(new.message_id,new.link_id,new.body,new.asking_price_cents,new.purchase_envelope_id) is distinct from row(old.message_id,old.link_id,old.body,old.asking_price_cents,old.purchase_envelope_id)
 then raise exception 'Original buyer call message is immutable';end if;
 return new;
end $$;
create trigger buyer_call_package_action_identity before update on icash_buyer_call_package_private.actions for each row execute function icash_buyer_call_package_private.action_identity();

create function icash_buyer_call_package_private.history_projection(p_source jsonb) returns jsonb
language sql immutable set search_path='' as $$
 with spoken as(select jsonb_build_object('role',t->'role','message',t->'message') turn,row_number() over(order by n) n,count(*) over() total
  from jsonb_array_elements(p_source->'turns') with ordinality x(t,n) where jsonb_typeof(t->'message')='string')
 select coalesce(jsonb_agg(turn order by n) filter(where total<=80 or n<=40 or n>total-40),'[]') from spoken
$$;

create function icash_buyer_call_package_private.package_request(p_source jsonb) returns jsonb
language plpgsql immutable set search_path='' as $$
declare t jsonb;b text;request jsonb;
begin
 for t in select value from jsonb_array_elements(p_source->'turns') loop
  if t->>'role'<>'user' then continue;end if;
  b:=lower(btrim(replace(t->>'message','’','''')));
  -- A call request never overrides a withdrawal, a different contact channel,
  -- a human request or an instruction to contact someone else.
  if b ~ '\m(stop|unsubscribe|cancel|withdraw|wrong number|human|person|not interested|no longer interested|never mind|nevermind|call me|email me|do not text|don''t text|do not send|don''t send)\M' then return null;end if;
  if public.icash_buyer_request_action(t->>'message')='package' then request:=jsonb_build_object('quote',t->>'message','seconds',t->'seconds');
  elsif b !~ '^(thanks|thank you|thank you very much|okay|ok|great|sounds good|yes please|bye|goodbye)[.! ]*$' then request:=null;
  end if;
 end loop;
 return request;
end $$;

create function public.icash_capture_buyer_call_package(p_session uuid,p_conversation text,p_source jsonb) returns text
language plpgsql security definer set search_path='' as $$
declare s icash_recorded_reception_private.sessions;b icash_recorded_reception_private.buyer_bindings;t public.icash_text_threads;
 cfg icash_buyer_call_package_private.settings;v public.icash_buyer_viewing_requests;started timestamptz;spoken timestamptz;turn jsonb;seconds numeric;previous numeric:=-1;request jsonb;fingerprint text;
begin
 select * into cfg from icash_buyer_call_package_private.settings where id=1;
 if not cfg.enabled then return 'disabled';end if;
 select * into s from icash_recorded_reception_private.sessions where id=p_session and conversation_id=p_conversation;
 select * into b from icash_recorded_reception_private.buyer_bindings where session_id=s.id and account_id=s.account_id;
 if b.session_id is null then return 'not_buyer';end if;
 select * into t from public.icash_text_threads where id=b.thread_id and account_id=b.account_id and deal_id=b.deal_id and party='buyer' and recipient=s.from_phone;
 if t.id is null or t.owner_buyer_test_id is not null or s.call_profile<>'normal' then return 'source_held';end if;
 if s.created_at<cfg.enabled_at or s.call_started_at<cfg.enabled_at then return 'before_cutover';end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended(s.from_phone,74));
 -- Keep the first complete source immutable. Any later disagreement, including
 -- one hidden by the display projection, durably removes its send authority.
 if exists(select 1 from icash_buyer_call_package_private.sources where session_id=s.id and source is distinct from p_source) then
  insert into icash_buyer_call_package_private.source_conflicts(session_id,observed_hash)
   values(s.id,encode(sha256(convert_to(coalesce(p_source::text,'null'),'UTF8')),'hex')) on conflict do nothing;
 end if;
 if exists(select 1 from icash_buyer_call_package_private.source_conflicts where session_id=s.id) then return 'source_conflict';end if;
 if s.call_terminal_status is distinct from 'completed' or s.call_started_at is null or s.register_claimed_at is null
  or s.call_ended_at is null or s.call_ended_at not between now()-interval '24 hours' and now()
  or jsonb_typeof(p_source) is distinct from 'object' or p_source->>'version' is distinct from cfg.policy or p_source->'complete' is distinct from 'true'::jsonb
  or p_source-array['version','complete','startedAt','turns']<>'{}'::jsonb or pg_column_size(p_source)>262144
  or jsonb_typeof(p_source->'turns') is distinct from 'array' then return 'source_held';end if;
 if jsonb_array_length(p_source->'turns') not between 1 and 1000 or coalesce(p_source->>'startedAt','') !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$' then return 'source_held';end if;
 started:=(p_source->>'startedAt')::timestamptz;
 if not isfinite(started) or started<s.call_started_at or started>s.call_ended_at or started>s.call_started_at+make_interval(secs=>s.max_total_seconds) then return 'source_held';end if;
 for turn in select value from jsonb_array_elements(p_source->'turns') loop
  if jsonb_typeof(turn) is distinct from 'object' or turn-array['role','message','seconds']<>'{}'::jsonb
   or coalesce(turn->>'role','') not in ('agent','user') or jsonb_typeof(turn->'seconds') is distinct from 'number'
   or (jsonb_typeof(turn->'message')='string' and length(turn->>'message')<=12000 or turn->>'role'='agent' and turn->'message'='null'::jsonb) is distinct from true
   then return 'source_held';end if;
  seconds:=(turn->>'seconds')::numeric;
  if seconds<previous or seconds<0 or seconds>s.max_total_seconds or started+seconds*interval '1 second'>s.call_ended_at
   or started+seconds*interval '1 second'>s.call_started_at+make_interval(secs=>s.max_total_seconds) then return 'source_held';end if;
  previous:=seconds;
 end loop;
 if not exists(select 1 from icash_recorded_reception_private.buyer_history h join public.icash_deal_files d on d.id=b.deal_id and d.account_id=b.account_id
  where h.session_id=s.id and h.account_id=s.account_id and h.conversation_id=s.conversation_id and h.completed_at=s.call_ended_at
   and h.screening_id=d.screening_id and h.transcript=icash_buyer_call_package_private.history_projection(p_source)) then return 'source_held';end if;
 request:=icash_buyer_call_package_private.package_request(p_source);
 if request is not null then spoken:=started+(request->>'seconds')::numeric*interval '1 second';end if;
 fingerprint:=encode(sha256(convert_to(p_source::text,'UTF8')),'hex');
 select * into v from public.icash_buyer_viewing_requests where source='call' and source_id=s.id;
 if v.id is not null and (row(v.account_id,v.deal_id,v.thread_id) is distinct from row(s.account_id,b.deal_id,t.id)
  or v.state<>'needs_confirmation') then return 'source_held';end if;
 insert into icash_buyer_call_package_private.sources(session_id,account_id,deal_id,thread_id,conversation_id,from_phone,to_phone,call_sid,provider_account_sid,call_started_at,completed_at,source,source_hash,request_quote,request_at,followup_id,followup_snapshot)
 values(s.id,s.account_id,b.deal_id,t.id,s.conversation_id,s.from_phone,s.to_phone,s.call_sid,s.provider_account_sid,s.call_started_at,s.call_ended_at,p_source,fingerprint,request->>'quote',spoken,v.id,case when v.id is not null then to_jsonb(v) end) on conflict do nothing;
 if not exists(select 1 from icash_buyer_call_package_private.sources where session_id=s.id and source_hash=fingerprint and source=p_source
  and account_id=s.account_id and thread_id=t.id and deal_id=b.deal_id and completed_at=s.call_ended_at) then return 'source_conflict';end if;
 if request is null then return 'no_request';end if;
 insert into icash_buyer_call_package_private.actions(session_id) values(s.id) on conflict do nothing;
 return 'recorded';
exception when invalid_text_representation or datetime_field_overflow or numeric_value_out_of_range then return 'source_held';
end $$;

-- Only a fully bound incoming provider event proves that a late-ingested reply
-- is older. Missing, forged-type or implausible clocks use ingestion time and hold.
create function icash_buyer_call_package_private.reply_time(m public.icash_text_messages,t public.icash_text_threads) returns numeric
language sql stable set search_path='' as $$
 select coalesce((select case when jsonb_typeof(e.payload->'timestamp')='number' then
   case when (e.payload->>'timestamp')::numeric>0 and (e.payload->>'timestamp')::numeric
    between extract(epoch from m.created_at-interval '30 days') and extract(epoch from m.created_at)+5
   then (e.payload->>'timestamp')::numeric end end
  from public.icash_text_events e where e.id=m.event_id and e.type in ('text.incoming.sms','text.incoming.mms')
   and e.payload->>'id'=e.id and e.payload->>'type'=e.type and e.payload#>>'{data,from}'=t.recipient
   and e.payload#>>'{data,to}'=t.sender and e.payload#>>'{data,body}'=m.body),extract(epoch from m.created_at))
$$;

create function icash_buyer_call_package_private.current_package(p_action uuid) returns jsonb
language plpgsql volatile security definer set search_path='' as $$
declare a icash_buyer_call_package_private.actions;r icash_buyer_call_package_private.sources;t public.icash_text_threads;p jsonb;l public.icash_buyer_package_links;
begin
 select * into a from icash_buyer_call_package_private.actions where id=p_action;
 select * into r from icash_buyer_call_package_private.sources where session_id=a.session_id;
 if exists(select 1 from icash_buyer_call_package_private.source_conflicts where session_id=r.session_id)
  or a.state not in ('ready','accepted') or r.request_at is null or r.request_at not between now()-interval '24 hours' and now()
  or r.source_hash<>encode(sha256(convert_to(r.source::text,'UTF8')),'hex')
  or not exists(select 1 from icash_buyer_call_package_private.settings where id=1 and enabled and r.call_started_at>=enabled_at and r.request_at>=enabled_at)
  or not exists(select 1 from public.icash_seller_progress_settings where buyer_reply_enabled) then return null;end if;
 if r.followup_id is not null and not exists(select 1 from public.icash_buyer_viewing_requests v where v.id=r.followup_id and to_jsonb(v)=r.followup_snapshot) then return null;end if;
 if r.followup_id is null and exists(select 1 from public.icash_buyer_viewing_requests v where v.source='call' and v.source_id=r.session_id) then return null;end if;
 if not exists(select 1 from icash_recorded_reception_private.sessions s join icash_recorded_reception_private.buyer_bindings b on b.session_id=s.id and b.account_id=s.account_id
  join icash_recorded_reception_private.buyer_history h on h.session_id=s.id and h.account_id=s.account_id and h.conversation_id=s.conversation_id
  where s.id=r.session_id and s.account_id=r.account_id and b.deal_id=r.deal_id and b.thread_id=r.thread_id and s.conversation_id=r.conversation_id
   and s.from_phone=r.from_phone and s.to_phone=r.to_phone and s.call_sid=r.call_sid and s.provider_account_sid=r.provider_account_sid
   and s.call_started_at=r.call_started_at and s.call_ended_at=r.completed_at and h.completed_at=r.completed_at and s.call_terminal_status='completed' and s.call_profile='normal'
   and h.transcript=icash_buyer_call_package_private.history_projection(r.source)) then return null;end if;
 select * into t from public.icash_text_threads where id=r.thread_id and account_id=r.account_id and deal_id=r.deal_id and recipient=r.from_phone
  and party='buyer' and not paused and not manual_only and ai_mode='auto' and retired_at is null and owner_buyer_test_id is null;
 if not found or public.icash_sms_thread_review_current(r.account_id,t.id,true) is distinct from true
  or not public.icash_journey_allowed(r.account_id,r.deal_id)
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex')) then return null;end if;
 -- New original-time buyer input or a new call owns its newer intent. Neither
 -- a late ingestion timestamp nor an older replay can revive this source.
 if exists(select 1 from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=r.thread_id
  and m.created_at>=r.call_started_at-interval '1 day' and m.direction='incoming' and m.state='received' and icash_buyer_call_package_private.reply_time(m,t)>=extract(epoch from r.request_at))
  or exists(select 1 from icash_recorded_reception_private.sessions s where s.account_id=r.account_id and s.from_phone=r.from_phone and s.id<>r.session_id
   and s.created_at>=r.request_at-interval '11 minutes'
   and greatest(s.created_at,s.call_started_at,s.call_ended_at)>=r.request_at)
  or exists(select 1 from icash_recorded_reception_private.sessions s where s.account_id=r.account_id and s.from_phone=r.from_phone and s.id<>r.session_id and s.call_ended_at is null)
  or exists(select 1 from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=r.thread_id and m.direction='outgoing'
   and m.id is distinct from a.message_id and m.created_at>=r.request_at and m.state in ('ready','dispatching','accepted','delivered','needs_review')) then return null;end if;
 p:=public.icash_buyer_package_data(r.account_id,r.deal_id);
 if p is null or p->'reserved' is distinct from 'false'::jsonb then return null;end if;
 select link.* into l from public.icash_buyer_package_links link join public.icash_disposition_authorities d on d.account_id=link.account_id and d.deal_id=link.deal_id and d.purchase_envelope_id=link.purchase_envelope_id
  where link.account_id=r.account_id and link.deal_id=r.deal_id and link.revoked_at is null and d.expires_at>now()
   and to_jsonb(link.asking_price_cents)=p->'askingPriceCents' and link.token ~ '^[a-f0-9]{32}$'
  order by link.id limit 1;
 if not found or a.link_id is not null and row(a.link_id,a.asking_price_cents,a.purchase_envelope_id) is distinct from row(l.id,l.asking_price_cents,l.purchase_envelope_id) then return null;end if;
 return jsonb_build_object('linkId',l.id,'askingPriceCents',l.asking_price_cents,'purchaseEnvelopeId',l.purchase_envelope_id,'body','Current property details and available photos: https://propertymsgs.com/d/'||l.token);
end $$;

create function public.icash_claim_buyer_call_package() returns jsonb
language plpgsql security definer set search_path='' as $$
declare a icash_buyer_call_package_private.actions;r icash_buyer_call_package_private.sources;m public.icash_text_messages;p jsonb;
begin
 if not exists(select 1 from icash_buyer_call_package_private.settings where id=1 and enabled) then return null;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into a from icash_buyer_call_package_private.actions where state in ('ready','accepted') and next_attempt_at<=now() order by next_attempt_at,id for update skip locked limit 1;
 if not found then return null;end if;
 update icash_buyer_call_package_private.actions set next_attempt_at=now()+interval '30 minutes',attempts=attempts+1 where id=a.id;
 select * into r from icash_buyer_call_package_private.sources where session_id=a.session_id;
 if a.message_id is not null then
  select * into m from public.icash_text_messages where id=a.message_id and account_id=r.account_id and thread_id=r.thread_id and direction='outgoing' and body=a.body;
  if not found then update icash_buyer_call_package_private.actions set state='needs_review' where id=a.id;return null;end if;
  if m.state='delivered' and m.provider_id is not null then
   -- Complete only the immutable package-only request still exactly as captured.
   -- A late receipt cannot overwrite a new request, mixed request or manual edit.
   perform pg_advisory_xact_lock(hashtextextended(r.from_phone,74));
   if r.followup_id is not null and icash_buyer_call_package_private.current_package(a.id) is not null then
    update public.icash_buyer_viewing_requests v set state='reviewed',reviewed_at=now()
     where v.id=r.followup_id and v.source='call' and v.source_id=r.session_id and v.account_id=r.account_id and v.thread_id=r.thread_id
      and v.kind='buyer_followup' and v.state='needs_confirmation' and v.quote=r.request_quote and v.coordination_quote=r.request_quote and v.viewing_quote is null and v.title_quote is null
      and to_jsonb(v)=r.followup_snapshot;
   end if;
   update icash_buyer_call_package_private.actions set state='sent' where id=a.id;return null;
  end if;
  if m.state='accepted' and m.provider_id is not null then
   update icash_buyer_call_package_private.actions set state=case when r.request_at>=now()-interval '24 hours' then 'accepted' else 'needs_review' end where id=a.id;return null;
  end if;
  if m.state<>'ready' or m.provider_id is not null then update icash_buyer_call_package_private.actions set state='needs_review' where id=a.id;return null;end if;
 end if;
 if r.request_at<now()-interval '24 hours' then update icash_buyer_call_package_private.actions set state='cancelled' where id=a.id;return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(r.from_phone,74));
 p:=icash_buyer_call_package_private.current_package(a.id);if p is null then return null;end if;
 if a.message_id is null then
  a.message_id:=public.icash_queue_text(r.account_id,r.thread_id,a.id,p->>'body','{}'::uuid[]);
  if a.message_id is null then return null;end if;
  update icash_buyer_call_package_private.actions set message_id=a.message_id,link_id=(p->>'linkId')::uuid,body=p->>'body',asking_price_cents=(p->>'askingPriceCents')::bigint,purchase_envelope_id=(p->>'purchaseEnvelopeId')::uuid where id=a.id;
 end if;
 return jsonb_build_object('accountId',r.account_id,'messageId',a.message_id);
end $$;

create function public.icash_buyer_call_package_dispatch_allowed(p_account uuid,p_message uuid,p_claimed boolean default false) returns boolean
language plpgsql security definer set search_path='' as $$
declare a icash_buyer_call_package_private.actions;r icash_buyer_call_package_private.sources;v public.icash_buyer_viewing_requests;p jsonb;
begin
 select * into a from icash_buyer_call_package_private.actions where message_id=p_message;
 if not found then return true;end if;
 select * into r from icash_buyer_call_package_private.sources where session_id=a.session_id;
 if r.account_id<>p_account or a.state<>'ready' then return false;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform pg_advisory_xact_lock(hashtextextended(r.from_phone,74));
 p:=icash_buyer_call_package_private.current_package(a.id);
 if p is null or a.body is distinct from p->>'body' or a.link_id is distinct from (p->>'linkId')::uuid or not exists(select 1 from public.icash_text_messages
  where id=p_message and account_id=p_account and thread_id=r.thread_id and direction='outgoing'
   and state=case when p_claimed then 'dispatching' else 'ready' end and provider_id is null and body=a.body) then return false;end if;
 if p_claimed then
  -- All inherited admission/helper locks precede this final row lock. No helper
  -- or lower-order lock is acquired after it. Re-read the tuple after any wait.
  if r.followup_id is not null then
   select * into v from public.icash_buyer_viewing_requests where id=r.followup_id for update;
   if not found or to_jsonb(v) is distinct from r.followup_snapshot then return false;end if;
  elsif exists(select 1 from public.icash_buyer_viewing_requests where source='call' and source_id=r.session_id) then return false;
  end if;
 end if;
 return true;
end $$;

alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_buyer_call_package;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.icash_buyer_call_package_dispatch_allowed(p_account,p_message) then return null;end if;
 result:=public.icash_claim_text_before_buyer_call_package(p_account,p_message,p_sender);
 if result is not null and not public.icash_buyer_call_package_dispatch_allowed(p_account,p_message,true) then
  raise exception using errcode='PBC01',message='Buyer call source changed during final admission';
 end if;
 return result;
exception when sqlstate 'PBC01' then
 -- This block is a subtransaction: failed recheck rolls back every inherited
 -- reservation/claim write, never leaving an unsent original dispatching.
 return null;
end $$;
revoke all on all functions in schema icash_buyer_call_package_private from public,anon,authenticated,service_role;
revoke all on function public.icash_capture_buyer_call_package(uuid,text,jsonb),public.icash_claim_buyer_call_package(),public.icash_buyer_call_package_dispatch_allowed(uuid,uuid,boolean),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_buyer_call_package(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_capture_buyer_call_package(uuid,text,jsonb),public.icash_claim_buyer_call_package(),public.icash_buyer_call_package_dispatch_allowed(uuid,uuid,boolean),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_buyer_call_package(uuid,uuid,text) to service_role;
