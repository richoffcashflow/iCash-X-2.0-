-- Scoped current function predecessors captured read-only on 2026-11-08. No account or message data.

CREATE OR REPLACE FUNCTION public.icash_text_thread_reply_summaries(p_account uuid, p_threads uuid[])
 RETURNS TABLE(thread_id uuid, message_id uuid, preview text, received_at timestamp with time zone, unread_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select t.id,last.id,left(last.body,240),last.created_at,
 (select count(*) from public.icash_text_messages m where m.account_id=p_account and m.thread_id=t.id and m.direction='incoming' and m.state='received'
  and not exists(select 1 from public.icash_text_message_reads r where r.account_id=m.account_id and r.message_id=m.id))
 from public.icash_text_threads t
 join lateral (select m.id,m.body,m.created_at from public.icash_text_messages m where m.account_id=p_account and m.thread_id=t.id
  and m.direction='incoming' and m.state='received' order by m.created_at desc,m.id desc limit 1) last on true
 where t.account_id=p_account and t.retired_at is null and t.id=any(p_threads) and cardinality(p_threads)<=100;
$function$;

CREATE OR REPLACE FUNCTION public.icash_latest_seller_text_thread(p_account uuid, p_deal uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select t.id from public.icash_text_threads t
 left join lateral(select m.created_at,m.id,(r.message_id is null) unread from public.icash_text_messages m
  left join public.icash_text_message_reads r on r.account_id=m.account_id and r.message_id=m.id
  where m.account_id=p_account and m.thread_id=t.id and m.direction='incoming' and m.state='received'
  order by (r.message_id is null) desc,m.created_at desc,m.id desc limit 1) last on true

 left join lateral(select m.created_at,m.id from public.icash_text_messages m
  where m.account_id=p_account and m.thread_id=t.id
  order by m.created_at desc,m.id desc limit 1) activity on true
 where t.account_id=p_account and t.deal_id=p_deal and t.party='seller' and t.retired_at is null
 order by last.unread desc nulls last,last.created_at desc nulls last,last.id desc nulls last,activity.created_at desc nulls last,activity.id desc nulls last,t.id desc limit 1;
$function$;

CREATE OR REPLACE FUNCTION public.icash_workspace_seller_texts(p_account uuid, p_screenings uuid[] DEFAULT NULL::uuid[])
 RETURNS TABLE(screening_id uuid, thread_id uuid, message_id uuid, preview text, received_at timestamp with time zone, unread_count bigint)
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.icash_refresh_opportunity_outcomes(p_account uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare last_refresh timestamptz;
begin
 if p_account is null or not pg_try_advisory_xact_lock(hashtextextended(p_account::text,7319)) then return;end if;
 select refreshed_at into last_refresh from public.icash_opportunity_refreshes where account_id=p_account;
 if last_refresh>now()-interval '20 seconds' then return;end if;
 last_refresh:=coalesce(last_refresh,'-infinity'::timestamptz);
 -- Recompute changed properties only. A growing history must not make every
 -- workspace refresh rescan all transcripts and messages.
 with changed as (
  select s.id from public.icash_screening_jobs s left join public.icash_opportunity_outcomes o on o.screening_id=s.id and o.account_id=s.account_id
   where s.account_id=p_account and s.state='complete' and (o.screening_id is null or s.completed_at>=last_refresh)
  union select c.screening_id from public.icash_live_conversations c left join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
   where c.account_id=p_account and (c.created_at>=last_refresh or c.completed_at>=last_refresh or o.settled_at>=last_refresh)
  union select d.screening_id from public.icash_deal_files d join public.icash_text_threads t on t.account_id=d.account_id and t.deal_id=d.id
   join public.icash_text_messages m on m.account_id=t.account_id and m.thread_id=t.id
   left join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='text:'||m.id
   where d.account_id=p_account and (m.updated_at>=last_refresh or o.settled_at>=last_refresh)
  union select d.screening_id from public.icash_deal_files d join public.icash_seller_email_openers a on a.deal_id=d.id and a.account_id=d.account_id
   join public.icash_deal_emails m on m.account_id=a.account_id and (m.id=a.email_id or m.reply_to_id=a.email_id)
   left join public.icash_operation_spend o on o.account_id=m.account_id and o.operation_key='deal-email:'||m.id
   where d.account_id=p_account and (m.updated_at>=last_refresh or o.settled_at>=last_refresh)
  union select d.screening_id from public.icash_deal_files d join public.icash_signing_envelopes e on e.account_id=d.account_id and e.deal_id=d.id
   where d.account_id=p_account and e.updated_at>=last_refresh
  union select c.screening_id from public.icash_owner_contacts c join public.icash_operation_spend o on o.operation_key=c.operation_key and o.account_id=c.account_id
   where c.account_id=p_account and (c.created_at>=last_refresh or o.settled_at>=last_refresh)
 )
 insert into public.icash_opportunity_outcomes(screening_id,account_id,zip,eligible,discovered_at,attempted,responded,interested,opted_out,purchase_signed,response_at,provider_cost_micros,costs_complete,research_source)
 select s.id,s.account_id,left(s.snapshot->'raw'->'data'->>'zip',5),coalesce(s.result->'financialCheck'->>'status'='eligible',false),s.created_at,
  coalesce(v.attempted,false) or coalesce(t.attempted,false) or coalesce(mail.attempted,false),coalesce(v.responded,false) or coalesce(t.responded,false) or coalesce(mail.responded,false),(coalesce(v.interested,false) or public.icash_filter_sms_interest(p_account,s.id)), coalesce(v.opted_out,false) or coalesce(t.opted_out,false) or coalesce(mail.opted_out,false),coalesce(sig.signed,false),greatest(v.response_at,t.response_at,mail.response_at),coalesce(cost.total,0),coalesce(cost.complete,false),s.event_key like 'discovery:%'
 from public.icash_screening_jobs s join changed on changed.id=s.id
 left join lateral (
  select count(*)>0 attempted,bool_or(c.state='complete' and public.icash_call_has_seller_response(c.result)) responded,
   bool_or(c.state='complete' and public.icash_call_selling_interest(c.result) and public.icash_call_has_seller_response(c.result)) interested,
   bool_or(c.result->'optedOut'='true'::jsonb) opted_out,
   max(c.completed_at) filter(where c.state='complete' and public.icash_call_has_seller_response(c.result)) response_at
  from public.icash_live_conversations c where c.account_id=s.account_id and c.screening_id=s.id and c.party='seller' and c.conversation_id is not null
 ) v on true
 left join lateral (
  select bool_or(m.direction='outgoing' and m.provider_id is not null and m.state in ('accepted','delivered')) attempted,
   bool_or(m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)) responded,
   bool_or(m.direction='incoming' and m.state='received' and public.icash_seller_contact_stop(m.body)) opted_out,
   max(m.created_at) filter(where m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)) response_at
  from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id and t.party='seller'
  join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id
  where d.screening_id=s.id and d.account_id=s.account_id
 ) t on true
 left join lateral (
  select bool_or(m.id=a.email_id and m.direction='outgoing' and m.state='accepted' and m.provider_id is not null) attempted,
   bool_or(m.reply_to_id=a.email_id and m.direction='incoming' and m.state='received' and m.provider_id is not null) responded,
   bool_or(m.reply_to_id=a.email_id and m.direction='incoming' and m.state='received' and m.provider_id is not null
    and lower(trim(split_part(m.body_text,E'\n',1))) ~ '^(unsubscribe|stop|remove me|please unsubscribe|please stop)[.! ]*$') opted_out,
   max(m.created_at) filter(where m.reply_to_id=a.email_id and m.direction='incoming' and m.state='received' and m.provider_id is not null) response_at
  from public.icash_deal_files d join public.icash_seller_email_openers a on a.deal_id=d.id and a.account_id=d.account_id
  join public.icash_deal_emails m on m.account_id=a.account_id and m.deal_id=a.deal_id and lower(m.recipient)=a.recipient and (m.id=a.email_id or m.reply_to_id=a.email_id)
  where d.screening_id=s.id and d.account_id=s.account_id
 ) mail on true
 left join lateral (
  select bool_or(e.state='completed' and not e.test_mode) signed from public.icash_deal_files d
  join public.icash_signing_envelopes e on e.deal_id=d.id and e.account_id=d.account_id and e.kind='purchase'
  where d.screening_id=s.id and d.account_id=s.account_id
 ) sig on true
 left join lateral (
  select sum(o.actual_micros) filter(where o.state='settled')::bigint total,bool_and(o.state='settled') complete
  from public.icash_operation_spend o where o.account_id=s.account_id and (
   o.operation_key='owners:'||s.account_id||':'||s.id or o.operation_key in
   (select c.operation_key from public.icash_live_conversations c where c.account_id=s.account_id and c.screening_id=s.id)
   or o.operation_key in (select 'text:'||m.id from public.icash_deal_files d join public.icash_text_threads t on t.deal_id=d.id and t.account_id=d.account_id join public.icash_text_messages m on m.thread_id=t.id and m.account_id=t.account_id where d.account_id=s.account_id and d.screening_id=s.id)
   or o.operation_key in (select 'deal-email:'||a.email_id from public.icash_deal_files d join public.icash_seller_email_openers a on a.deal_id=d.id and a.account_id=d.account_id where d.account_id=s.account_id and d.screening_id=s.id))
 ) cost on true
 where s.account_id=p_account and s.state='complete'
  and coalesce(s.snapshot->>'practice','false')<>'true' and coalesce(s.snapshot->>'propertyId','') not like 'practice_%'
 on conflict(screening_id) do update set eligible=excluded.eligible,attempted=excluded.attempted,responded=excluded.responded,interested=excluded.interested,opted_out=excluded.opted_out,purchase_signed=excluded.purchase_signed,response_at=excluded.response_at,provider_cost_micros=excluded.provider_cost_micros,costs_complete=excluded.costs_complete,refreshed_at=now();
 insert into public.icash_opportunity_refreshes values(p_account,now()) on conflict(account_id) do update set refreshed_at=excluded.refreshed_at;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_voice_sms_context(p_account uuid, p_permission uuid)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select jsonb_build_object('threadId',t.id,'messages',(
  select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'direction',m.direction,'body',left(m.body,1000),'at',m.created_at) order by m.created_at,m.id),'[]'::jsonb)
  from (select m.id,m.direction,m.body,m.created_at from public.icash_text_messages m
   where m.account_id=p_account and m.thread_id=t.id
    and (m.direction='incoming' and m.state='received' or m.direction='outgoing' and m.state in ('accepted','delivered'))
    and m.created_at>=now()-interval '30 days'
   order by m.created_at desc,m.id desc limit 48) m
 ))
 from public.icash_voice_contact_targets p
 join public.icash_deal_files d on d.screening_id=p.screening_id and d.account_id=p.account_id
 join public.icash_text_threads t on t.deal_id=d.id and t.account_id=p.account_id and t.recipient=p.phone and t.party=p.party
 where p.id=p_permission and p.account_id=p_account and p.party='seller'
  and d.stage not in ('closed','cancelled') and coalesce(d.terms->>'practice','false')<>'true'
 order by t.id limit 1
$function$;
