-- Forward-only receipt chronology projection; no activation or source writes.
-- The caller owns the transaction and migration-ledger commit.
set local lock_timeout='3s';
set local statement_timeout='15s';
select pg_advisory_xact_lock(726341927);
do $patch$
declare prior text;patched text;metadata jsonb;
begin
 select pg_get_functiondef(p.oid),to_jsonb(p)-array['prosrc','xmin','cmin','xmax','cmax','ctid'] into prior,metadata
 from pg_proc p where p.oid='public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure;
 if md5(prior) is distinct from 'f1316a0d62155d6f61426b7419e52cf2'
  or (select pg_get_userbyid(proowner) is distinct from 'postgres' or proacl::text is distinct from '{postgres=X/postgres,service_role=X/postgres}' from pg_proc where oid='public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure)
 then raise exception 'seller memory receipt projection prerequisite changed';end if;
 patched:=prior;
 if length(patched)-length(replace(patched,$old0$complete boolean;cached jsonb;live_calls jsonb;$old0$,''))<>length($old0$complete boolean;cached jsonb;live_calls jsonb;$old0$) then raise exception 'seller memory receipt projection anchor 0 changed';end if;
 patched:=replace(patched,$old0$complete boolean;cached jsonb;live_calls jsonb;$old0$,$new0$complete boolean;cached jsonb;live_calls jsonb;text_count integer;text_source_complete boolean;text_questions_complete boolean;$new0$);
 if length(patched)-length(replace(patched,$old1$ select coalesce(jsonb_agg(jsonb_build_object('role',case m.direction when 'incoming' then 'user' else 'agent' end,
  'message',m.body,'sourceId',m.id,'threadId',m.thread_id,'at',case when m.direction='incoming' then to_timestamp(public.icash_sms_reply_time(m.id)) else m.created_at end)
  order by case when m.direction='incoming' then public.icash_sms_reply_time(m.id) else extract(epoch from m.created_at) end,m.id),'[]') into texts
 from (select m.* from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where t.account_id=p_account and t.deal_id=deal and t.recipient=p_phone and t.party='seller' and t.retired_at is null
  and m.created_at<=now()
  and ((m.direction='incoming' and m.state='received' and public.icash_sms_reply_time(m.id)<=extract(epoch from now()) and (m.provider_id is not null or m.event_id is not null))
    or (m.direction='outgoing' and m.state='delivered' and m.provider_id is not null))
  order by m.created_at,m.id limit 1001) m;
$old1$,''))<>length($old1$ select coalesce(jsonb_agg(jsonb_build_object('role',case m.direction when 'incoming' then 'user' else 'agent' end,
  'message',m.body,'sourceId',m.id,'threadId',m.thread_id,'at',case when m.direction='incoming' then to_timestamp(public.icash_sms_reply_time(m.id)) else m.created_at end)
  order by case when m.direction='incoming' then public.icash_sms_reply_time(m.id) else extract(epoch from m.created_at) end,m.id),'[]') into texts
 from (select m.* from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where t.account_id=p_account and t.deal_id=deal and t.recipient=p_phone and t.party='seller' and t.retired_at is null
  and m.created_at<=now()
  and ((m.direction='incoming' and m.state='received' and public.icash_sms_reply_time(m.id)<=extract(epoch from now()) and (m.provider_id is not null or m.event_id is not null))
    or (m.direction='outgoing' and m.state='delivered' and m.provider_id is not null))
  order by m.created_at,m.id limit 1001) m;
$old1$) then raise exception 'seller memory receipt projection anchor 1 changed';end if;
 patched:=replace(patched,$old1$ select coalesce(jsonb_agg(jsonb_build_object('role',case m.direction when 'incoming' then 'user' else 'agent' end,
  'message',m.body,'sourceId',m.id,'threadId',m.thread_id,'at',case when m.direction='incoming' then to_timestamp(public.icash_sms_reply_time(m.id)) else m.created_at end)
  order by case when m.direction='incoming' then public.icash_sms_reply_time(m.id) else extract(epoch from m.created_at) end,m.id),'[]') into texts
 from (select m.* from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where t.account_id=p_account and t.deal_id=deal and t.recipient=p_phone and t.party='seller' and t.retired_at is null
  and m.created_at<=now()
  and ((m.direction='incoming' and m.state='received' and public.icash_sms_reply_time(m.id)<=extract(epoch from now()) and (m.provider_id is not null or m.event_id is not null))
    or (m.direction='outgoing' and m.state='delivered' and m.provider_id is not null))
  order by m.created_at,m.id limit 1001) m;
$old1$,$new1$ -- Keep raw-source coverage independent of the two rows used for each reply.
 -- A receipt proves delivery, never the relation to a later-ingested answer.
 with raw as materialized (
  select m.* from public.icash_text_messages m
  join public.icash_text_threads t on t.id=m.thread_id and t.account_id=m.account_id
  where t.account_id=p_account and t.deal_id=deal and t.recipient=p_phone and t.party='seller' and t.retired_at is null
   and m.created_at<=now()
   and (m.direction='outgoing' or (m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)))
  order by m.created_at,m.id limit 1001
 ), sourced as materialized (
  select m.*,case when m.direction='incoming' and e.type in ('text.incoming.sms','text.incoming.mms') and jsonb_typeof(e.payload->'timestamp')='number' then
   case when (e.payload->>'timestamp')::numeric>0 and (e.payload->>'timestamp')::numeric<=extract(epoch from now())
    and (e.payload->>'timestamp')::numeric<=extract(epoch from m.created_at)+300
    then to_timestamp((floor((e.payload->>'timestamp')::numeric*1000)/1000)::double precision) end end reply_at,
   encode(sha256(convert_to(jsonb_build_object('source',jsonb_build_object('id',m.id,'thread',m.thread_id,'direction',m.direction,'state',m.state,
    'body',m.body,'provider',m.provider_id,'event',m.event_id,'created',m.created_at,'delivered',m.last_delivery_at),
    'event',jsonb_build_object('id',e.id,'type',e.type,'timestamp',e.payload->'timestamp'))::text,'UTF8')),'hex') receipt_fingerprint
  from raw m left join public.icash_text_events e on e.id=m.event_id
 ), paired as materialized (
  select m.*,q.body question,q.id question_id,
   coalesce(isfinite(q.created_at) and q.state='delivered' and q.provider_id is not null and isfinite(q.last_delivery_at)
    and q.last_delivery_at>=q.created_at and q.last_delivery_at<=now()
    and date_trunc('milliseconds',q.last_delivery_at)<m.reply_at
    and not exists(select 1 from sourced tied where tied.direction='outgoing' and tied.thread_id=m.thread_id and tied.id<>q.id
     and date_trunc('milliseconds',tied.created_at)=date_trunc('milliseconds',q.created_at))
    and not exists(select 1 from sourced older where older.direction='outgoing' and older.thread_id=m.thread_id and older.created_at<q.created_at
     and older.state='delivered' and older.provider_id is not null and older.last_delivery_at>=q.last_delivery_at and older.last_delivery_at<=m.reply_at),false) question_verified
  from sourced m left join lateral (
   select o.* from sourced o where o.direction='outgoing' and o.thread_id=m.thread_id
    and date_trunc('milliseconds',o.created_at)<=m.reply_at
   order by o.created_at desc,o.id desc limit 1
  ) q on m.direction='incoming'
 ), projected as (
  select m.id,coalesce(m.reply_at,m.created_at) at,0 n,jsonb_build_object('role','agent','message',case when m.question_verified then m.question else '' end,
   'sourceId',m.question_id,'threadId',m.thread_id,'at',coalesce(m.reply_at,m.created_at)) body
  from paired m where m.direction='incoming'
  union all
  select m.id,coalesce(m.reply_at,m.created_at),1,jsonb_build_object('role',case when m.direction='incoming' then 'user' else 'agent' end,
   'message',case when m.direction='incoming' then m.body else '' end,'originalMessage',m.body,'sourceId',m.id,'threadId',m.thread_id,
   'at',coalesce(m.reply_at,m.created_at),'questionUnverified',m.direction='incoming' and not m.question_verified,'receiptFingerprint',m.receipt_fingerprint)
  from paired m
 )
 select coalesce((select jsonb_agg(p.body order by p.at,p.id,p.n) from projected p),'[]'),
  (select count(*) from sourced),
  not exists(select 1 from sourced m where m.direction='incoming' and (m.reply_at is null or exists(
   select 1 from sourced tied where tied.direction='incoming' and tied.id<>m.id and tied.reply_at=m.reply_at))),
  not exists(select 1 from paired m where m.direction='incoming' and not m.question_verified)
 into texts,text_count,text_source_complete,text_questions_complete;
$new1$);
 if length(patched)-length(replace(patched,$old2$jsonb_build_object('sourceId','sms','channel','sms','transcript',texts)$old2$,''))<>length($old2$jsonb_build_object('sourceId','sms','channel','sms','transcript',texts)$old2$) then raise exception 'seller memory receipt projection anchor 2 changed';end if;
 patched:=replace(patched,$old2$jsonb_build_object('sourceId','sms','channel','sms','transcript',texts)$old2$,$new2$jsonb_build_object('sourceId','sms','channel','sms','transcript',texts,'receiptProjectionVersion','seller-sms-receipts-v1','rawSourceCount',text_count,'receiptSourceComplete',text_count<=1000 and text_source_complete)$new2$);
 if length(patched)-length(replace(patched,$old3$complete:=jsonb_array_length(texts)<=1000 and jsonb_array_length(calls)<=100$old3$,''))<>length($old3$complete:=jsonb_array_length(texts)<=1000 and jsonb_array_length(calls)<=100$old3$) then raise exception 'seller memory receipt projection anchor 3 changed';end if;
 patched:=replace(patched,$old3$complete:=jsonb_array_length(texts)<=1000 and jsonb_array_length(calls)<=100$old3$,$new3$complete:=text_count<=1000 and text_source_complete and text_questions_complete and jsonb_array_length(calls)<=100$new3$);
 if length(patched)-length(replace(patched,$old4$'fingerprint',fingerprint,'complete',complete,'conversations'$old4$,''))<>length($old4$'fingerprint',fingerprint,'complete',complete,'conversations'$old4$) then raise exception 'seller memory receipt projection anchor 4 changed';end if;
 patched:=replace(patched,$old4$'fingerprint',fingerprint,'complete',complete,'conversations'$old4$,$new4$'fingerprint',fingerprint,'complete',complete,'receiptProjectionVersion','seller-sms-receipts-v1','receiptSourceComplete',text_count<=1000 and text_source_complete and jsonb_array_length(calls)<=100
   and not exists(select 1 from jsonb_array_elements(calls) c where jsonb_array_length(c->'transcript')>1000 or c->>'complete'='false'),'conversations'$new4$);
 if md5(patched) is distinct from '7a680dae86359988c3f70c705a3369b0' then raise exception 'seller memory receipt projection replacement changed';end if;
 execute patched;
 if (select md5(pg_get_functiondef('public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure))) is distinct from '7a680dae86359988c3f70c705a3369b0' then raise exception 'seller memory receipt projection result changed';end if;
 if (select to_jsonb(p)-array['prosrc','xmin','cmin','xmax','cmax','ctid'] from pg_proc p where p.oid='public.icash_seller_memory_context(uuid,uuid,text)'::regprocedure) is distinct from metadata
 then raise exception 'seller memory receipt projection metadata changed';end if;
end $patch$;
