begin;
-- Apply after seller intake contact binding, buyer factual replies and SMS property
-- routing. No permission changes, historical unpausing, provider calls or booking.
-- This lane never sends model prose; the model chooses a bounded question/intent.
create function public.icash_seller_conversation_context(p_account uuid,p_thread uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.icash_text_threads;d public.icash_deal_files;s public.icash_screening_jobs;principal text;assistant text;address text;
begin
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account;
 if not found or t.party<>'seller' or t.seller_intake_id is null or t.paused or t.manual_only or t.ai_mode<>'auto' or t.retired_at is not null then return null;end if;
 select a.assistant_name into assistant from public.icash_accounts a where a.id=p_account and not a.bot_paused;
 if not found then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete';
 -- Financial holds keep their existing limited-contact policy; this is no exception.
 if not found or s.result->'financialCheck'->>'status' is distinct from 'eligible'
  or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours'
  or s.snapshot->'sellerRequest'->>'id' is distinct from t.seller_intake_id::text then return null;end if;
 if public.icash_seller_sms_permission_current(p_account,t.id,false) is distinct from true
  or public.icash_seller_contact_evidence(p_account,d.screening_id,t.seller_intake_id,t.recipient) is null then return null;end if;
 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=s.id and state<>'resolved')
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient) then return null;end if;
 -- Same number-pair CAS as final dispatch; never infer another property's context.
 if not exists(select 1 from public.icash_sms_routes where sender=t.sender and recipient=t.recipient and account_id=p_account and not needs_review) then return null;end if;
 select trim(i.principal) into principal from public.icash_customer_identities i where i.account_id=p_account;
 assistant:=trim(assistant);address:=trim(d.terms->>'address');
 if length(coalesce(principal,'')) not between 1 and 100 or length(coalesce(assistant,'')) not between 1 and 60
  or length(coalesce(address,'')) not between 1 and 300 or address ~ '[[:cntrl:]]'
  or principal ~ '[[:cntrl:]]' or assistant ~ '[[:cntrl:]]' then return null;end if;
 return jsonb_build_object('sellerConversation',true,'principal',principal,'assistantName',assistant,'formContactVerified',true,
  'address',address,'timezone',t.timezone,'offerAuthorized',false);
end $$;

