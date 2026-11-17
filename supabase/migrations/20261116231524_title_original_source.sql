-- Runner-owned transaction. Preserve original provider evidence on new replies only.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);

do $pins$
declare target record;actual text;metadata jsonb;
begin
 for target in select * from (values
  ('public.icash_record_title_reply(uuid,text,uuid,text,text,text,boolean)','7099858010d088ee8a70b57e2741e9ac','v')
 ) p(signature,source_hash,volatility) loop
  select md5(pg_get_functiondef(oid)),jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatility',provolatile,'parallel',proparallel,'config',proconfig,'acl',proacl::text)
  into actual,metadata from pg_proc where oid=target.signature::regprocedure;
  if actual is distinct from target.source_hash or metadata is distinct from jsonb_build_object('owner','postgres','definer',false,'volatility',target.volatility,'parallel','u','config',array['search_path=""'],'acl','{postgres=X/postgres,service_role=X/postgres}') then raise exception 'Title inbound predecessor changed: %',target.signature;end if;
 end loop;
end $pins$;

create schema icash_title_inbound_private;
revoke all on schema icash_title_inbound_private from public,anon,authenticated,service_role;
grant usage on schema icash_title_inbound_private to service_role;
create sequence icash_title_inbound_private.source_revision;
alter table public.icash_title_replies add column original_source jsonb not null default '{}' check(jsonb_typeof(original_source)='object');
-- Missing/invalid provider evidence keeps normal inbox review. Only this new
-- capture path assigns revisions; legacy calls contain no new source evidence.
create function icash_title_inbound_private.original_source(p_source jsonb,p_text text) returns jsonb
language plpgsql security definer set search_path='' as $function$
declare original_at timestamptz;complete boolean:=false;event_id text;
begin
 if jsonb_typeof(p_source)='object' then
  begin
   if p_source->>'providerReceivedAt' ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$' then original_at:=(p_source->>'providerReceivedAt')::timestamptz;end if;
  exception when others then original_at:=null;end;
  if jsonb_typeof(p_source->'webhookEventId')='string' and length(p_source->>'webhookEventId') between 1 and 200 then event_id:=p_source->>'webhookEventId';end if;
  complete:=p_source->'bodyComplete'='true'::jsonb and p_text is not null and length(p_text)<=20000
   and p_source->>'bodySha256'=encode(sha256(convert_to(p_text,'UTF8')),'hex');
 end if;
 return jsonb_build_object('version',1,'revision',nextval('icash_title_inbound_private.source_revision'),
  'providerReceivedAt',original_at,'webhookEventId',event_id,'bodyComplete',coalesce(complete,false),
  'bodySha256',case when complete then p_source->>'bodySha256' else null end);
end $function$;
revoke all on function icash_title_inbound_private.original_source(jsonb,text) from public,anon,authenticated;
grant execute on function icash_title_inbound_private.original_source(jsonb,text) to service_role;

-- Retain the original recorder and derive only this new evidence-bearing entry point.
do $recording$
declare definition text;old_signature text;new_signature text;old_insert text;new_insert text;
begin
 definition:=pg_get_functiondef('public.icash_record_title_reply(uuid,text,uuid,text,text,text,boolean)'::regprocedure);
 old_signature:='public.icash_record_title_reply(p_email uuid, p_kind text, p_reference uuid, p_sender text, p_subject text, p_text text, p_authenticated boolean)';
 new_signature:='public.icash_record_title_reply_source(p_email uuid, p_kind text, p_reference uuid, p_sender text, p_subject text, p_text text, p_authenticated boolean, p_source jsonb)';
 old_insert:=$old$insert into public.icash_title_replies(provider_email_id,account_id,deal_id,request_id,qualification_id,sender,subject,body_text,sender_verified)
 values(p_email,a,d,r,q,left(p_sender,320),left(p_subject,500),left(p_text,20000),verified) on conflict(provider_email_id) do nothing;$old$;
 new_insert:=$new$insert into public.icash_title_replies(provider_email_id,account_id,deal_id,request_id,qualification_id,sender,subject,body_text,sender_verified,original_source)
 values(p_email,a,d,r,q,left(p_sender,320),left(p_subject,500),left(p_text,20000),verified,
  case when verified and p_kind='T' then icash_title_inbound_private.original_source(p_source,p_text)||jsonb_build_object(
   'providerEmailId',p_email,'accountId',a,'dealId',d,'requestId',r,'sender',left(p_sender,320),
   'subjectSha256',encode(sha256(convert_to(left(p_subject,500),'UTF8')),'hex')) else '{}'::jsonb end) on conflict(provider_email_id) do nothing;$new$;
 if (length(definition)-length(replace(definition,old_signature,'')))/length(old_signature)<>1
 or (length(definition)-length(replace(definition,old_insert,'')))/length(old_insert)<>1 then raise exception 'Title source recording boundary changed';end if;
 definition:=replace(replace(definition,old_signature,new_signature),old_insert,new_insert);
 execute definition;
end $recording$;
revoke all on function public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb) from public,anon,authenticated;
grant execute on function public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb) to service_role;
create function icash_title_inbound_private.immutable_original_source() returns trigger language plpgsql set search_path='' as $function$
begin
 if new.original_source is distinct from old.original_source then raise exception 'Original title email source is immutable';end if;
 return new;
end $function$;
create trigger icash_title_original_source_immutable before update of original_source on public.icash_title_replies for each row execute function icash_title_inbound_private.immutable_original_source();
revoke all on function icash_title_inbound_private.immutable_original_source() from public,anon,authenticated,service_role;

do $result$
declare target record;actual text;metadata jsonb;
begin
 for target in select * from (values
  ('public.icash_record_title_reply(uuid,text,uuid,text,text,text,boolean)','7099858010d088ee8a70b57e2741e9ac'),
  ('public.icash_record_title_reply_source(uuid,text,uuid,text,text,text,boolean,jsonb)','0f5dd97500fd3b3b096e166bd4096928')
 ) p(signature,source_hash) loop
  select md5(pg_get_functiondef(oid)),jsonb_build_object('owner',pg_get_userbyid(proowner),'definer',prosecdef,'volatility',provolatile,'parallel',proparallel,'config',proconfig,'acl',proacl::text)
  into actual,metadata from pg_proc where oid=target.signature::regprocedure;
  if actual is distinct from target.source_hash or metadata is distinct from jsonb_build_object('owner','postgres','definer',false,'volatility','v','parallel','u','config',array['search_path=""'],'acl','{postgres=X/postgres,service_role=X/postgres}') then raise exception 'Title inbound result source or metadata changed: %',target.signature;end if;
 end loop;
end $result$;
