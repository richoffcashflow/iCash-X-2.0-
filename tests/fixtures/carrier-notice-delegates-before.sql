-- Exact current retained public SQL predecessors, verified 2026-11-08.
-- Schema code only; no customer records, credentials or provider execution.
CREATE OR REPLACE FUNCTION public.icash_seller_reply_before_viewings(p_account uuid, p_job uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;m public.icash_text_messages;ctx jsonb;a text;b text;reply text;kind text;callback_context boolean;photos boolean;complete_time boolean;requested_date date;date_parts text[];photos_seen boolean;photos_asked boolean;call_asked boolean;f jsonb;
begin
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 if not found or j.state not in ('drafted','queued') then return null;end if;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 ctx:=public.icash_seller_conversation_context(p_account,t.id);if ctx is null then return null;end if;
 select * into m from public.icash_text_messages where id=j.message_id and thread_id=t.id and account_id=p_account and direction='incoming' and state='received';
 if not found or length(m.body)>=1000 or m.created_at>now() then return null;end if;
 if not exists(select 1 from public.icash_sms_routes where sender=t.sender and recipient=t.recipient and account_id=p_account and not needs_review and revision=m.route_revision) then return null;end if;
 if exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.account_id=p_account and x.id<>m.id and x.id is distinct from j.outgoing_id and x.created_at>=m.created_at) then return null;end if;
 b:=lower(trim(m.body));a:=j.analysis->>'action';
 if j.analysis->'humanRequested'='true'::jsonb or j.analysis->'callbackRequested'='true'::jsonb or j.analysis->'optedOut'='true'::jsonb or j.analysis->'declined'='true'::jsonb
  or public.icash_seller_conversation_human(m.body) or public.icash_text_signal(m.body,'seller') in ('declined','withdrawal')
  or b ~ '(\m(stop|unsubscribe|remove me|leave me alone|wrong number|not interested|no thanks)\M|don(''|’)t (call|text|contact)|do not (call|text|contact))'
  or b ~ '\m(ignore (previous|all|the)|system prompt|developer message|wire|bank account|deposit|lawsuit|attorney|sign (the|a)|accept (the|your|my)|agree (to|on))\M' then return null;end if;
 if jsonb_typeof(j.analysis->'facts') is distinct from 'array' or jsonb_array_length(j.analysis->'facts')>8 then return null;end if;
 for f in select value from jsonb_array_elements(j.analysis->'facts') loop
  if f->>'kind' not in ('condition','price','timing','owners','occupancy','callback','photos') or f->>'kind' is null
   or length(coalesce(f->>'quote','')) not between 1 and 500
   or not exists(select 1 from public.icash_text_messages source where source.account_id=p_account and source.thread_id=t.id and source.direction='incoming' and source.state='received' and source.created_at<=m.created_at and source.body=f->>'quote') then return null;end if;
 end loop;
 photos:=jsonb_typeof(m.attachments)='array' and jsonb_array_length(m.attachments)>0;
 photos_seen:=exists(select 1 from public.icash_text_messages source where source.thread_id=t.id and source.account_id=p_account and source.direction='incoming' and source.state='received' and source.created_at<=m.created_at and jsonb_typeof(source.attachments)='array' and jsonb_array_length(source.attachments)>0);
 photos_asked:=exists(select 1 from public.icash_text_ai_jobs prior where prior.account_id=p_account and prior.thread_id=t.id and prior.id<>j.id and prior.outgoing_id is not null and (prior.analysis->>'action'='ask_photos' or prior.analysis->>'conversationNextQuestion'='photos'));
 call_asked:=exists(select 1 from public.icash_text_ai_jobs prior where prior.account_id=p_account and prior.thread_id=t.id and prior.id<>j.id and prior.outgoing_id is not null and (prior.analysis->>'action' in ('ask_callback','ask_callback_details') or prior.analysis->>'conversationNextQuestion'='callback'));

 callback_context:=public.icash_text_signal(m.body,'seller')='callback' or b ~ '\m(missed (your|the) call|couldn(''|’)t answer|could not answer|sorry i missed (it|you))\M'
  or exists(select 1 from public.icash_text_ai_jobs prior join public.icash_text_messages sent on sent.id=prior.outgoing_id and sent.account_id=prior.account_id and sent.thread_id=prior.thread_id
   where prior.account_id=p_account and prior.thread_id=t.id and prior.id<>j.id and (prior.analysis->>'action' in ('ask_callback','ask_callback_details') or prior.analysis->>'conversationNextQuestion'='callback')
   and sent.state in ('accepted','delivered') and sent.provider_id is not null and sent.created_at<m.created_at)
  or exists(select 1 from public.icash_text_messages sent where sent.thread_id=t.id and sent.account_id=p_account and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.provider_id is not null and sent.created_at<m.created_at
    and sent.body in ('When is a good time to talk about a cash offer?','What date, time, and time zone work for a callback?'));
 if a='call_unavailable' then
  return public.icash_seller_sms_call_failure_reply(p_account,m.id);
 elsif a='call_now' then
  if not public.icash_seller_sms_call_current(p_account,m.id) or not exists(
   select 1 from public.icash_voice_jobs v join public.icash_call_recordings r on r.voice_job_id=v.id and r.account_id=v.account_id
   where v.account_id=p_account and v.sms_source_message_id=m.id and r.call_sid is not null and r.call_ended_at is null) then return null;end if;
  return 'Calling you now.';
 elsif a='reply_identity' then
  if not public.icash_seller_identity_question(m.body) and b !~ '(who (is|are)|who''s|whos|what company|what business|how did you get|where did you get|why (are you|did you)|are you (a |an )?(human|real person|bot|ai|robot)|is this (a |an )?(human|real person|bot|ai|robot))' then return null;end if;
  if b ~ '(are you|is this).*(human|real person|bot|ai|robot|automated)' then
   reply:='I am '||(ctx->>'assistantName')||', the AI assistant for '||(ctx->>'principal')||'. I can help with your property inquiry.';
  elsif exists(select 1 from public.icash_text_messages sent where sent.account_id=p_account and sent.thread_id=t.id and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.provider_id is not null and sent.created_at<m.created_at and (sent.body ilike '%AI assistant%' or sent.body ilike '%AI for %') and position(ctx->>'principal' in sent.body)>0) then
   reply:='I am '||(ctx->>'assistantName')||', reaching out for '||(ctx->>'principal')||' about a possible cash offer. Your inquiry came through HomeOffer Network.';
  else
   reply:='I am '||(ctx->>'assistantName')||', the AI assistant for '||(ctx->>'principal')||'. Your property inquiry came through HomeOffer Network.';
  end if;
 elsif a='explain_process' then
  if b !~ '(how (does|would|will) (this|it|the process) work|what( is|[''’]s|s) the process|what happens next|what do you do|how do you (work|buy))' then return null;end if;
  if not call_asked then reply:='I gather property details for review of a possible cash offer. When is a good time to talk?';
  else reply:='I gather property details for review of a possible cash offer. Any offer would need separate review and agreement.';end if;
 elsif a='explain_price' then
  if b !~ '(how much|what( is|[''’]s|s) (the|your) offer|what (can|would|will) you (offer|pay)|can you (give|offer|pay))' then return null;end if;
  if not exists(select 1 from jsonb_array_elements(j.analysis->'facts') x where x->>'kind'='price') then
   reply:='A possible cash offer needs a property review first. What price did you have in mind?';
  else reply:='A possible cash offer needs a property review first. An asking price alone is not an agreed offer.';end if;
 elsif a='photo_received' then
  if not coalesce(photos,false) then return null;end if;
  if not call_asked and not exists(select 1 from jsonb_array_elements(j.analysis->'facts') x where x->>'kind'='callback') then
   reply:='Thanks for sending those for review. When is a good time to talk about a possible cash offer?';
  else reply:='Thanks for sending those. They still need review.';end if;
 elsif a='ask_callback_details' or a='acknowledge_callback' then
  if not coalesce(callback_context,false) or b ~ '\m(don(''|’)t|do not|never|cancel|stop)\M' then return null;end if;
  -- Require an explicit year and a real calendar date. Relative or invalid
  -- dates stay a clarification; we never normalize them into a booking.
  requested_date:=null;
  begin
   requested_date:=substring(b from '\m([0-9]{4}-[0-9]{2}-[0-9]{2})\M')::date;
   if requested_date is null then
    date_parts:=regexp_match(b,'\m(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?) ([0-9]{1,2}),? ([0-9]{4})\M');
    if date_parts is not null then
     requested_date:=make_date(date_parts[3]::integer,array_position(array['jan','feb','mar','apr','may','jun','jul','aug','sep','oct','nov','dec'],left(date_parts[1],3)),date_parts[2]::integer);
    end if;
   end if;
  exception when datetime_field_overflow or invalid_datetime_format then requested_date:=null;
  end;
  complete_time:=requested_date is not null and requested_date>=current_date
   and b ~ '\m(1[0-2]|[1-9])(:[0-5][0-9])? ?(am|pm)\M'
   and b ~ '\m(est|edt|cst|cdt|mst|mdt|pst|pdt|et|ct|mt|pt|utc|eastern|central|mountain|pacific)\M'
   and exists(select 1 from jsonb_array_elements(j.analysis->'facts') x where x->>'kind'='callback' and x->>'quote'=m.body);
  if a='acknowledge_callback' and coalesce(complete_time,false) then
   if not photos_seen and not photos_asked then
    reply:='That call time still needs confirmation. Could you text a few recent photos of the property?';
   else reply:='Thanks for sharing your requested call time. It still needs confirmation and no call is booked yet.';end if;
  else
   if b ~ '\m(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\M' and b !~ '\m[0-9]{1,2}(:[0-9]{2})? ?(am|pm)\M' then reply:='What time works for you?';
   elsif b ~ '\m[0-9]{1,2}(:[0-9]{2})? ?(am|pm)\M' and b !~ '\m(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[0-9]{4}-[0-9]{2}-[0-9]{2})\M' then reply:='Does that time work today or tomorrow?';
   elsif b ~ '\m[0-9]{1,2}(:[0-9]{2})? ?(am|pm)\M' then reply:='What time zone are you in?';
   else reply:='Are you free for a quick call now, or would later work better?';end if;
  end if;
 elsif a='ask_callback' then
  if call_asked or exists(select 1 from jsonb_array_elements(j.analysis->'facts') x where x->>'kind'='callback') then return null;end if;
  reply:='When is a good time to talk about a possible cash offer?';
 elsif a='ask_photos' then
  if photos_seen or photos_asked then return null;end if;
  reply:='Could you text a few recent photos of the property, including any areas that need repairs?';
 else
  kind:=case a when 'ask_condition' then 'condition' when 'ask_price' then 'price' when 'ask_timing' then 'timing' when 'ask_owners' then 'owners' when 'ask_occupancy' then 'occupancy' end;
  if kind is null then return null;end if;
  if exists(select 1 from jsonb_array_elements(j.analysis->'facts') x where x->>'kind'=kind) then return null;end if;
  reply:=case a when 'ask_condition' then 'Thanks for the details. What repairs or updates does the property need?'
   when 'ask_price' then 'What price did you have in mind?'
   when 'ask_timing' then 'When would you ideally like to sell?'
   when 'ask_owners' then 'Are all property owners on board with selling?'
   when 'ask_occupancy' then 'Is the property vacant, owner occupied, or rented?' end;
 end if;
 -- Mixed unanswered questions/negotiation cannot be silently turned into prompts.
 if a not in ('reply_identity','explain_process','explain_price','ask_callback_details','acknowledge_callback')
  and (position('?' in b)>0 or public.icash_text_signal(m.body,'seller')='callback') then return null;end if;
 -- One question/intent per thread; identity and clarifying dates may be repeated
 -- once when explicitly asked again. A provider-uncertain prior never invites retry.
 if (select count(*) from public.icash_text_ai_jobs prior where prior.thread_id=t.id and prior.account_id=p_account and prior.id<>j.id and prior.outgoing_id is not null and prior.analysis->>'action'=a)>=(case when a in ('reply_identity','ask_callback_details') then 2 else 1 end) then return null;end if;
 -- Preserve the existing one-segment ASCII policy, including its exact alphabet.
 if length(reply)>160 or (reply ~ '[^A-Za-z0-9 .,!?]' and length(reply)>35) then return null;end if;
 return reply;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_manual_handoff_reply(p_account uuid, p_thread uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select exists(
 select 1 from public.icash_text_threads t
 cross join lateral(select id,body from public.icash_text_messages where account_id=p_account and thread_id=t.id and direction='incoming' and state='received' order by created_at desc,id desc limit 1) m
 where t.id=p_thread and t.account_id=p_account and t.paused
 and not exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
 and (public.icash_text_signal(m.body,t.party) in ('human','callback') or exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=t.id and j.message_id=m.id and j.state='handoff' and (j.analysis->>'humanRequested'='true' or j.analysis->>'callbackRequested'='true')))
 );
