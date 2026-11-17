-- Runner-owned transaction; disabled prospective capture. No historic backfill.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $guard$
declare p record;
begin
 select md5(pg_get_functiondef(oid)) hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl
 into p from pg_proc where oid='public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure;
 if p.hash is distinct from '7a680dae86359988c3f70c705a3369b0' or p.owner is distinct from 'postgres' or p.prosecdef is distinct from true
  or p.provolatile is distinct from 's' or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""']
  or p.acl is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Seller call source predecessor changed';end if;
 select md5(pg_get_functiondef(oid)) hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile,proparallel,proconfig,proacl::text acl
 into p from pg_proc where oid='public.icash_save_live_result(uuid,jsonb)'::regprocedure;
 if p.hash is distinct from '82af3a7c40a85cb346ad37f571b3fdca' or p.owner is distinct from 'postgres' or p.prosecdef is distinct from false
  or p.provolatile is distinct from 'v' or p.proparallel is distinct from 'u' or p.proconfig is distinct from array['search_path=""']
  or p.acl is distinct from '{postgres=X/postgres,service_role=X/postgres}' then raise exception 'Atomic seller result predecessor changed';end if;
end $guard$;

create schema icash_seller_call_source_private;
revoke all on schema icash_seller_call_source_private from public,anon,authenticated,service_role;
create table icash_seller_call_source_private.policy(
 id integer primary key check(id=1),enabled boolean not null default false,
 installed_at timestamptz not null default clock_timestamp(),activated_at timestamptz,release_sha text,
 check(not enabled or (activated_at is not null and isfinite(activated_at) and activated_at>=installed_at and release_sha is not null and release_sha ~ '^[0-9a-f]{40}$'))
);
insert into icash_seller_call_source_private.policy(id) values(1);
create function icash_seller_call_source_private.policy_guard() returns trigger language plpgsql set search_path='' as $$
begin
 if tg_op<>'UPDATE' or new.id<>old.id or new.installed_at is distinct from old.installed_at then raise exception 'Original source cutover is immutable';end if;
 if old.activated_at is not null and row(new.activated_at,new.release_sha) is distinct from row(old.activated_at,old.release_sha)
  or old.activated_at is null and new.activated_at is not null and (not new.enabled or new.activated_at<clock_timestamp()-interval '5 seconds' or new.activated_at>clock_timestamp())
 then raise exception 'Fresh original source activation required';end if;
 return new;
end $$;
create trigger seller_call_source_policy_guard before update or delete on icash_seller_call_source_private.policy for each row execute function icash_seller_call_source_private.policy_guard();
create trigger seller_call_source_policy_no_truncate before truncate on icash_seller_call_source_private.policy for each statement execute function icash_seller_call_source_private.policy_guard();
create table icash_seller_call_source_private.sources(
 kind text not null check(kind in ('outbound','inbound')),source_id uuid not null,
 account_id uuid not null,screening_id uuid not null,contact_key text not null,
 conversation_id text not null,agent_id text not null,completed_at timestamptz not null,
 evidence jsonb not null,evidence_hash text not null,content_complete boolean not null,
 transcript jsonb not null,recorded_at timestamptz not null default clock_timestamp(),primary key(kind,source_id)
);
create index seller_call_source_binding on icash_seller_call_source_private.sources(account_id,screening_id,contact_key,completed_at);
create table icash_seller_call_source_private.conflicts(
 kind text not null,source_id uuid not null,evidence_hash text not null,evidence jsonb not null,
 recorded_at timestamptz not null default clock_timestamp(),primary key(kind,source_id,evidence_hash),
 foreign key(kind,source_id) references icash_seller_call_source_private.sources(kind,source_id)
);
create function icash_seller_call_source_private.immutable() returns trigger language plpgsql set search_path='' as $$
begin raise exception 'Original call source evidence is immutable';end $$;
create trigger seller_call_source_immutable before update or delete on icash_seller_call_source_private.sources for each row execute function icash_seller_call_source_private.immutable();
create trigger seller_call_source_no_truncate before truncate on icash_seller_call_source_private.sources for each statement execute function icash_seller_call_source_private.immutable();
create trigger seller_call_conflict_immutable before update or delete on icash_seller_call_source_private.conflicts for each row execute function icash_seller_call_source_private.immutable();
create trigger seller_call_conflict_no_truncate before truncate on icash_seller_call_source_private.conflicts for each statement execute function icash_seller_call_source_private.immutable();
alter table icash_seller_call_source_private.policy enable row level security;
alter table icash_seller_call_source_private.sources enable row level security;
alter table icash_seller_call_source_private.conflicts enable row level security;
revoke all on all tables in schema icash_seller_call_source_private from public,anon,authenticated,service_role;

