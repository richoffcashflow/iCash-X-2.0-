set local lock_timeout='2s';
set local statement_timeout='8s';
create schema icash_seller_memory_private;
revoke all on schema icash_seller_memory_private from public,anon,authenticated;
grant usage on schema icash_seller_memory_private to service_role;
create table icash_seller_memory_private.settings(
 id integer primary key check(id=1),enabled boolean not null default false,
 enabled_at timestamptz,account_ids uuid[],release_sha text check(release_sha is null or release_sha ~ '^[0-9a-f]{40}$')
);
insert into icash_seller_memory_private.settings(id) values(1);
create function public.icash_seller_memory_enabled(p_account uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from icash_seller_memory_private.settings where id=1 and enabled and (account_ids is null or p_account=any(account_ids)))
$$;
revoke all on function public.icash_seller_memory_enabled(uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_memory_enabled(uuid) to service_role;
create table icash_seller_memory_private.call_sources(
 session_id uuid primary key,account_id uuid not null,screening_id uuid not null,contact_key text not null,
 conversation_id text not null,completed_at timestamptz not null,transcript jsonb not null,
 complete boolean not null,created_at timestamptz not null default now(),full_source boolean not null default false
);
create index seller_memory_call_sources_binding on icash_seller_memory_private.call_sources(account_id,screening_id,contact_key,completed_at);
create table icash_seller_memory_private.snapshots(
 account_id uuid not null references public.icash_accounts(id),
 screening_id uuid not null references public.icash_screening_jobs(id),
 contact_key text not null,source_fingerprint text not null,
 extractor_version text not null,projection jsonb not null,
 created_at timestamptz not null default now(),
 primary key(account_id,screening_id,contact_key,source_fingerprint,extractor_version)
);
revoke all on all tables in schema icash_seller_memory_private from public,anon,authenticated,service_role;
grant select on icash_seller_memory_private.settings to service_role;

-- Rebuildable, immutable versions of conversational evidence. No expiry can
-- silently discard an older answer. Large histories explicitly remain incomplete.
create function public.icash_seller_memory_context(p_account uuid,p_screening uuid,p_phone text)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare deal uuid;conversations jsonb;texts jsonb;calls jsonb;fingerprint text;complete boolean;cached jsonb;live_calls jsonb;
begin
 if not public.icash_seller_memory_enabled(p_account) then return null;end if;
 if p_phone is null or p_phone !~ '^\+[1-9][0-9]{7,14}$' then return null;end if;
 select (array_agg(id))[1] into deal from public.icash_deal_files
 where account_id=p_account and screening_id=p_screening and stage not in ('closed','cancelled')
 and coalesce(terms->>'practice','false')<>'true' having count(*)=1;
 if deal is null then return null;end if;
 if not exists(select 1 from public.icash_contact_permissions where account_id=p_account and screening_id=p_screening and phone=p_phone and party='seller')
 and not exists(select 1 from public.icash_text_threads where account_id=p_account and deal_id=deal and recipient=p_phone and party='seller' and retired_at is null) then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('role',case m.direction when 'incoming' then 'user' else 'agent' end,
  'message',m.body,'sourceId',m.id,'threadId',m.thread_id,'at',case when m.direction='incoming' then to_timestamp(public.icash_sms_reply_time(m.id)) else m.created_at end)
  order by case when m.direction='incoming' then public.icash_sms_reply_time(m.id) else extract(epoch from m.created_at) end,m.id),'[]') into texts
 from (select m.* from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where t.account_id=p_account and t.deal_id=deal and t.recipient=p_phone and t.party='seller' and t.retired_at is null
  and m.created_at<=now()
  and ((m.direction='incoming' and m.state='received' and public.icash_sms_reply_time(m.id)<=extract(epoch from now()) and (m.provider_id is not null or m.event_id is not null))
    or (m.direction='outgoing' and m.state='delivered' and m.provider_id is not null))
  order by m.created_at,m.id limit 1001) m;
 select coalesce(jsonb_agg(c.body order by c.at,c.source),'[]') into calls from (
  select c.completed_at at,c.id::text source,jsonb_build_object('sourceId','call:'||c.id,'channel','voice','at',c.completed_at,
   'startedAt',coalesce(c.result->>'startedAt',r.provider_started_at::text),'transcript',c.result->'transcript') body
  from public.icash_live_conversations c left join public.icash_call_recordings r on r.account_id=c.account_id and r.operation_key=c.operation_key
  where c.account_id=p_account and c.screening_id=p_screening and c.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')
   and c.party='seller' and c.state='complete' and c.operation_key like 'voice:%' and c.completed_at<=now()
   and jsonb_typeof(c.result->'transcript')='array'
  union all
  select h.completed_at,h.session_id::text,jsonb_build_object('sourceId','reception:'||h.session_id,'channel','voice','at',h.completed_at,
   'startedAt',s.provider_started_at,'transcript',h.transcript,'complete',jsonb_array_length(h.transcript)<80)
  from icash_seller_agreement_private.call_history h
  join icash_recorded_reception_private.sessions s on s.id=h.session_id and s.account_id=h.account_id
  where h.account_id=p_account and h.screening_id=p_screening and h.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')
   and h.completed_at<=now() and jsonb_typeof(h.transcript)='array'
   and not exists(select 1 from icash_seller_memory_private.call_sources saved where saved.session_id=h.session_id)
  union all
  select h.completed_at,h.session_id::text,jsonb_build_object('sourceId','reception:'||h.session_id,'channel','voice','at',h.completed_at,
   'startedAt',s.provider_started_at,'transcript',h.transcript,'complete',h.complete)
  from icash_seller_memory_private.call_sources h left join icash_recorded_reception_private.sessions s on s.id=h.session_id and s.account_id=h.account_id
  where h.account_id=p_account and h.screening_id=p_screening and h.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex') and h.completed_at<=now()
  order by at,source limit 101
 ) c;
 conversations:=calls||jsonb_build_array(jsonb_build_object('sourceId','sms','channel','sms','transcript',texts));
 complete:=jsonb_array_length(texts)<=1000 and jsonb_array_length(calls)<=100
  and not exists(select 1 from jsonb_array_elements(calls) c where jsonb_array_length(c->'transcript')>1000 or c->>'complete'='false');
 fingerprint:=encode(sha256(convert_to(conversations::text,'UTF8')),'hex');
 select projection into cached from icash_seller_memory_private.snapshots
 where account_id=p_account and screening_id=p_screening and contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')
 and source_fingerprint=fingerprint and extractor_version='seller-memory-v1';
 select coalesce(jsonb_agg(x),'[]') into live_calls from (
  select c.conversation_id "conversationId",r.provider_started_at "startedAt"
  from public.icash_live_conversations c join public.icash_call_recordings r on r.account_id=c.account_id and r.operation_key=c.operation_key
  where c.account_id=p_account and c.screening_id=p_screening and c.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')
   and c.party='seller' and c.state='waiting' and c.conversation_id is not null and r.provider_started_at is not null
  union all
  select s.conversation_id,s.provider_started_at from icash_recorded_reception_private.sessions s
  where s.account_id=p_account and s.from_phone=p_phone and s.call_ended_at is null and s.conversation_id is not null and s.provider_started_at is not null
 ) x;
 return jsonb_build_object('binding',jsonb_build_object('accountId',p_account,'screeningId',p_screening,'dealId',deal,'phone',p_phone),
  'fingerprint',fingerprint,'complete',complete,'conversations',conversations,'cached',cached,'liveCalls',live_calls);