-- Every punctuation-delimited clause must be an identity question. A mixed
-- request for a person is never hidden by an earlier identity question.
create function public.icash_seller_identity_question(p_body text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select count(*) between 1 and 3 and coalesce(bool_and(part ~* '^(who (is this|are you)|who[''’]?s this|what (company|business) is this|(are you|is this) (a |an )?(human( being)?|real person|ai|bot|robot|automated)( or (a |an )?(human( being)?|real person|ai|bot|robot|automated))?)$'),false)
 from (select btrim(value) as part from regexp_split_to_table(coalesce(p_body,''),'[?!.]+') value where btrim(value)<>'') clauses
$$;

create function public.icash_seller_conversation_human(p_body text)
returns boolean language sql immutable security invoker set search_path='' as $$
 select coalesce(not public.icash_seller_identity_question(p_body) and p_body ~* '\m(human|real person|(speak|talk) (to|with) (someone|(a |an |the |your )?(person|manager|owner|supervisor|representative)))\M',false)
$$;

-- A scheduling-looking response to an actually sent call-time question is a
-- pending request for review before any model runs, never a parsed appointment.
create function public.icash_seller_availability_reply(p_account uuid,p_thread uuid,p_body text,p_before timestamptz)
returns boolean language sql stable security invoker set search_path='' as $$
 select coalesce(p_body ~* '\m(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|morning|afternoon|evening|tonight|weekend|after work|next week|available|[0-9]{1,2}(:[0-9]{2})? ?(am|pm))\M',false)
 and exists(select 1 from public.icash_text_messages sent left join public.icash_text_ai_jobs j on j.outgoing_id=sent.id and j.account_id=sent.account_id and j.thread_id=sent.thread_id
  where sent.account_id=p_account and sent.thread_id=p_thread and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.provider_id is not null and sent.created_at<p_before
  and (j.analysis->>'action' in ('ask_callback','ask_callback_details') or j.analysis->>'conversationNextQuestion'='callback'
   or sent.body in ('When is a good time to talk about a cash offer?','What date, time, and time zone work for a callback?')))
$$;

-- Only exact source statements can ground a model-selected action. Fixed copy is
-- recomputed at dispatch, so changing identity, consent, message or route holds it.
create function public.icash_seller_conversation_reply(p_account uuid,p_job uuid)
returns text language plpgsql security invoker set search_path='' as $$
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
 if a='reply_identity' then
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
  else reply:='What exact date including year, time with AM or PM, and time zone would work for a call?';end if;
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
end $$;

create function public.icash_queue_seller_conversation_reply(p_account uuid,p_job uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;m public.icash_text_messages;reply_body text;outgoing uuid;screening uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 if t.id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account for update;
 if j.state<>'drafted' or j.outgoing_id is not null then return null;end if;
 reply_body:=public.icash_seller_conversation_reply(p_account,p_job);if reply_body is null then return null;end if;
 if (select count(*) from public.icash_text_ai_jobs where thread_id=t.id and account_id=p_account and outgoing_id is not null and created_at>now()-interval '1 day')>=12 then return null;end if;
 select * into m from public.icash_text_messages where id=j.message_id and account_id=p_account and thread_id=t.id;
 -- Capture availability verbatim, without manufacturing a date, time zone, booking,
 -- phone permission or promise. New replies reopen the same durable attention item.
 if j.analysis->>'action' in ('ask_callback_details','acknowledge_callback') then
  select screening_id into screening from public.icash_deal_files where id=t.deal_id and account_id=p_account;
  insert into public.icash_text_attention(account_id,thread_id,deal_id,screening_id,message_id,kind,party,quote,timezone)
  values(p_account,t.id,t.deal_id,screening,m.id,'callback','seller',left(m.body,1000),t.timezone)
  on conflict(thread_id,kind) do update set message_id=excluded.message_id,quote=excluded.quote,timezone=excluded.timezone,state='open',updated_at=now();
  insert into public.icash_sms_call_requests(account_id,thread_id,deal_id,screening_id,message_id,requested_at)
  values(p_account,t.id,t.deal_id,screening,m.id,m.created_at)
  on conflict(thread_id) where state='needs_review' do update set message_id=excluded.message_id,requested_at=excluded.requested_at,updated_at=now();
 end if;
 outgoing:=public.icash_queue_text(p_account,t.id,j.id,reply_body,'{}');if outgoing is null then return null;end if;
 update public.icash_text_ai_jobs set outgoing_id=outgoing,state='queued',analysis=analysis||jsonb_build_object('conversationPolicy','bound-seller-v1','conversationNextQuestion',case
  when reply_body='That call time still needs confirmation. Could you text a few recent photos of the property?' then 'photos'
  when reply_body in ('Thanks for sending those for review. When is a good time to talk about a possible cash offer?','I gather property details for review of a possible cash offer. When is a good time to talk?') then 'callback' else null end,'action',case when analysis->>'action'='acknowledge_callback' and reply_body='What exact date including year, time with AM or PM, and time zone would work for a call?' then 'ask_callback_details' else analysis->>'action' end),updated_at=now() where id=j.id;
 return outgoing;
end $$;

create function public.icash_seller_conversation_message_current(p_account uuid,p_message uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;m public.icash_text_messages;expected text;
begin
 select * into j from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and state='queued' and analysis->>'conversationPolicy'='bound-seller-v1';
 if not found then return false;end if;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=j.thread_id and direction='outgoing' and state='ready';
 if not found or not public.icash_sms_message_route_current(p_account,p_message) then return false;end if;
 expected:=public.icash_seller_conversation_reply(p_account,j.id);
 return expected is not null and m.body is not distinct from expected;
end $$;

-- Add the branch before the old campaign invitation/ownership workflow. Eligible
-- form-bound replies therefore have exactly one lane; other sources are unchanged.
do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('public.icash_enqueue_text_ai()'::regprocedure);
 needle:=$old$ if new.direction<>'incoming' or new.account_id is null or new.thread_id is null then return new;end if;$old$;
 replacement:=needle||$new$
 if new.state='received' and public.icash_seller_conversation_context(new.account_id,new.thread_id) is not null then
  update public.icash_text_ai_jobs set state='superseded',updated_at=now() where thread_id=new.thread_id and account_id=new.account_id and state in ('pending','issued','drafted');
  insert into public.icash_text_ai_jobs(account_id,thread_id,message_id) values(new.account_id,new.thread_id,new.id) on conflict(message_id) do nothing;
  return new;
 end if;$new$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 or position('icash_prepare_sms_inbound_reply' in d)=0 then raise exception 'Seller conversation enqueue prerequisite changed';end if;
 execute replace(d,needle,replacement);
 d:=pg_get_functiondef('public.icash_capture_text_signal()'::regprocedure);
 needle:=$old$ k:=public.icash_text_signal(new.body,t.party);$old$;
 replacement:=needle||$new$
 if public.icash_seller_conversation_context(t.account_id,t.id) is not null then
  if public.icash_seller_conversation_human(new.body) then k:='human';
  elsif public.icash_seller_identity_question(new.body) then k:=null;
  elsif k is null and public.icash_seller_availability_reply(t.account_id,t.id,new.body,new.created_at) then k:='callback';end if;
 end if;
 if k='callback' and public.icash_seller_conversation_context(t.account_id,t.id) is not null then
  update public.icash_text_messages set state='cancelled',updated_at=now() where thread_id=t.id and direction='outgoing' and state='ready';
  update public.icash_text_ai_jobs set state='superseded',updated_at=now() where thread_id=t.id and state in ('pending','issued','drafted');
  insert into public.icash_text_attention(account_id,thread_id,deal_id,screening_id,message_id,kind,party,quote,timezone)
  values(t.account_id,t.id,d.id,d.screening_id,new.id,k,t.party,left(new.body,1000),t.timezone)
  on conflict(thread_id,kind) do update set message_id=excluded.message_id,quote=excluded.quote,timezone=excluded.timezone,state='open',updated_at=now();
  insert into public.icash_sms_call_requests(account_id,thread_id,deal_id,screening_id,message_id,requested_at)
  values(t.account_id,t.id,d.id,d.screening_id,new.id,new.created_at)
  on conflict(thread_id) where state='needs_review' do update set message_id=excluded.message_id,requested_at=excluded.requested_at,updated_at=now();
  return new;
 end if;$new$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Seller conversation signal prerequisite changed';end if;
 execute replace(d,needle,replacement);
 -- Keep the buyer exception, all financial restrictions and every existing delegate.
 d:=pg_get_functiondef('public.icash_claim_text_ai(uuid,uuid)'::regprocedure);
 needle:=$old$if exists(select 1 from public.icash_outreach_campaigns where account_id=p_account and mode='sms_inbound')$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 or position('icash_claim_text_ai_before_campaign' in d)=0 then raise exception 'Seller conversation analysis prerequisite changed';end if;
 execute replace(d,needle,needle||$new$ and not exists(select 1 from public.icash_text_ai_jobs j where j.id=p_job and j.account_id=p_account and public.icash_seller_conversation_context(p_account,j.thread_id) is not null)$new$);
 d:=pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure);
 needle:=$old$if exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account)$old$;
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 or position('return public.icash_claim_text_before_campaign' in d)=0 then raise exception 'Seller conversation dispatch prerequisite changed';end if;
 execute replace(d,needle,needle||$new$ and not public.icash_seller_conversation_message_current(p_account,p_message)$new$);
end $patch$;

alter function public.icash_claim_text_ai(uuid,uuid) rename to icash_claim_text_ai_before_seller_conversation;
create function public.icash_claim_text_ai(p_account uuid,p_job uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;ctx jsonb;result jsonb;history jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 ctx:=public.icash_seller_conversation_context(p_account,j.thread_id);
 -- A stale seller continuation job cannot fall into a less strict legacy path.
 if exists(select 1 from public.icash_text_threads where id=j.thread_id and account_id=p_account and seller_intake_id is not null) and ctx is null then return null;end if;
 result:=public.icash_claim_text_ai_before_seller_conversation(p_account,p_job);
 if result is null or ctx is null then return result;end if;
 select jsonb_agg(jsonb_build_object('direction',direction,'body',left(body,1000),'attachmentCount',case when jsonb_typeof(attachments)='array' then jsonb_array_length(attachments) else 0 end) order by created_at,id) into history
 from (select id,direction,body,attachments,created_at from public.icash_text_messages where thread_id=j.thread_id and account_id=p_account and ((direction='incoming' and state='received') or (direction='outgoing' and state in ('accepted','delivered') and provider_id is not null)) order by created_at desc,id desc limit 24) recent;
 return jsonb_set(jsonb_set(result,'{context}',coalesce(result->'context','{}')||ctx),'{messages}',coalesce(history,'[]'));
end $$;

alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_seller_conversation;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text)
returns jsonb language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and analysis->>'conversationPolicy'='bound-seller-v1')
  and not public.icash_seller_conversation_message_current(p_account,p_message) then return null;end if;
 return public.icash_claim_text_before_seller_conversation(p_account,p_message,p_sender);