$function$
;
CREATE OR REPLACE FUNCTION public.icash_prepare_limited_seller_text(p_account uuid, p_thread uuid, p_reply uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;m public.icash_text_messages;d public.icash_deal_files;r public.icash_sms_routes;question public.icash_seller_limited_text_replies;outgoing uuid;reply_action text;reply_body text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account for update;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 select * into m from public.icash_text_messages where id=p_reply and thread_id=t.id and account_id=p_account and direction='incoming' and state='received';
 select * into r from public.icash_sms_routes where sender=t.sender and recipient=t.recipient for update;
 if t.id is null or m.id is null or t.paused or t.manual_only or t.ai_mode<>'auto' or t.retired_at is not null or d.stage<>'draft'
  or not public.icash_seller_limited_contact(p_account,d.screening_id) or r.account_id is distinct from p_account or r.needs_review or r.revision is distinct from m.route_revision
  or m.created_at<now()-interval '15 minutes' or not public.icash_sms_thread_review_current(p_account,t.id,false)
  or not public.icash_outreach_sms_current(p_account) or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused)
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex'))
  or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=(select snapshot->>'propertyId' from public.icash_screening_jobs where id=d.screening_id) and manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=d.screening_id and state<>'resolved') then return null;end if;
 select message_id into outgoing from public.icash_seller_limited_text_replies where source_id=m.id and account_id=p_account;
 if found then return outgoing;end if;
 if exists(select 1 from public.icash_text_messages later where later.thread_id=t.id and later.direction='incoming' and later.created_at>m.created_at)
  or not exists(select 1 from public.icash_sms_seller_openings o join public.icash_text_messages sent on sent.id=o.owner_question_id where o.thread_id=t.id and o.account_id=p_account and sent.state in ('accepted','delivered') and sent.provider_id is not null and sent.created_at<=m.created_at) then return null;end if;
 if lower(m.body) ~ '\m(stop|unsubscribe|quit|not interested|wrong number|not the owner|leave me alone|do not (call|text|contact)|don''t (call|text|contact)|remove me|human|real person)\M' then return null;end if;
 select * into question from public.icash_seller_limited_text_replies where thread_id=t.id and action='ask_payoff';
 if question.message_id is null then
  if lower(trim(m.body)) ~ '^(no|nope|nah|end|cancel)[.! ]*$' then return null;end if;
  reply_action:='ask_payoff';reply_body:='Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?';
 else
  if exists(select 1 from public.icash_seller_limited_text_replies where thread_id=t.id and action='review_received')
   or not exists(select 1 from public.icash_text_messages sent where id=question.message_id and state in ('accepted','delivered') and provider_id is not null and created_at<=m.created_at) then return null;end if;
  reply_action:='review_received';reply_body:='Thanks. We need to review the mortgage and title details before moving forward.';
 end if;
 insert into public.icash_seller_limited_text_replies(account_id,thread_id,source_id,action,body) values(p_account,t.id,m.id,reply_action,reply_body);
 outgoing:=public.icash_queue_text(p_account,t.id,m.id,reply_body,'{}');
 update public.icash_seller_limited_text_replies set message_id=outgoing where source_id=m.id;
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where message_id=m.id and account_id=p_account and state='pending';
 return outgoing;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_text_before_buyer_package(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare opening public.icash_sms_seller_openings;reply public.icash_text_messages;
begin
 -- Human drafts dispatch only from the explicit manual-send endpoint, never a worker retry.
 if exists(select 1 from public.icash_text_messages where id=p_message and account_id=p_account and customer_author_id is not null) then return null;end if;
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into opening from public.icash_sms_seller_openings where interest_message_id=p_message and account_id=p_account;
 if found then
  perform 1 from public.icash_text_threads where id=opening.thread_id and account_id=p_account for update;
  select * into reply from public.icash_text_messages where id=opening.owner_reply_id and thread_id=opening.thread_id and account_id=p_account and direction='incoming' and state='received';
  if reply.id is null or lower(trim(reply.body)) !~ '^(yes|yeah|yep|yes i am|i am|i am the owner|i''m the owner|yes i am the owner|yes that is me|yes that''s me)[.! ,]*$'
   or not exists(select 1 from public.icash_text_messages where id=opening.owner_question_id and thread_id=opening.thread_id and account_id=p_account and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null)
   or exists(select 1 from public.icash_text_messages where thread_id=opening.thread_id and account_id=p_account and direction='incoming' and id<>reply.id and created_at>=reply.created_at)
   or not exists(select 1 from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=opening.thread_id and (body='Would you be interested in selling your property for all cash?' or (body='Would you consider a cash offer?' and exists(select 1 from public.icash_text_threads permitted where permitted.id=opening.thread_id and permitted.account_id=p_account and permitted.seller_intake_id is not null)))) then return null;end if;
 end if;
 return public.icash_claim_text_before_owner_question(p_account,p_message,p_sender);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_claim_text_before_owner_question(p_account uuid, p_message uuid, p_sender text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare invitation public.icash_sms_inbound_invitations;t public.icash_text_threads;m public.icash_text_messages;d public.icash_deal_files;s public.icash_screening_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select th.* into t from public.icash_text_threads th join public.icash_text_messages msg on msg.thread_id=th.id and msg.account_id=th.account_id where msg.id=p_message and msg.account_id=p_account;
 if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return null;end if;
 perform 1 from public.icash_outreach_campaigns where account_id=p_account for share;
 select * into t from public.icash_text_threads where id=t.id and account_id=p_account for update;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=t.id for update;
 if not found or m.state<>'ready' or m.direction<>'outgoing' then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true' for share;
 if not found then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete' for share;
 if not found then return null;end if;

 if exists(select 1 from public.icash_contract_text_deliveries x
  join icash_seller_agreement_private.confirmations c on c.envelope_id=x.envelope_id and c.account_id=x.account_id
  join icash_call_offer_private.offers o on o.account_id=c.account_id and o.deal_id=c.deal_id
  where x.account_id=p_account and x.message_id=p_message)
  and not public.icash_confirmed_seller_contract_text_current(p_account,p_message) then return null;end if;
 if t.party='buyer' then
  if public.icash_buyer_package_data(p_account,d.id) is null then return null;end if;
 else if not public.icash_confirmed_seller_contract_text_current(p_account,p_message) and not public.icash_customer_authored_text(p_account,p_message) and not public.icash_seller_recovery_nonprice_current(p_account,p_message) and not (exists(select 1 from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and analysis->>'offerPolicy'='seller-text-offer-v1') and public.icash_seller_conversation_message_current(p_account,p_message)) and not (public.icash_seller_limited_contact(p_account,s.id) and (exists(select 1 from public.icash_sms_seller_openings opening where opening.thread_id=t.id and opening.owner_question_id=m.id) or m.body='Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?' or public.icash_limited_seller_text_current(p_account,p_message))) and (s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours') then return null;end if; end if;

 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
 and not (
  (public.icash_manual_handoff_reply(p_account,t.id) or public.icash_customer_authored_text(p_account,p_message))
  and not exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account)
  and not exists(select 1 from public.icash_seller_opener_assignments where message_id=p_message and account_id=p_account)
  and not exists(select 1 from public.icash_sms_inbound_invitations where message_id=p_message and account_id=p_account)
 ) then return null;end if;
 if exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account) and not public.icash_seller_conversation_message_current(p_account,p_message)
 and not exists(select 1 from public.icash_text_ai_jobs j join public.icash_text_messages incoming on incoming.id=j.message_id and incoming.account_id=j.account_id and incoming.thread_id=j.thread_id
 where j.account_id=p_account and j.thread_id=t.id and j.outgoing_id=p_message and j.state='queued'
 and t.party='buyer' and t.ai_mode='auto' and not t.paused and t.retired_at is null
 and j.analysis->>'action'='buyer_factual' and j.analysis->>'factualPolicy'='approved-package-v1'
 and incoming.direction='incoming' and incoming.state='received'
 and m.body=public.icash_buyer_factual_text(p_account,t.id,incoming.body)) then return null;end if;
 if t.dnc_checked_at>now() then return null;end if;
 if not public.icash_sms_thread_review_current(p_account,t.id,true) then return null;end if;
 if not public.icash_outreach_sms_current(p_account) then return null;end if;
 select * into invitation from public.icash_sms_inbound_invitations where message_id=p_message and account_id=p_account;
 if found then
  if not public.icash_sms_inbound_campaign_current(p_account) then return null;end if;
  select * into t from public.icash_text_threads where id=invitation.thread_id and account_id=p_account;
  if t.id is null or t.sender<>invitation.sender or t.recipient<>invitation.recipient or t.deal_id<>invitation.deal_id or invitation.expires_at<=now() then return null;end if;
  if not exists(select 1 from public.icash_inbound_voice_routes where called_number=invitation.called_number and business_number=p_sender and enabled and reviewed_until>now() and agent_config_hash is not null) then return null;end if;
  if exists(select 1 from public.icash_text_messages where thread_id=t.id and direction='incoming' and id<>invitation.reply_id and created_at>=(select created_at from public.icash_text_messages where id=invitation.reply_id)) then return null;end if;
 end if;
 return public.icash_claim_text_before_campaign(p_account,p_message,p_sender);
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_seller_text_cadence_current(p_account uuid, p_thread uuid, p_message uuid DEFAULT NULL::uuid, p_followup boolean DEFAULT false)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;d public.icash_deal_files;last_body text;n integer;first_at timestamptz;original_thread uuid;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found then return false;end if;
 if t.party<>'seller' then return true;end if;
 -- Human-authored sends and verified cancellation workflows retain their own
 -- final consent/suppression gates. A draft is never an incoming response.
 if p_message is not null and exists(select 1 from public.icash_text_messages m
  where m.id=p_message and m.thread_id=t.id and m.account_id=p_account
   and (m.customer_author_id is not null or exists(select 1 from public.icash_cancellation_notices c where c.account_id=p_account and c.sms_id=m.id))) then return true;end if;
 -- Requested-contact flows keep their separately verified source-bound sequence.
 -- This field does not grant consent: their existing final evidence gate still runs.
 if t.seller_intake_id is not null and t.operational_contact_id is null then return true;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 if not found then return false;end if;
 -- Continue source-backed human replies and ongoing signed work normally.
 if d.stage not in ('draft','cancelled','closed') then return true;end if;
 if exists(select 1 from public.icash_text_messages m where m.thread_id=t.id and m.account_id=p_account
  and m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null)
  and m.created_at between now()-interval '24 hours' and now()
  and m.body ~ '[[:alnum:]]' and m.body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'
  and public.icash_seller_response_disposition(m.body) is null)
 or exists(select 1 from public.icash_live_conversations c where c.account_id=p_account and c.screening_id=d.screening_id
  and c.contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex') and c.state='complete'
  and c.completed_at between now()-interval '24 hours' and now() and c.conversation_id is not null
  and public.icash_call_has_seller_response(c.result)) then return true;end if;
 -- Natural refusals on another property cannot restart automated cold pursuit.
 select m.body into last_body from public.icash_text_threads other
 join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
 where other.recipient=t.recipient and other.party='seller' and m.direction='incoming'
  and m.state='received' and (m.provider_id is not null or m.event_id is not null)
 order by m.created_at desc,m.id desc limit 1;
 if public.icash_seller_response_disposition(last_body) is not null then return false;end if;
 -- Include every business number, property and account, including retired history.
 -- Unknown or already reserved sends cannot be treated as an unused introduction.
 if exists(select 1 from public.icash_text_threads other
  join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
  left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
   and (m.state in ('dispatching','needs_review') or (m.provider_id is null and o.state in ('reserved','dispatched')))) then return false;end if;
 select count(*),min(sent.at) into n,first_at from (
  select m.thread_id,coalesce(o.dispatched_at,m.created_at) at
  from public.icash_text_threads other
  join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
  left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
  where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
   and (m.provider_id is not null or o.dispatched_at is not null)
  limit 2
 ) sent;
 if n=0 then return not p_followup;end if;
 if n<>1 or not p_followup or first_at>now()-interval '3 days' or first_at<now()-interval '5 days' then return false;end if;
 select m.thread_id into original_thread from public.icash_text_threads other
 join public.icash_text_messages m on m.thread_id=other.id and m.account_id=other.account_id
 left join public.icash_operation_spend o on o.operation_key='text:'||m.id and o.account_id=m.account_id
 where other.recipient=t.recipient and other.party='seller' and m.direction='outgoing' and m.id is distinct from p_message
  and (m.provider_id is not null or o.dispatched_at is not null) limit 1;
 return original_thread=t.id;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_seller_conversation_reply(p_account uuid, p_job uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;m public.icash_text_messages;v public.icash_seller_viewing_availability;
begin
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account and state in ('drafted','queued');
 if not found then return null;end if;
 if public.icash_seller_viewing_context(p_account,j.thread_id) is null then return public.icash_seller_reply_before_viewings(p_account,p_job);end if;
 if j.analysis->'humanRequested'='true'::jsonb or j.analysis->'callbackRequested'='true'::jsonb or j.analysis->'callRequested'='true'::jsonb or j.analysis->'optedOut'='true'::jsonb or j.analysis->'declined'='true'::jsonb then return null;end if;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 select * into m from public.icash_text_messages where id=j.message_id and thread_id=t.id and account_id=p_account and direction='incoming' and state='received';
 if not found or m.created_at>now() or length(m.body)>=1000 or m.body ~* '\m(stop|unsubscribe|human|real person|call me|callback|call back|phone call|talk to|speak to)\M' then return null;end if;
 if not exists(select 1 from public.icash_sms_routes where account_id=p_account and sender=t.sender and recipient=t.recipient and not needs_review and revision=m.route_revision)
 or exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.id<>m.id and x.id is distinct from j.outgoing_id and x.created_at>=m.created_at) then return null;end if;
 select * into v from public.icash_seller_viewing_availability where account_id=p_account and thread_id=t.id and source='text' and source_id=m.id;
 if not found then return null;end if;
 if v.state='available' then return 'Thanks. I saved those seller viewing times. We will confirm a specific visit with you before anyone comes.';
 elsif v.state='withdrawn' then return 'Those seller viewing times are withdrawn. We will confirm new availability with you before arranging a visit.';
 else return 'What exact calendar date, start and end times with AM or PM, and time zone work for a property viewing?';end if;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_prepare_sms_inbound_reply(p_account uuid, p_thread uuid, p_reply uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare t public.icash_text_threads;m public.icash_text_messages;question public.icash_text_messages;opening public.icash_sms_seller_openings;outgoing uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_text_threads candidate_thread join public.icash_deal_files candidate_deal on candidate_deal.id=candidate_thread.deal_id and candidate_deal.account_id=candidate_thread.account_id where candidate_thread.id=p_thread and candidate_thread.account_id=p_account and public.icash_seller_limited_contact(p_account,candidate_deal.screening_id)) then
  return public.icash_prepare_limited_seller_text(p_account,p_thread,p_reply);
 end if;
 select * into opening from public.icash_sms_seller_openings where thread_id=p_thread and account_id=p_account;
 if not found then return public.icash_prepare_sms_reply_before_owner_question(p_account,p_thread,p_reply);end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account for update;
 select * into opening from public.icash_sms_seller_openings where thread_id=t.id and account_id=p_account for update;
 if opening.owner_reply_id=p_reply then return null;end if;
 if opening.interest_message_id is not null then return public.icash_prepare_sms_reply_before_owner_question(p_account,p_thread,p_reply);end if;
 if not public.icash_outreach_sms_current(p_account) or t.party<>'seller' or t.paused or t.ai_mode<>'auto'
  or not public.icash_sms_thread_review_current(p_account,t.id,false)
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 select * into m from public.icash_text_messages where id=p_reply and thread_id=t.id and account_id=p_account and direction='incoming' and state='received';
 if not found then return null;end if;
 select * into question from public.icash_text_messages where id=opening.owner_question_id and account_id=p_account and thread_id=t.id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null;
 if exists(select 1 from public.icash_seller_progress_settings where enabled and dialogue_enabled) then
  select sent.* into question from public.icash_text_messages sent join public.icash_text_ai_jobs j on j.outgoing_id=sent.id and j.account_id=sent.account_id and j.thread_id=sent.thread_id
   where sent.account_id=p_account and sent.thread_id=t.id and sent.direction='outgoing' and sent.state='delivered' and sent.provider_id is not null and sent.created_at<m.created_at
    and j.analysis->>'dialoguePolicy'='seller-dialogue-v1' and j.analysis->>'dialogueAction'='clarify_ownership'
   order by sent.created_at desc,sent.id desc limit 1;
  if not found then select * into question from public.icash_text_messages where id=opening.owner_question_id and account_id=p_account and thread_id=t.id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null;end if;
 end if;
 -- Whole-message answers only. A bare interested reply is not ownership confirmation.
 if question.id is null or m.created_at<question.created_at
  or lower(trim(m.body)) !~ '^(yes|yeah|yep|yes i am|i am|i am the owner|i''m the owner|yes i am the owner|yes that is me|yes that''s me)[.! ,]*$'
  or exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.account_id=p_account and x.id not in (m.id,question.id) and x.created_at>=question.created_at) then return null;end if;
 outgoing:=public.icash_queue_text(p_account,t.id,m.id,case when t.seller_intake_id is not null then 'Would you consider a cash offer?' else 'Would you be interested in selling your property for all cash?' end,'{}');
 update public.icash_sms_seller_openings set owner_reply_id=m.id,interest_message_id=outgoing where thread_id=t.id and account_id=p_account;
 return outgoing;
end $function$
;