end $$;

create function public.icash_save_seller_memory(p_account uuid,p_screening uuid,p_phone text,p_fingerprint text,p_projection jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare source jsonb;
begin
 if p_projection->>'version' is distinct from 'seller-memory-v1' or jsonb_typeof(p_projection->'facts') is distinct from 'object'
  or octet_length(p_projection::text)>20000 then return false;end if;
 source:=public.icash_seller_memory_context(p_account,p_screening,p_phone);
 if source->>'fingerprint' is distinct from p_fingerprint or source->>'complete' is distinct from 'true' then return false;end if;
 -- Every projected fact retains an exact seller statement in this source. The
 -- service computes meaning; a cache never grants a price, call or signature.
 if exists(select 1 from jsonb_each(p_projection->'facts') f where not exists(
  select 1 from jsonb_array_elements(source->'conversations') c cross join lateral jsonb_array_elements(c->'transcript') with ordinality turns(t,n)
  where t->>'role'='user' and trim(t->>'message')=f.value->>'quote'
   and coalesce(t->>'sourceId',c->>'sourceId'||':'||(n-1))=f.value->>'sourceId'
 )) then return false;end if;
 -- Retain source-backed inbound answers when the older 30-day context expires.
 -- Reset/retirement still changes the binding; this table grants no authority.
 insert into icash_seller_memory_private.call_sources(session_id,account_id,screening_id,contact_key,conversation_id,completed_at,transcript,complete)
 select h.session_id,h.account_id,h.screening_id,h.contact_key,h.conversation_id,h.completed_at,h.transcript,true
 from icash_seller_agreement_private.call_history h
 where h.account_id=p_account and h.screening_id=p_screening and h.contact_key=encode(sha256(convert_to(p_phone,'UTF8')),'hex')
 and h.completed_at<=now() and jsonb_array_length(h.transcript)<80
 on conflict do nothing;
 insert into icash_seller_memory_private.snapshots(account_id,screening_id,contact_key,source_fingerprint,extractor_version,projection)
 values(p_account,p_screening,encode(sha256(convert_to(p_phone,'UTF8')),'hex'),p_fingerprint,'seller-memory-v1',p_projection)
 on conflict do nothing;
 return true;
end $$;
revoke all on function public.icash_seller_memory_context(uuid,uuid,text),public.icash_save_seller_memory(uuid,uuid,text,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_seller_memory_context(uuid,uuid,text),public.icash_save_seller_memory(uuid,uuid,text,text,jsonb) to service_role;

-- Called only after the existing completed, provider-bound history write.
-- Keep its exact first/last receipt and add the complete source separately.
create function public.icash_save_seller_memory_inbound_history(p_session uuid,p_conversation text,p_transcript jsonb)
returns boolean language plpgsql security definer set search_path='' as $$
declare h icash_seller_agreement_private.call_history;legacy jsonb;whole jsonb;clipped jsonb;
begin
 select * into h from icash_seller_agreement_private.call_history where session_id=p_session and conversation_id=p_conversation;
 if not found or not public.icash_seller_memory_enabled(h.account_id) then return true;end if;
 if jsonb_typeof(p_transcript) is distinct from 'array' or jsonb_array_length(p_transcript) not between 1 and 1001 or octet_length(p_transcript::text)>2000000
 or exists(select 1 from jsonb_array_elements(p_transcript) t where jsonb_typeof(t) is distinct from 'object' or t->>'role' not in ('agent','user')
  or jsonb_typeof(t->'message') is distinct from 'string' or length(t->>'message')>12000 or t-array['role','message','at']<>'{}'::jsonb
  or (t?'at' and (jsonb_typeof(t->'at') is distinct from 'string' or (t->>'at')::timestamptz>h.completed_at))) then return false;end if;
 select jsonb_agg(jsonb_build_object('role',t->>'role','message',t->>'message') order by n) into whole from jsonb_array_elements(p_transcript) with ordinality x(t,n);
 select jsonb_agg(t order by n) into clipped from jsonb_array_elements(whole) with ordinality x(t,n) where jsonb_array_length(whole)<=80 or n<=40 or n>jsonb_array_length(whole)-40;
 if h.transcript is distinct from clipped then return false;end if;
 insert into icash_seller_memory_private.call_sources values(h.session_id,h.account_id,h.screening_id,h.contact_key,h.conversation_id,h.completed_at,p_transcript,jsonb_array_length(p_transcript)<=1000,now(),true)
 on conflict(session_id) do update set transcript=excluded.transcript,complete=excluded.complete,full_source=true
 where not call_sources.full_source and call_sources.transcript=clipped;
 select transcript into legacy from icash_seller_memory_private.call_sources where session_id=p_session;
 return legacy=p_transcript;
end $$;
revoke all on function public.icash_save_seller_memory_inbound_history(uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.icash_save_seller_memory_inbound_history(uuid,text,jsonb) to service_role;
