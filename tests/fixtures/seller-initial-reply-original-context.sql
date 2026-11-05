CREATE OR REPLACE FUNCTION public.icash_seller_dialogue_context(p_account uuid, p_message uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare m public.icash_text_messages;t public.icash_text_threads;x public.icash_text_messages;
 prior public.icash_text_messages;prior_action text;prior_anchor text;b text;source_at numeric;
 condition_state text;condition_id uuid;condition_quote text;condition_answer uuid;
 action text;reply text;reason text;facts jsonb;asked jsonb;question text;question_kind text;
 owner_unknown boolean;visit_id uuid;visit_times text;visit_access text;visit_answer uuid;
 attempts integer;context jsonb;attempt_message public.icash_text_messages;
begin
 if not exists(select 1 from public.icash_seller_progress_settings where id=1 and enabled and dialogue_enabled) then return null;end if;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found or length(m.body)>=1000 then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller';
 if not found then return null;end if;
 source_at:=public.icash_sms_reply_time(m.id);
 if source_at>extract(epoch from now()) or exists(select 1 from public.icash_text_messages newer where newer.account_id=p_account and newer.thread_id=t.id and newer.direction='incoming' and newer.state='received' and (public.icash_sms_reply_time(newer.id),newer.id)>(source_at,m.id)) then return null;end if;
 -- A customer's later message owns the conversation; never answer behind it.
 if exists(select 1 from public.icash_text_messages human where human.account_id=p_account and human.thread_id=t.id and human.direction='outgoing' and human.customer_author_id is not null and human.state in ('accepted','delivered') and human.provider_id is not null and extract(epoch from human.created_at)>source_at) then return null;end if;
 for x in select * from public.icash_text_messages where account_id=p_account and thread_id=t.id and direction='incoming' and state='received' and (public.icash_sms_reply_time(id),id)<=(source_at,m.id) order by public.icash_sms_reply_time(id),id loop
  b:=lower(trim(regexp_replace(replace(x.body,'’',chr(39)),'[[:space:]]+',' ','g')));
  prior_action:=null;prior_anchor:=null;
  select sent.* into prior from public.icash_text_messages sent where sent.account_id=p_account and sent.thread_id=t.id and sent.direction='outgoing' and sent.state='delivered' and sent.provider_id is not null and extract(epoch from sent.created_at)<public.icash_sms_reply_time(x.id) order by sent.created_at desc,sent.id desc limit 1;
  if prior.id is not null then
   select j.analysis->>'dialogueAction',j.analysis->>'dialogueAnchor' into prior_action,prior_anchor from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=t.id and j.outgoing_id=prior.id and j.analysis->>'dialoguePolicy'='seller-dialogue-v1';
  end if;
  -- Explicit prohibitions take precedence over a positive-looking fragment.
  if public.icash_seller_direct_response_match(b,'\m(no (assignments?|wholesalers?|middlem(e|a)n)|direct buyers? only|only (the )?(actual|end|direct) buyer|do not assign|don''t assign|won''t (allow|accept) assignments?)\M') then
   condition_state:='direct_only';condition_id:=x.id;condition_quote:=x.body;condition_answer:=x.id;
  elsif condition_id is not null and b ~ '^(yes[, ]+)?(no (agents?|realtors?|brokers?)[,.]? *(but |and )?)?((an? )?assignments? (is |are |would be )?(fine|okay|ok|acceptable|allowed)( with me)?|i (am|''m) (fine|okay|ok) with (an? )?assignments?)[.! ,]*$' then
   condition_state:='resolved';condition_answer:=x.id;
  elsif public.icash_seller_direct_response_match(b,'\m(no (3rd|third)[ -]part(y|ies))\M') then
   if condition_id is null or condition_state='resolved' then condition_id:=x.id;condition_quote:=x.body;end if;
   condition_state:=case when prior_anchor=condition_id::text and prior_action='explain_assignment' then 'unresolved' when prior_anchor=condition_id::text and prior_action='clarify_buyer_condition' then 'explain_assignment' else 'clarify' end;
   condition_answer:=null;
  elsif b ~ '^(i (just |only )?(mean|meant|want) |just |only )?(no agents?|no realtors?|no brokers?)[.! ,]*$'
    or (condition_id is not null and b ~ '\m(don''t|do not) want (to (use|pay) )?(an? )?(agents?|realtors?|brokers?)\M') then
   if condition_id is null then condition_id:=x.id;condition_quote:=x.body;end if;
   condition_state:='explain_assignment';condition_answer:=x.id;
  elsif condition_id is not null and b ~ '(what.*(assignment|assigning)|what do you mean|how.*assignment)' then
   condition_state:='explain_assignment';condition_answer:=x.id;
  elsif condition_id is not null and b ~ '^(yes[, ]+)?(an? )?(assignment|assigning (the )?(purchase )?contract|another buyer) (is |would be )?(fine|okay|ok|acceptable|allowed)( with me)?[.! ,]*$' then
   condition_state:='resolved';condition_answer:=x.id;
  elsif condition_id is not null and prior_anchor=condition_id::text and prior_action='explain_assignment' then
   if b ~ '^(yes|yeah|yep|sure|ok|okay|that is fine|that''s fine|that works|i would|i would consider that)[.! ,]*$' then condition_state:='resolved';condition_answer:=x.id;
   elsif b ~ '^(no|no i would not|i would not|absolutely not)[.! ,]*$' then condition_state:='direct_only';condition_answer:=x.id;
   elsif x.id=m.id then condition_state:='unresolved';condition_answer:=x.id;end if;
  elsif condition_id is not null and prior_anchor=condition_id::text and prior_action='clarify_buyer_condition' and x.id=m.id then
   -- A bare yes cannot answer an either/or question. Explain the concrete option.
   condition_state:='explain_assignment';condition_answer:=x.id;
  end if;
  if b ~ '\m(visit|showing|view the (house|property)|come (see|look))\M' and b !~ '\m(cancel|withdraw|don''t|do not|no visit)\M' and prior_action is distinct from 'ask_visit_details' then
   if visit_id is null or visit_access is not null then visit_id:=x.id;visit_times:=null;visit_access:=null;visit_answer:=null;end if;
  end if;
  if b ~ '\m(cancel|withdraw|no) (the )?(visit|showing)\M' then visit_id:=null;visit_times:=null;visit_access:=null;end if;
  if prior_anchor=visit_id::text and prior_action='ask_visit_details' and visit_times is null and b ~ '\m(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|morning|afternoon|evening|after|before|[0-9]{1,2}(:[0-9]{2})? ?(am|pm))\M' then visit_times:=x.body;visit_answer:=x.id;end if;
  if prior_anchor=visit_id::text and prior_action='ask_visit_access' and visit_access is null then visit_access:=x.body;visit_answer:=x.id;end if;
 end loop;
 b:=lower(trim(regexp_replace(replace(m.body,'’',chr(39)),'[[:space:]]+',' ','g')));
 select coalesce(jsonb_agg(distinct f->>'kind'),'[]') into facts from public.icash_text_ai_jobs j cross join lateral jsonb_array_elements(case when jsonb_typeof(j.analysis->'facts')='array' then j.analysis->'facts' else '[]' end) f
 where j.account_id=p_account and j.thread_id=t.id and exists(select 1 from public.icash_text_messages source where source.account_id=p_account and source.thread_id=t.id and source.direction='incoming' and source.state='received' and public.icash_sms_reply_time(source.id)<=source_at and source.body=f->>'quote');
 select coalesce(jsonb_agg(distinct coalesce(j.analysis->>'dialogueQuestion',j.analysis->>'action')),'[]') into asked from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=t.id and j.outgoing_id is not null and j.message_id<>m.id;
 owner_unknown:=exists(select 1 from public.icash_sms_seller_openings o where o.account_id=p_account and o.thread_id=t.id and o.owner_reply_id is null);
 foreach question_kind in array array['condition','price','timing','owners','occupancy'] loop
  if not facts ? question_kind and not asked ? ('ask_'||question_kind) then
   question:=case question_kind when 'condition' then 'What repairs or updates does the property need?' when 'price' then 'What price did you have in mind?' when 'timing' then 'When would you like to sell?' when 'owners' then 'Are all property owners on board with selling?' when 'occupancy' then 'Is the property vacant, owner occupied, or rented?' end;exit;
  end if;
 end loop;
 if public.icash_seller_response_disposition(m.body) is not null or public.icash_seller_contact_stop(m.body)
  or public.icash_seller_conversation_human(m.body) or b ~ '\m(call me|callback|call back|phone call|ignore (previous|all|the)|system prompt|developer message|wire|bank account|deposit|lawsuit|attorney)\M' then return null;end if;
 if condition_state='direct_only' then reason:='direct_purchase_required';
 elsif condition_state='unresolved' then reason:='buyer_condition_unresolved';
 elsif condition_state='clarify' then
  action:='clarify_buyer_condition';reply:='When you say no third parties, do you mean no agents, or no assigning the purchase contract to another buyer?';
 elsif condition_state='explain_assignment' then
  action:='explain_assignment';reply:='An assignment would let another buyer take over the purchase contract. Would you consider that?';
 elsif owner_unknown and (b ~ '(how much|what.*offer|what.*pay)' or condition_answer=m.id) then
  action:='clarify_ownership';reply:='An offer depends on the property details. Are you the owner of the property we texted about?';
 elsif visit_id is not null and visit_access is not null then reason:='visit_attendee_required';
 elsif visit_id is not null and visit_times is not null then
  action:='ask_visit_access';reply:='Who will be available to provide access at those times? The visit is not booked.';
 elsif visit_id is not null then
  action:='ask_visit_details';reply:='What days and times work for a property visit? A visit still needs confirmation.';
 elsif b ~ '^(any fees|are there (any )?fees|what (are|about) (the )?fees|do i (have to )?pay (any )?fees|who pays (the )?closing costs)[?! .]*$' then
  action:='explain_fees';reply:='Any fees and closing costs must be agreed in writing before you commit.';
 elsif b ~ '(how (does|would|will) (this|it|the process) work|what( is|''s|s) the process|what happens next|what do you do|how do you (work|buy))' then
  action:='explain_process';reply:='We confirm property details, work out a supported offer, then agree on written terms.';
 elsif b ~ '^(how much( for (it|the (house|property)))?|what( is|''s|s) (the|your) offer|what (can|would|will) you (offer|pay)|can you (give me an offer|make an offer))[?! .]*$' then
  action:='explain_price';reply:='An offer depends on the property details and condition.';
 elsif (jsonb_typeof(m.attachments)='array' and jsonb_array_length(m.attachments)>0) or b ~ '(pictures|photos).*(there|zillow)|go to zillow' then
  action:='continue_details';reply:=case when jsonb_array_length(m.attachments)>0 then 'Thanks, I received the photos.' else 'I can continue without new photos.' end;
 elsif condition_state='resolved' and condition_answer=m.id then action:='continue_details';reply:='Thanks for clarifying.';
 elsif position('?' in b)>0 and length(b)<=300 and b !~ '(\$|[0-9]|offer|price|pay|fees|cost|sign|contract|agreement|accept|deal|closing|legal|title|lien)' then
  action:='clarify_question';reply:='Which part would you like me to clarify?';
 end if;
 if action in ('explain_fees','explain_process','explain_price','continue_details') and question is not null and not owner_unknown then reply:=reply||' '||question;
 else question_kind:=null;end if;
 -- No implication that the seller agreed to assignment from an undelivered question.
 -- An uncertain earlier clarification cannot be retried under a new source ID.
 if action is not null then
  select count(*) into attempts from public.icash_text_ai_jobs j join public.icash_text_messages sent on sent.id=j.outgoing_id and sent.account_id=j.account_id and sent.thread_id=j.thread_id
  where j.account_id=p_account and j.thread_id=t.id and j.message_id<>m.id and j.analysis->>'dialoguePolicy'='seller-dialogue-v1' and j.analysis->>'dialogueAction'=action
   and (case when action in ('clarify_buyer_condition','explain_assignment') then j.analysis->>'dialogueAnchor'=condition_id::text when action in ('ask_visit_details','ask_visit_access') then j.analysis->>'dialogueAnchor'=visit_id::text else sent.created_at>now()-interval '24 hours' end);
  if attempts>=(case when action='clarify_question' then 2 else 1 end) then
   select sent.* into attempt_message from public.icash_text_ai_jobs j join public.icash_text_messages sent on sent.id=j.outgoing_id and sent.account_id=j.account_id and sent.thread_id=j.thread_id
    where j.account_id=p_account and j.thread_id=t.id and j.message_id<>m.id and j.analysis->>'dialoguePolicy'='seller-dialogue-v1' and j.analysis->>'dialogueAction'=action
     and (case when action in ('clarify_buyer_condition','explain_assignment') then j.analysis->>'dialogueAnchor'=condition_id::text when action in ('ask_visit_details','ask_visit_access') then j.analysis->>'dialogueAnchor'=visit_id::text else sent.created_at>now()-interval '24 hours' end)
    order by sent.created_at desc,sent.id desc limit 1;
   reason:=case when attempt_message.state in ('accepted','dispatching') and attempt_message.updated_at>now()-interval '15 minutes' then 'clarification_receipt_pending'
    when attempt_message.state in ('failed','undelivered','rejected') then 'clarification_delivery_failed'
    when attempt_message.state<>'delivered' then 'clarification_receipt_unresolved' else 'clarification_already_attempted' end;
   action:=null;reply:=null;
  end if;
 end if;
 context:=jsonb_build_object('action',action,'reply',reply,'reason',reason,'question',case when question_kind is not null then 'ask_'||question_kind end,
  'anchor',case when action in ('clarify_buyer_condition','explain_assignment') then condition_id when action in ('ask_visit_details','ask_visit_access') then visit_id else m.id end,
  'conditionState',condition_state,'conditionId',condition_id,'conditionQuote',condition_quote,'conditionAnswer',condition_answer,'conditionResolved',condition_state='resolved',
  'visitRequest',visit_id,'visitAvailability',visit_times,'visitAccess',visit_access,'visitAnswer',visit_answer,'ownershipUnconfirmed',owner_unknown,
  'receiptMessageId',attempt_message.id,'sourceBody',m.body,'routineQualification',not owner_unknown and length(m.body)<=500 and b !~ '(\?|\m(offer|accept|agree|sign|contract|assignment|third part|3rd part|fees?|costs?|lien|mortgage|title|lawsuit|visit|showing|call|callback)\M)');
 return context;
end $function$;
