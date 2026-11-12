-- Fixed seller replies are continuations, not new cold introductions. This only
-- classifies sender capacity; every original consent, route and money claim runs.
begin;
set local lock_timeout='3s';
set local statement_timeout='30s';
create function icash_sender_private.reply_source(m public.icash_text_messages,t public.icash_text_threads)
returns uuid language sql stable set search_path='' as $$
 with candidates as (
  select w.source_id id from public.icash_seller_limited_text_replies w
   where w.message_id=m.id and w.account_id=t.account_id and w.thread_id=t.id
    and m.request_key=w.source_id and m.body=w.body
  union
  select w.source_id from public.icash_seller_text_replies w
   where w.message_id=m.id and w.account_id=t.account_id and w.thread_id=t.id
    and m.request_key=w.id and m.body=w.body
  union
  select o.owner_reply_id from public.icash_sms_seller_openings o
   where o.interest_message_id=m.id and o.account_id=t.account_id and o.thread_id=t.id
    and m.request_key=o.owner_reply_id
    and exists(select 1 from public.icash_text_messages sent where sent.id=o.owner_question_id
     and sent.account_id=t.account_id and sent.thread_id=t.id and sent.direction='outgoing'
     and sent.state in ('accepted','delivered') and sent.provider_id is not null)
 ), verified as (
  select distinct r.id from candidates c
  join public.icash_text_messages r on r.id=c.id and r.account_id=t.account_id and r.thread_id=t.id
  join public.icash_text_events e on e.id=r.event_id
  where m.account_id=t.account_id and m.thread_id=t.id and m.direction='outgoing' and t.party='seller'
   and r.direction='incoming' and r.state='received' and r.created_at between m.created_at-interval '30 days' and m.created_at
   and e.type in ('text.incoming.sms','text.incoming.mms') and e.payload->>'id'=e.id and e.payload->>'type'=e.type
   and case when jsonb_typeof(e.payload->'timestamp')='number' then (e.payload->>'timestamp')::numeric
    between extract(epoch from m.created_at-interval '30 days') and extract(epoch from m.created_at)+5 else false end
   and e.payload#>>'{data,from}'=t.recipient and e.payload#>>'{data,to}'=t.sender
   and e.payload#>>'{data,body}'=r.body and length(btrim(r.body))>0
   and coalesce((e.payload->'optOut')='true'::jsonb,false)=false
   and public.icash_seller_response_disposition(r.body) is null
   and r.body !~* '(auto(matic|mated)?[ -]?(reply|response|message)|out of (the )?office|message (blocking|undeliverable)|wrong (person|number))'
   and not exists(select 1 from public.icash_text_suppressions s where s.phone=t.recipient)
 ) select min(id::text)::uuid from verified having count(*)=1
$$;
revoke all on function icash_sender_private.reply_source(public.icash_text_messages,public.icash_text_threads) from public,anon,authenticated;
grant execute on function icash_sender_private.reply_source(public.icash_text_messages,public.icash_text_threads) to service_role;

-- Keep the live claim chain and provider-unknown protection intact. The source
-- message can share now() with its reply when both are inserted in one webhook.
-- It is not a later reply; any other equal-time or later message still holds work.
do $patch$
declare d text; signature text; needle text; replacement text;
begin
 for signature,needle,replacement in values
 ('icash_sender_private.transactional(public.icash_text_messages,public.icash_text_threads)',
  ' or exists(select 1 from public.icash_text_ai_jobs j',
  E' or icash_sender_private.reply_source(m,t) is not null\n or exists(select 1 from public.icash_text_ai_jobs j'),
 ('icash_sender_private.property_dispatch()',
  'newer.id<>new.id and newer.created_at>=new.created_at',
  'newer.id<>new.id and newer.created_at>=new.created_at and newer.id is distinct from icash_sender_private.reply_source(new,t)'),
 ('public.icash_next_sender_volume_retry()',
  'newer.id<>m.id and newer.created_at>=m.created_at',
  'newer.id<>m.id and newer.created_at>=m.created_at and newer.id is distinct from icash_sender_private.reply_source(m,t)')
 loop
  d:=pg_get_functiondef(signature::regprocedure);
  if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Source reply pacing prerequisite changed: %',signature;end if;
  execute replace(d,needle,replacement);
 end loop;
end $patch$;
-- No historical send is replayed, no hold is cleared, and no credits are changed.
commit;