create function icash_seller_call_source_private.turn_kind(t jsonb) returns text language sql immutable set search_path='' as $$
 select case
  when jsonb_typeof(t)='object' and t->>'role' in ('agent','user') and jsonb_typeof(t->'message')='string' then 'speech'
  when jsonb_typeof(t)='object' and t->>'role'='agent' and (not t?'message' or t->'message'='null'::jsonb)
   and (case when jsonb_typeof(t->'tool_calls')='array' then jsonb_array_length(t->'tool_calls')>0 else false end
    or case when jsonb_typeof(t->'tool_results')='array' then jsonb_array_length(t->'tool_results')>0 else false end) then 'tool'
  else 'invalid' end;
$$;

create function public.icash_capture_seller_call_source(p_kind text,p_source uuid,p_evidence jsonb) returns boolean
language plpgsql security definer set search_path='' as $$
declare cfg icash_seller_call_source_private.policy;phone text;source_account uuid;bound record;raw jsonb;complete boolean:=false;clocks boolean:=false;started timestamptz;turns jsonb:='[]';source_hash text;prior icash_seller_call_source_private.sources;
begin
 select * into cfg from icash_seller_call_source_private.policy where id=1;
 if not cfg.enabled then return true;end if;
 if p_kind='outbound' then
  select r.to_phone,c.account_id into phone,source_account from public.icash_live_conversations c join public.icash_call_recordings r on r.operation_key=c.operation_key and r.account_id=c.account_id
   where c.id=p_source and c.party='seller' and c.operation_key like 'voice:%';
 elsif p_kind='inbound' then
  if not exists(select 1 from icash_seller_agreement_private.inbound_bindings where session_id=p_source) then return true;end if;
  select s.from_phone,s.account_id into phone,source_account from icash_recorded_reception_private.sessions s where s.id=p_source;
 else return false;end if;
 if source_account is not null and not public.icash_seller_memory_enabled(source_account) then return true;end if;
 if phone is null or phone !~ '^\+[1-9][0-9]{7,14}$' then return false;end if;
 -- Same recipient fence as actual SMS writers, before any original row lock.
 perform pg_advisory_xact_lock(hashtextextended(phone,74));
 if p_kind='outbound' then
  select c.account_id,c.screening_id,c.contact_key,c.conversation_id,c.agent_id,c.completed_at,r.to_phone as phone,r.provider_started_at,c.result
   into bound from public.icash_live_conversations c join public.icash_call_recordings r on r.operation_key=c.operation_key and r.account_id=c.account_id
   where c.id=p_source and c.party='seller' and c.state='complete' and c.operation_key like 'voice:%'
    and r.screening_id=c.screening_id and r.contact_key=c.contact_key and r.conversation_id=c.conversation_id and r.agent_id=c.agent_id and r.party='seller'
   for share of c,r;
 else
  select s.account_id,d.screening_id,s.contact_key,s.conversation_id,s.agent_id,s.call_ended_at as completed_at,s.from_phone as phone,s.provider_started_at,null::jsonb as result
   into bound from icash_recorded_reception_private.sessions s
   join icash_seller_agreement_private.inbound_bindings b on b.session_id=s.id and b.account_id=s.account_id
   join public.icash_deal_files d on d.id=b.deal_id and d.account_id=s.account_id
   join public.icash_text_threads t on t.id=b.thread_id and t.account_id=s.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=s.from_phone
   where s.id=p_source and s.call_ended_at is not null for share of s,b,d,t;
 end if;
 if not found or bound.account_id is distinct from source_account or bound.phone is distinct from phone or bound.contact_key is distinct from encode(sha256(convert_to(phone,'UTF8')),'hex')
  or not public.icash_seller_memory_enabled(bound.account_id) then return false;end if;
 -- Older originals remain explicitly unknown. A retry arrival cannot renew one.
 if bound.completed_at<cfg.activated_at then return true;end if;
 if bound.completed_at is null or not isfinite(bound.completed_at) or bound.completed_at>clock_timestamp() or jsonb_typeof(p_evidence) is distinct from 'object'
  or p_evidence->>'version' is distinct from 'seller-call-source-v1' or p_evidence->>'conversationId' is distinct from bound.conversation_id
  or p_evidence->>'agentId' is distinct from bound.agent_id
  or (p_evidence->>'status'='done' or p_kind='outbound' and p_evidence->>'status'='failed' and p_evidence->'emptyQuotaRejection'='true'::jsonb
   and p_evidence->'rawTurnCount'='0'::jsonb and p_evidence->>'rawJson'='[]' and bound.result->>'providerFailure'='quota_exceeded'
   and bound.result->'transcript'='[]'::jsonb and bound.result->'durationSeconds'='0'::jsonb) is distinct from true
  or octet_length(p_evidence::text)>600000 then return false;end if;
 -- Invalid content has a durable receipt too. Never silently drop its row.
 if jsonb_typeof(p_evidence->'rawJson')='string' then
  begin raw:=(p_evidence->>'rawJson')::jsonb;exception when others then raw:=null;end;
  if jsonb_typeof(raw)='array' then
   complete:=coalesce(octet_length(p_evidence->>'rawJson')<=262144
    and p_evidence->'rawBytes'=to_jsonb(octet_length(p_evidence->>'rawJson'))
    and p_evidence->>'rawSha256'=encode(sha256(convert_to(p_evidence->>'rawJson','UTF8')),'hex')
    and p_evidence->'rawTurnCount'=to_jsonb(jsonb_array_length(raw)) and jsonb_array_length(raw)<=1000
    and not exists(select 1 from jsonb_array_elements(raw) t where icash_seller_call_source_private.turn_kind(t)='invalid'),false);
   if complete then
    begin started:=(p_evidence->>'startedAt')::timestamptz;exception when others then started:=null;end;
    clocks:=started is not null and isfinite(started) and bound.provider_started_at is not null and isfinite(bound.provider_started_at)
     and started>=date_trunc('seconds',bound.provider_started_at) and started<=bound.completed_at
     and not exists(select 1 from (
      select seconds,required,invalid,max(seconds) over(order by n rows between unbounded preceding and 1 preceding) previous from (
       select n,t->>'role'='user' required,
        t?'time_in_call_secs' and t->'time_in_call_secs'<>'null'::jsonb and jsonb_typeof(t->'time_in_call_secs')<>'number' invalid,
        case when jsonb_typeof(t->'time_in_call_secs')='number' then (t->>'time_in_call_secs')::numeric end seconds
       from jsonb_array_elements(raw) with ordinality x(t,n) where icash_seller_call_source_private.turn_kind(t)='speech'
      ) offsets
     ) x where invalid or required and seconds is null or seconds not between 0 and 600 or seconds<previous
      or case when seconds between 0 and 600 then started+make_interval(secs=>seconds::double precision)>bound.completed_at else false end);
    select coalesce(jsonb_agg(jsonb_build_object('role',t->'role','message',t->'message','seconds',case
     when clocks then coalesce(t->'time_in_call_secs','null'::jsonb) else 'null'::jsonb end) order by n),'[]')
    into turns from jsonb_array_elements(raw) with ordinality x(t,n) where icash_seller_call_source_private.turn_kind(t)='speech';
   end if;
  end if;
 end if;
 source_hash:=encode(sha256(convert_to(p_evidence::text,'UTF8')),'hex');
 insert into icash_seller_call_source_private.sources(kind,source_id,account_id,screening_id,contact_key,conversation_id,agent_id,completed_at,evidence,evidence_hash,content_complete,transcript)
 values(p_kind,p_source,bound.account_id,bound.screening_id,bound.contact_key,bound.conversation_id,bound.agent_id,bound.completed_at,p_evidence,source_hash,complete,turns) on conflict do nothing;
 select * into strict prior from icash_seller_call_source_private.sources where kind=p_kind and source_id=p_source;
 if row(prior.account_id,prior.screening_id,prior.contact_key,prior.conversation_id,prior.agent_id,prior.completed_at,prior.evidence_hash)
  is distinct from row(bound.account_id,bound.screening_id,bound.contact_key,bound.conversation_id,bound.agent_id,bound.completed_at,source_hash) then
  insert into icash_seller_call_source_private.conflicts(kind,source_id,evidence_hash,evidence) values(p_kind,p_source,source_hash,p_evidence) on conflict do nothing;
 end if;
 return true;