end $$;
-- Existing immediate calls must wait for scheduling review without forcing the
-- SMS thread into human/manual mode. Acknowledging an attention notification is
-- not resolution of this durable request. Cancellations also block old automatic
-- calls, even before their first claim. Held jobs are never auto-reopened here;
-- restarting a canceled call requires a separately reviewed workflow.
create function public.icash_seller_callback_voice_pending(p_job uuid)
returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.icash_voice_jobs j
  join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id and p.party='seller' and p.seller_intake_id is not null
  join public.icash_deal_files d on d.account_id=p.account_id and d.screening_id=p.screening_id
  join public.icash_text_threads t on t.account_id=p.account_id and t.deal_id=d.id and t.party='seller' and t.recipient=p.phone and t.seller_intake_id=p.seller_intake_id
  join public.icash_sms_call_requests r on r.account_id=t.account_id and r.thread_id=t.id and r.deal_id=d.id and r.screening_id=p.screening_id and r.state in ('needs_review','canceled')
  join public.icash_text_messages source on source.id=r.message_id and source.account_id=t.account_id and source.thread_id=t.id and source.direction='incoming' and source.state='received'
  where j.id=p_job)
 -- An unassigned multi-property reply must not let a previously queued first
 -- call ignore a possible timing/cancellation request. Hold the same account's
 -- consented seller phone without assigning those words to either property.
 or exists(select 1 from public.icash_voice_jobs j
  join public.icash_contact_permissions p on p.id=j.permission_id and p.account_id=j.account_id and p.party='seller' and p.seller_intake_id is not null
  join public.icash_sms_routes r on r.account_id=p.account_id and r.recipient=p.phone and r.needs_review
  where j.id=p_job)
