-- Response projections only. Install after carrier-text-notice-classification.sql.
-- Original messages, provider receipts, costs, suppressions and authority stay intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Filter the complete source before unread counts, ranking, pagination or history
-- limits. Fail closed if a reviewed predecessor changed rather than losing guards.
do $patch$
declare signature text;definition text;expected integer;
begin
 for signature,expected in select * from (values
  ('public.icash_text_thread_reply_summaries(uuid,uuid[])',2),
  ('public.icash_latest_seller_text_thread(uuid,uuid)',2),
  ('public.icash_workspace_seller_texts(uuid,uuid[])',1)
 ) targets(signature,expected) loop
  definition:=pg_get_functiondef(signature::regprocedure);
  if (length(definition)-length(replace(definition,'public.icash_text_messages','')))/length('public.icash_text_messages')<>expected
   or position('m.account_id=p_account' in definition)=0 and position('m.account_id=t.account_id' in definition)=0
  then raise exception 'Carrier response projection prerequisite changed: %',signature;end if;
  execute replace(definition,'public.icash_text_messages','public.icash_response_text_messages');
 end loop;
end $patch$;

-- Only response evidence changes in the regular cache refresh. In particular,
-- incoming STOP, all outgoing attempts and all original costs keep raw sources.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_refresh_opportunity_outcomes(uuid)'::regprocedure);
 needle:=$old$m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>2
  or position('public.icash_call_has_seller_response(c.result)' in definition)=0
  or position('coalesce(mail.responded,false)' in definition)=0
  or position('pg_try_advisory_xact_lock(hashtextextended(p_account::text,7319))' in definition)=0
 then raise exception 'Carrier outcome refresh prerequisite changed';end if;
 execute replace(definition,needle,needle||' and not public.icash_is_carrier_text_notice(m.body,m.attachments)');

 definition:=pg_get_functiondef('public.icash_voice_sms_context(uuid,uuid)'::regprocedure);
 needle:='select m.id,m.direction,m.body,m.created_at from public.icash_text_messages m';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  or position('limit 48' in definition)=0 or position('public.icash_voice_contact_targets p' in definition)=0
 then raise exception 'Carrier voice history prerequisite changed';end if;
 definition:=replace(definition,needle,'select m.id,m.direction,m.body,m.attachments,m.created_at from public.icash_response_text_messages m');
 -- Preserve attachment presence so the defensive context boundary cannot hide
 -- a genuine image reply whose caption happens to contain notice wording.
 needle:=$old$'body',left(m.body,1000),'at',m.created_at$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Carrier voice message shape changed';end if;
 execute replace(definition,needle,$new$'body',left(m.body,1000),'attachments',m.attachments,'at',m.created_at$new$);
end $patch$;

-- Existing response caches must be corrected before the next page/count query,
-- not merely marked stale. This is a bounded, source-bound derived-field repair.
-- Never rewrite immutable learning/experiment/promotion or provider evidence.
create temporary table carrier_notice_affected on commit drop as
 select distinct o.account_id,o.screening_id from public.icash_opportunity_outcomes o
 join public.icash_deal_files d on d.account_id=o.account_id and d.screening_id=o.screening_id
 join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id and t.party='seller'
 join public.icash_text_messages m on m.account_id=t.account_id and m.thread_id=t.id
 where m.direction='incoming' and m.state='received' and public.icash_is_carrier_text_notice(m.body,m.attachments)
 limit 10001;
do $locks$
declare account uuid;
begin
 if (select count(*) from carrier_notice_affected)>10000 then raise exception 'Carrier response repair exceeds reviewed row bound';end if;
 -- Serialize with the existing refresh writer before reading source evidence.
 -- If another writer is active, abort instead of overwriting a newer refresh.
 for account in select distinct account_id from carrier_notice_affected order by account_id loop
  if not pg_try_advisory_xact_lock(hashtextextended(account::text,7319)) then raise exception 'Carrier response refresh is busy';end if;
 end loop;
end $locks$;

with responses as (
 select affected.account_id,affected.screening_id,
  coalesce(v.responded,false) or coalesce(t.responded,false) or coalesce(mail.responded,false) responded,
  greatest(v.response_at,t.response_at,mail.response_at) response_at
 from carrier_notice_affected affected
 left join lateral (
  select bool_or(c.state='complete' and public.icash_call_has_seller_response(c.result)) responded,
   max(c.completed_at) filter(where c.state='complete' and public.icash_call_has_seller_response(c.result)) response_at
  from public.icash_live_conversations c where c.account_id=affected.account_id and c.screening_id=affected.screening_id
   and c.party='seller' and c.conversation_id is not null
 ) v on true
 left join lateral (
  select bool_or(m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)) responded,
   max(m.created_at) filter(where m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)) response_at
  from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
  join public.icash_response_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where d.screening_id=affected.screening_id and d.account_id=affected.account_id
 ) t on true
 left join lateral (
  select bool_or(m.reply_to_id=a.email_id and m.direction='incoming' and m.state='received' and m.provider_id is not null) responded,
   max(m.created_at) filter(where m.reply_to_id=a.email_id and m.direction='incoming' and m.state='received' and m.provider_id is not null) response_at
  from public.icash_deal_files d join public.icash_seller_email_openers a on a.deal_id=d.id and a.account_id=d.account_id
  join public.icash_deal_emails m on m.account_id=a.account_id and m.deal_id=a.deal_id and lower(m.recipient)=a.recipient and (m.id=a.email_id or m.reply_to_id=a.email_id)
  where d.screening_id=affected.screening_id and d.account_id=affected.account_id
 ) mail on true
)
update public.icash_opportunity_outcomes o set responded=r.responded,response_at=r.response_at
from responses r where o.account_id=r.account_id and o.screening_id=r.screening_id
 and (o.responded is distinct from r.responded or o.response_at is distinct from r.response_at);

-- Only affected accounts rescan through the existing source recomputation path.
-- The same advisory lock prevents a newer refresh cursor from being overwritten.
update public.icash_opportunity_refreshes r set refreshed_at='-infinity'::timestamptz
where exists(select 1 from carrier_notice_affected a where a.account_id=r.account_id);
insert into public.icash_workspace_revisions(account_id)
select distinct account_id from carrier_notice_affected
on conflict(account_id) do update set revision=public.icash_workspace_revisions.revision+1,changed_at=now();
commit;