end $$;
revoke all on function public.icash_capture_seller_call_source(text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_capture_seller_call_source(text,uuid,jsonb) to service_role;

-- The existing saver remains the authority for original results. Capture and
-- completion commit together, so an unavailable capture cannot strand a new
-- completed result outside the ordinary original-conversation retry path.
create function public.icash_save_live_result_with_source(p_call uuid,p_result jsonb,p_evidence jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare phone text;party text;source_account uuid;
begin
 select c.account_id into source_account from public.icash_live_conversations c where c.id=p_call;
 if not exists(select 1 from icash_seller_call_source_private.policy where id=1 and enabled)
  or source_account is not null and not public.icash_seller_memory_enabled(source_account) then
  perform public.icash_save_live_result(p_call,p_result);return;
 end if;
 select c.party,r.to_phone into party,phone from public.icash_live_conversations c
 join public.icash_call_recordings r on r.account_id=c.account_id and r.operation_key=c.operation_key
  and r.screening_id=c.screening_id and r.contact_key=c.contact_key and r.conversation_id=c.conversation_id and r.agent_id=c.agent_id and r.party='seller'
  and r.contact_key=encode(sha256(convert_to(r.to_phone,'UTF8')),'hex') where c.id=p_call;
 if party is distinct from 'seller' then raise exception 'Original seller result required';end if;
 if phone is null then raise exception 'Original seller recipient required';end if;
 perform pg_advisory_xact_lock(hashtextextended(phone,74));
 perform 1 from public.icash_live_conversations c join public.icash_call_recordings r on r.account_id=c.account_id and r.operation_key=c.operation_key
  where c.id=p_call and c.party='seller' and r.to_phone=phone and r.screening_id=c.screening_id and r.contact_key=c.contact_key
   and r.conversation_id=c.conversation_id and r.agent_id=c.agent_id and r.party='seller' and r.contact_key=encode(sha256(convert_to(r.to_phone,'UTF8')),'hex')
  for update of c for share of r;
 if not found then raise exception 'Original seller recipient changed';end if;
 perform public.icash_save_live_result(p_call,p_result);
 if not public.icash_capture_seller_call_source('outbound',p_call,p_evidence) then raise exception 'Original seller source required';end if;
end $$;
revoke all on function public.icash_save_live_result_with_source(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_save_live_result_with_source(uuid,jsonb,jsonb) to service_role;

alter function public.icash_seller_memory_context(uuid,uuid,text) rename to icash_seller_memory_before_call_source;
revoke all on function public.icash_seller_memory_before_call_source(uuid,uuid,text) from public,anon,authenticated,service_role;
create function public.icash_seller_memory_context(p_account uuid,p_screening uuid,p_phone text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare base jsonb;cfg icash_seller_call_source_private.policy;calls jsonb;conversations jsonb;fingerprint text;complete boolean;cached jsonb;contact text;sms jsonb;text_complete boolean;
begin
 base:=public.icash_seller_memory_before_call_source(p_account,p_screening,p_phone);
 if base is null then return null;end if;
 select * into cfg from icash_seller_call_source_private.policy where id=1;
 if not cfg.enabled then return base;end if;
 contact:=encode(sha256(convert_to(p_phone,'UTF8')),'hex');
 with candidates as (
  select 'outbound'::text kind,c.id,c.account_id,c.screening_id,c.contact_key,c.conversation_id,c.agent_id,c.completed_at,1 priority
  from public.icash_live_conversations c where c.account_id=p_account and c.screening_id=p_screening and c.contact_key=contact
   and c.party='seller' and c.state='complete' and c.operation_key like 'voice:%'
  union all
  select 'inbound',s.id,s.account_id,d.screening_id,s.contact_key,s.conversation_id,s.agent_id,s.call_ended_at,1
  from icash_recorded_reception_private.sessions s join icash_seller_agreement_private.inbound_bindings b on b.session_id=s.id and b.account_id=s.account_id
  join public.icash_deal_files d on d.id=b.deal_id and d.account_id=s.account_id
  join public.icash_text_threads t on t.id=b.thread_id and t.account_id=s.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=s.from_phone
  where s.account_id=p_account and d.screening_id=p_screening and s.contact_key=contact and s.call_ended_at is not null
  union all
  select 'inbound',h.session_id,h.account_id,h.screening_id,h.contact_key,h.conversation_id,s.agent_id,h.completed_at,2
  from icash_seller_memory_private.call_sources h left join icash_recorded_reception_private.sessions s on s.id=h.session_id and s.account_id=h.account_id
  where h.account_id=p_account and h.screening_id=p_screening and h.contact_key=contact
  union all
  select 'inbound',h.session_id,h.account_id,h.screening_id,h.contact_key,h.conversation_id,s.agent_id,h.completed_at,3
  from icash_seller_agreement_private.call_history h left join icash_recorded_reception_private.sessions s on s.id=h.session_id and s.account_id=h.account_id
  where h.account_id=p_account and h.screening_id=p_screening and h.contact_key=contact
 ), originals as (
  select distinct on(kind,id) * from candidates order by kind,id,priority
 ), bounded as (
  select * from originals order by completed_at nulls first,kind,id limit 101
 ), projected as (
  select o.completed_at,o.kind,o.id,jsonb_build_object('sourceId',case o.kind when 'outbound' then 'call:' else 'reception:' end||o.id,
   'conversationId',o.conversation_id,'channel','voice','at',o.completed_at,'startedAt',s.evidence->'startedAt',
   'transcript',coalesce(s.transcript,'[]'),'complete',coalesce(s.content_complete,false) and not exists(select 1 from icash_seller_call_source_private.conflicts c where c.kind=o.kind and c.source_id=o.id),
   'sourceCoverage',case when s.source_id is null then 'missing' when exists(select 1 from icash_seller_call_source_private.conflicts c where c.kind=o.kind and c.source_id=o.id) then 'conflict' when not s.content_complete then 'invalid' else 'verified' end,
   'rawSha256',s.evidence->'rawSha256','rawTurnCount',s.evidence->'rawTurnCount') body
  from bounded o left join icash_seller_call_source_private.sources s on s.kind=o.kind and s.source_id=o.id and s.account_id=o.account_id
   and s.screening_id=o.screening_id and s.contact_key=o.contact_key and s.conversation_id=o.conversation_id and s.agent_id=o.agent_id and s.completed_at=o.completed_at
   and isfinite(o.completed_at) and o.completed_at<=now()
 ) select coalesce(jsonb_agg(body order by completed_at,kind,id),'[]') into calls from projected;
 complete:=jsonb_array_length(calls)<=100 and not exists(select 1 from jsonb_array_elements(calls) c where c->>'complete' is distinct from 'true');
 select calls||coalesce(jsonb_agg(c),'[]') into conversations from jsonb_array_elements(base->'conversations') c where c->>'channel'<>'voice';
 fingerprint:=encode(sha256(convert_to(jsonb_build_object('conversations',conversations,'callSourceVersion','seller-call-source-v1','callSourceComplete',complete,'cutover',cfg.activated_at)::text,'UTF8')),'hex');
 select projection into cached from icash_seller_memory_private.snapshots where account_id=p_account and screening_id=p_screening and contact_key=contact
  and source_fingerprint=fingerprint and extractor_version='seller-memory-v1';
 select c into sms from jsonb_array_elements(base->'conversations') c where c->>'channel'='sms';
 text_complete:=coalesce((sms->>'receiptSourceComplete')::boolean,false);
 -- Prior workers cannot enforce raw clock uncertainty and persistent source holds.
 -- Exact v1 readers derive completeness from callSourceComplete and the validated SMS object.
 return base||jsonb_build_object('fingerprint',fingerprint,'cached',cached,'conversations',conversations,'callSourceVersion','seller-call-source-v1','callSourceComplete',complete,'callSourceCutover',cfg.activated_at,
  'complete',jsonb_array_length(calls)=0 and text_complete and complete and not exists(select 1 from jsonb_array_elements(sms->'transcript') t where t->>'questionUnverified'='true'),
  'receiptSourceComplete',jsonb_array_length(calls)=0 and text_complete and complete);
end $$;
revoke all on function public.icash_seller_memory_context(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_memory_context(uuid,uuid,text) to service_role;
revoke all on all functions in schema icash_seller_call_source_private from public,anon,authenticated,service_role;

-- Pin the installed source and privileges inside the runner transaction.
do $result$
declare expected record;actual record;
begin
 for expected in select * from (values
  ('public.icash_capture_seller_call_source(text,uuid,jsonb)','b4ca46d37504f33e691c816ac645857b',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_save_live_result_with_source(uuid,jsonb,jsonb)','750098bec1e8953c6e184fd7c959f74a',true,'v','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_save_live_result(uuid,jsonb)','82af3a7c40a85cb346ad37f571b3fdca',false,'v','{postgres=X/postgres,service_role=X/postgres}'),
  ('public.icash_seller_memory_before_call_source(uuid,uuid,text)','06ebfc0098dc2e86f0cd0d902617116e',true,'s','{postgres=X/postgres}'),
  ('public.icash_seller_memory_context(uuid,uuid,text)','3aa28aa3e791861975e1fba6da67db2b',true,'s','{postgres=X/postgres,service_role=X/postgres}'),
  ('icash_seller_call_source_private.immutable()','6a1477dd4749d14942a8e015a4aa2258',false,'v','{postgres=X/postgres}'),
  ('icash_seller_call_source_private.policy_guard()','927d2db7d00ac3c4aae72c233852aa9f',false,'v','{postgres=X/postgres}'),
  ('icash_seller_call_source_private.turn_kind(jsonb)','98bb98b591c2857b34ad7bd521ff5d15',false,'i','{postgres=X/postgres}')
 ) x(signature,hash,definer,volatility,acl) loop
  select md5(pg_get_functiondef(oid)) hash,pg_get_userbyid(proowner) owner,prosecdef,provolatile::text volatility,proparallel,proconfig,proacl::text acl
  into actual from pg_proc where oid=expected.signature::regprocedure;
  if actual.hash is distinct from expected.hash or actual.owner is distinct from 'postgres' or actual.prosecdef is distinct from expected.definer
   or actual.volatility is distinct from expected.volatility or actual.proparallel is distinct from 'u'
   or actual.proconfig is distinct from array['search_path=""'] or actual.acl is distinct from expected.acl
  then raise exception 'Seller call source result changed: %',expected.signature;end if;
 end loop;
 if (select count(*) from icash_seller_call_source_private.policy)<>1
  or exists(select 1 from icash_seller_call_source_private.policy where enabled or activated_at is not null or release_sha is not null)
  or exists(select 1 from icash_seller_call_source_private.sources) or exists(select 1 from icash_seller_call_source_private.conflicts)
  or exists(select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='icash_seller_call_source_private' and c.relkind='r' and not c.relrowsecurity)
  or exists(select 1 from information_schema.role_table_grants where table_schema='icash_seller_call_source_private' and grantee in ('PUBLIC','anon','authenticated','service_role'))
  or has_schema_privilege('anon','icash_seller_call_source_private','usage') or has_schema_privilege('authenticated','icash_seller_call_source_private','usage')
  or has_schema_privilege('service_role','icash_seller_call_source_private','usage')
 then raise exception 'Seller call source private storage changed';end if;
end $result$;