$$;
alter function public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb) rename to icash_claim_reviewed_voice_before_seller_timing;
create function public.icash_claim_reviewed_voice_job(p_job uuid,p_offer_snapshot jsonb default null,p_buyer_snapshot jsonb default null)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if public.icash_seller_callback_voice_pending(p_job) then
  update public.icash_voice_jobs set state='held',outcome='seller_callback_time_pending_review',updated_at=now() where id=p_job and state in ('ready','issued');
  return false;
 end if;
 return public.icash_claim_reviewed_voice_before_seller_timing(p_job,p_offer_snapshot,p_buyer_snapshot);
end $$;
alter function public.icash_claim_limited_seller_voice(uuid,jsonb) rename to icash_claim_limited_seller_before_timing;
create function public.icash_claim_limited_seller_voice(p_job uuid,p_snapshot jsonb)
returns boolean language plpgsql security invoker set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if public.icash_seller_callback_voice_pending(p_job) then
  update public.icash_voice_jobs set state='held',outcome='seller_callback_time_pending_review',updated_at=now() where id=p_job and state in ('ready','issued');
  return false;
 end if;
 return public.icash_claim_limited_seller_before_timing(p_job,p_snapshot);
end $$;
revoke all on function public.icash_claim_limited_seller_voice(uuid,jsonb),public.icash_claim_limited_seller_before_timing(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.icash_claim_limited_seller_voice(uuid,jsonb),public.icash_claim_limited_seller_before_timing(uuid,jsonb) to service_role;
revoke all on function public.icash_seller_identity_question(text),public.icash_seller_availability_reply(uuid,uuid,text,timestamptz),public.icash_seller_callback_voice_pending(uuid),public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb),public.icash_claim_reviewed_voice_before_seller_timing(uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.icash_seller_identity_question(text),public.icash_seller_availability_reply(uuid,uuid,text,timestamptz),public.icash_seller_callback_voice_pending(uuid),public.icash_claim_reviewed_voice_job(uuid,jsonb,jsonb),public.icash_claim_reviewed_voice_before_seller_timing(uuid,jsonb,jsonb) to service_role;
revoke all on function public.icash_seller_conversation_context(uuid,uuid),public.icash_seller_conversation_human(text),public.icash_seller_conversation_reply(uuid,uuid),public.icash_queue_seller_conversation_reply(uuid,uuid),public.icash_seller_conversation_message_current(uuid,uuid),public.icash_claim_text_ai(uuid,uuid),public.icash_claim_text_ai_before_seller_conversation(uuid,uuid),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_seller_conversation(uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.icash_seller_conversation_context(uuid,uuid),public.icash_seller_conversation_human(text),public.icash_seller_conversation_reply(uuid,uuid),public.icash_queue_seller_conversation_reply(uuid,uuid),public.icash_seller_conversation_message_current(uuid,uuid),public.icash_claim_text_ai(uuid,uuid),public.icash_claim_text_ai_before_seller_conversation(uuid,uuid),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_seller_conversation(uuid,uuid,text) to service_role;
commit;
