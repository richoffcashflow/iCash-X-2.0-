-- Remaining historical attention and receipt-bound reception context consumers.
-- Install after both carrier notice foundation and response projections.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

-- Hide only an exact saved incoming notice, never resolve the routing hold.
create view public.icash_response_sms_route_reviews with(security_invoker=true) as
 select q.* from public.icash_sms_route_reviews q where not exists(
  select 1 from public.icash_text_messages m where m.id=q.message_id and m.account_id=q.account_id
   and m.thread_id is null and m.direction='incoming' and public.icash_is_carrier_text_notice(m.body,m.attachments));
-- Text attention is a canonical handoff source. Unknown/mixed/other sources and
-- older genuine handoffs whose summary differs from the notice stay visible.
create view public.icash_response_handoffs with(security_invoker=true) as
 select h.* from public.icash_handoffs h where not exists(
  select 1 from public.icash_text_attention a
  join public.icash_text_messages m on m.id=a.message_id and m.account_id=a.account_id and m.thread_id=a.thread_id
  where a.id=h.text_attention_id and a.account_id=h.account_id and a.screening_id=h.screening_id and a.party=h.party
   and h.conversation_id is null and h.closing_setup_id is null and h.portal_journey_id is null
   and a.kind='human' and h.summary=left(a.quote,6000) and a.quote=left(m.body,1000)
   and m.direction='incoming' and public.icash_is_carrier_text_notice(m.body,m.attachments));
revoke all on public.icash_response_sms_route_reviews,public.icash_response_handoffs from public,anon,authenticated;
grant select on public.icash_response_sms_route_reviews,public.icash_response_handoffs to service_role;

do $patch$
declare signature text;definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_sms_route_review_items(uuid,integer,integer)'::regprocedure);
 needle:='from public.icash_sms_route_reviews q';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  or position('m.id=q.message_id and m.account_id=q.account_id and m.thread_id is null' in definition)=0
  or position('order by q.created_at,q.message_id limit' in definition)=0
 then raise exception 'Carrier route review projection prerequisite changed';end if;
 execute replace(definition,needle,'from public.icash_response_sms_route_reviews q');

 -- Only the incoming/name history source is changed. The original raw outgoing
 -- invitation proof, nonce, account, permissions and suppression checks stay.
 foreach signature in array array[
  'public.icash_inbound_property_context(text,text,text,text)',
  'public.icash_reception_property_context(text,text,text)',
  'public.icash_recorded_reception_context_before_buyer(uuid,text)'
 ] loop
  definition:=pg_get_functiondef(signature::regprocedure);
  needle:='from (select m.id,m.created_at,m.body from public.icash_text_messages m';
  if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
   or position('m.thread_id=bound_thread and m.direction=''incoming'' and m.state=''received''' in definition)=0
   or position('order by m.created_at desc,m.id desc limit 12' in definition)=0
  then raise exception 'Carrier reception name history prerequisite changed: %',signature;end if;
  execute replace(definition,needle,'from (select m.id,m.created_at,m.body from public.icash_response_text_messages m');
 end loop;
 definition:=pg_get_functiondef('public.icash_reception_context_before_agreement(uuid,text)'::regprocedure);
 needle:='from public.icash_text_messages m where m.account_id=r.account_id and m.thread_id=(matches->0->>''thread_id'')::uuid';
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1
  or position('order by m.created_at desc,m.id desc limit 12' in definition)=0
 then raise exception 'Carrier reception conversation history prerequisite changed';end if;
 definition:=replace(definition,needle,replace(needle,'public.icash_text_messages','public.icash_response_text_messages'));
 needle:=$old$'body',left(m.body,1000),'at',m.created_at$old$;
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Carrier reception message shape changed';end if;
 execute replace(definition,needle,$new$'body',left(m.body,1000),'attachments',m.attachments,'at',m.created_at$new$);
end $patch$;
-- These are source projections, not notification dispatch or contact controls.
-- Existing claim and final authorization continue re-reading exact source versions.
do $patch$
declare signature text;definition text;source text;expected integer;counts integer[];
begin
 for signature,counts in select * from (values
  ('public.icash_prioritized_work(uuid,integer)',array[1,1,1]),
  ('public.icash_attention_sources_before_journey(uuid)',array[1,1,2]),
  ('public.icash_attention_sources(uuid)',array[0,1,0])
 ) targets(signature,counts) loop
  -- Notification support may be absent in earlier installations. Do not enable
  -- it here; when present its exact retained source reader must also match.
  if signature like 'public.icash_attention_sources%' and to_regprocedure('public.icash_attention_sources(uuid)') is null then continue;end if;
  definition:=pg_get_functiondef(signature::regprocedure);
  foreach source in array array['icash_text_attention','icash_handoffs','icash_sms_call_requests'] loop
   expected:=counts[array_position(array['icash_text_attention','icash_handoffs','icash_sms_call_requests'],source)];
   if (length(definition)-length(replace(definition,'public.'||source,'')))/length('public.'||source)<>expected
    then raise exception 'Carrier attention source prerequisite changed: %, %',signature,source;end if;
   definition:=replace(definition,'public.'||source,'public.'||case source
    when 'icash_text_attention' then 'icash_response_text_attention'
    when 'icash_handoffs' then 'icash_response_handoffs'
    when 'icash_sms_call_requests' then 'icash_response_sms_call_requests' end);
  end loop;
  execute definition;
 end loop;
end $patch$;
commit;
