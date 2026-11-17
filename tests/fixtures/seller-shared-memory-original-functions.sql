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
 owner_unknown:=not public.icash_seller_has_cash_question(p_account,t.id) and exists(select 1 from public.icash_sms_seller_openings o where o.account_id=p_account and o.thread_id=t.id and o.owner_reply_id is null);
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
 elsif exists(select 1 from icash_learning_policy_private.cash_question_settings where id=1 and enabled_at<=m.created_at and enabled_at<=now())
  and public.icash_seller_current_cash_identity_reply(p_account,m.id,(select public.icash_conversation_street(d.terms->>'address') from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account)) is not null then
  action:='cash_identity_v6';reply:=public.icash_seller_current_cash_identity_reply(p_account,m.id,(select public.icash_conversation_street(d.terms->>'address') from public.icash_deal_files d where d.id=t.deal_id and d.account_id=p_account));
 elsif public.icash_seller_post_call_identity_reply(p_account,m.id) is not null then
  owner_unknown:=true;action:='clarify_ownership';reply:=public.icash_seller_post_call_identity_reply(p_account,m.id);
 elsif b ~ '^(please |can you |could you )?text me( instead| please)?[.! ]*$'
   and public.icash_seller_voice_text_wait_call(p_account,m.id) is not null then
  reason:='voice_call_receipt_pending';
 elsif exists(select 1 from public.icash_text_ai_jobs wait_job where wait_job.account_id=p_account and wait_job.message_id=m.id
  and wait_job.analysis->'voiceReceiptWait' is not null and wait_job.analysis->'voiceReceiptWait'<>'null'::jsonb)
  and (not public.icash_seller_voice_text_context(p_account,m.id)
   or not exists(select 1 from public.icash_seller_progress_settings settings where settings.id=1 and settings.voice_text_enabled_at<=m.created_at and extract(epoch from settings.voice_text_enabled_at)<=source_at)) then
  reason:='voice_call_receipt_unresolved';
 elsif b ~ '^(please |can you |could you )?text me( instead| please)?[.! ]*$'
   and exists(select 1 from public.icash_seller_progress_settings settings where settings.id=1
    and settings.voice_text_enabled_at is not null and m.created_at>=settings.voice_text_enabled_at
    and source_at>=extract(epoch from settings.voice_text_enabled_at))
   and public.icash_seller_voice_text_context(p_account,m.id) then
  owner_unknown:=true;action:='clarify_ownership';
  reply:='Text is fine. Are you the owner of the property we called about?';
 elsif owner_unknown
   and b ~ '^(please |can you |could you )?text me( instead| please)?[.! ]*$|^(sorry[, ]+)?i (can''t|cannot|can not) talk( right now| now)?[.! ]*$'
   and exists(select 1 from public.icash_seller_progress_settings settings where settings.id=1
    and settings.initial_reply_enabled_at is not null
    and m.created_at>=settings.initial_reply_enabled_at
    and source_at>=extract(epoch from settings.initial_reply_enabled_at))
   and exists(select 1 from public.icash_sms_seller_openings opening
    join public.icash_text_messages question_message on question_message.id=opening.owner_question_id
     and question_message.account_id=p_account and question_message.thread_id=t.id
     and question_message.direction='outgoing' and question_message.state='delivered'
     and question_message.provider_id is not null
     and extract(epoch from question_message.created_at)<source_at
    where opening.account_id=p_account and opening.thread_id=t.id and opening.owner_reply_id is null
     and not exists(select 1 from public.icash_text_messages later
      where later.account_id=p_account and later.thread_id=t.id and later.direction='outgoing'
       and later.state in ('accepted','delivered','dispatching')
       and later.id<>question_message.id
       and later.created_at>question_message.created_at and extract(epoch from later.created_at)<source_at)) then
  action:='clarify_ownership';
  reply:=case when b ~ 'text me' then 'Text is fine. Are you the owner of the property we texted about?'
   else 'No problem. Reply here when you are free. Are you the owner of the property we texted about?' end;
 elsif public.icash_seller_conversion_source(p_account,m.id) and public.icash_seller_conversion_intent(m.body) is not null then
  -- The offer planner answers identity/purpose and resumes the actual next fact.
  action:=null;reply:=null;
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
  'visitRequest',visit_id,'visitAvailability',visit_times,'visitAccess',visit_access,'visitAnswer',visit_answer,'ownershipUnconfirmed',owner_unknown or public.icash_seller_has_cash_question(p_account,t.id),'initialQuestionKind',case when public.icash_seller_has_cash_question(p_account,t.id) then 'cash_interest' else 'ownership' end,
  'receiptMessageId',attempt_message.id,'sourceBody',m.body,'routineQualification',not owner_unknown and length(m.body)<=500 and b !~ '(\?|\m(offer|accept|agree|sign|contract|assignment|third part|3rd part|fees?|costs?|lien|mortgage|title|lawsuit|visit|showing|call|callback)\M)');
 return context;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_seller_conversion_intent(p_body text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare b text:=lower(trim(regexp_replace(replace(replace(coalesce(p_body,''),'’',chr(39)),'‘',chr(39)),'[[:space:]]+',' ','g')));identity_question boolean;price_question boolean;
begin
 if b='' or length(b)>500 or public.icash_seller_response_disposition(b) is not null
  or b ~ '["“”]' or b ~ '\y(?:said|asked|wrote|example|ignore|instructions?|prompt|wire|bank account)\y' then return null;end if;
 identity_question:=b ~ $pattern$(?:^|[.!?;,] +|\yand +)(?:who (?:is this|are you)|who's this|what (?:is your name|company is this|business is this)|do you have a name)(?: exactly)?(?:[?!.,;]| +and\y| *$)$pattern$;
 price_question:=b ~ $pattern$(?:^|[.!?;,] +|\yand +)(?:what amount do you have in mind|what (?:price|amount) (?:are you offering|would you offer)|depends on (?:the|your) (?:offer|price)|(?:it )?depends (?:on )?(?:the|your) (?:offer|price))(?:[?!.,; ]|$)$pattern$
  or identity_question and b ~ '\y(?:how much|what.*offer|what.*pay)\y';
 if identity_question then return case when price_question then 'identity_price' else 'identity' end;end if;
 if price_question then return 'price';end if;
 if b ~ '^(?:are you (?:looking to (?:buy|purchase)|(?:buying|purchasing)(?: (?:it|the (?:house|property)))?)|(?:buying|purchasing))[?! .]*$' then return 'buying';end if;
 if b ~ '^(?:the )?(?:price|terms)(?: are)? as (?:listed|advertised)[.! ]*$' then return 'listed_terms';end if;
 return null;
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_seller_text_offer_context(p_account uuid, p_message uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare m public.icash_text_messages;t public.icash_text_threads;d public.icash_deal_files;s public.icash_screening_jobs;
 j public.icash_text_ai_jobs;o icash_call_offer_private.offers;dialogue jsonb;messages jsonb;c jsonb;source_at numeric;principal text;owner_id uuid;mail text;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found or (m.event_id is null and m.provider_id is null) then return null;end if;
 source_at:=public.icash_sms_reply_time(m.id);
 if not exists(select 1 from public.icash_seller_progress_settings where enabled and offer_enabled and offer_enabled_at is not null and source_at>=extract(epoch from offer_enabled_at))
  or source_at not between extract(epoch from now()-interval '24 hours') and extract(epoch from now()) then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller' and not paused and not manual_only and ai_mode='auto' and retired_at is null;
 if not found or public.icash_sms_thread_review_current(p_account,t.id,false) is distinct from true or not public.icash_outreach_sms_current(p_account) then return null;end if;
 select a.owner_user_id,u.email into owner_id,mail from public.icash_accounts a join auth.users u on u.id=a.owner_user_id where a.id=p_account and not a.bot_paused and u.email_confirmed_at is not null;
 if not found then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';if not found then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete' and completed_at between now()-interval '24 hours' and now();
 if not found or public.icash_automatic_cash_offer_price(s.snapshot) is null or s.snapshot->'raw'->'data'->>'full_address' is distinct from d.terms->>'address' then return null;end if;
 select i.principal into principal from public.icash_customer_identities i where i.account_id=p_account;
 if principal is null or principal is distinct from d.terms->>'buyer' then return null;end if;
 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_conversations where account_id=p_account and deal_id=d.id and human_takeover)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=s.id and state<>'resolved')
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=d.id and kind='purchase' and not test_mode)
  or not exists(select 1 from public.icash_sms_routes where account_id=p_account and sender=t.sender and recipient=t.recipient and not needs_review and revision=m.route_revision) then return null;end if;
 select * into j from public.icash_text_ai_jobs where message_id=m.id and account_id=p_account and thread_id=t.id;
 if j.id is not null and (j.state not in ('pending','issued','drafted','queued') or j.provider_id is not null or j.usage is not null) then return null;end if;
 if exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.direction='incoming' and x.state='received' and (public.icash_sms_reply_time(x.id),x.id)>(source_at,m.id))
  or exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.direction='outgoing' and x.id is distinct from j.outgoing_id and extract(epoch from x.created_at)>source_at) then return null;end if;
 if public.icash_seller_response_disposition(m.body) is not null or public.icash_seller_contact_stop(m.body) or public.icash_seller_conversation_human(m.body)
  or m.body ~* '\m(call me|callback|call back|phone call|ignore (previous|all)|system prompt|wire|bank account|lawsuit)\M' then return null;end if;
 dialogue:=public.icash_seller_dialogue_context(p_account,m.id);
 if dialogue->>'conditionState' is not null and dialogue->>'conditionState'<>'resolved' or dialogue->>'visitRequest' is not null then return null;end if;
 select * into o from icash_call_offer_private.offers where account_id=p_account and deal_id=d.id;
 if o.state->>'textThreadId' is distinct from t.id::text
  and not (public.icash_seller_conversion_source(p_account,m.id) and public.icash_seller_conversion_intent(m.body) is not null) and m.body !~* '([0-9]|\m(hundred|thousand|million|dollars?)\M|how much|what.*offer|what.*pay|asking price|send.*(contract|agreement))' then return null;end if;
 -- Do not truncate away a refusal, correction or price. Oversize histories get
 -- the existing explicit review path, never a partial conversation.
 if (select count(*) from public.icash_text_messages where account_id=p_account and thread_id=t.id)>200 then return null;end if;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'direction',x.direction,'body',x.body,'state',x.state,'providerId',x.provider_id,'updatedAt',x.updated_at,
  'customerAuthored',x.customer_author_id is not null,'action',coalesce(a.analysis->>'offerAction',public.icash_seller_recovery_reply_action(p_account,x.id)),'quoteRevision',a.analysis->'offerState'->>'quoteRevision','priceCents',a.analysis->'offerState'->'quotedPriceCents') order by case when x.direction='incoming' then public.icash_sms_reply_time(x.id) else extract(epoch from x.created_at) end,x.id),'[]') into messages
 from public.icash_text_messages x left join public.icash_text_ai_jobs a on a.account_id=x.account_id and a.thread_id=x.thread_id and a.outgoing_id=x.id
 where x.account_id=p_account and x.thread_id=t.id and x.id is distinct from j.outgoing_id
 and (case when x.direction='incoming' then public.icash_sms_reply_time(x.id) else extract(epoch from x.created_at) end)<=source_at;
 c:=case when public.icash_seller_conversion_source(p_account,m.id) then '{"conversionEnabled":true}'::jsonb else '{}'::jsonb end||jsonb_build_object('accountId',p_account,'jobId',j.id,'threadId',t.id,'sourceId',m.id,'dealId',d.id,'screeningId',s.id,'phone',t.recipient,'ownerUserId',owner_id,'ownerEmail',mail,'principal',principal,'address',d.terms->>'address','snapshot',s.snapshot,'terms',d.terms,'messages',messages,
  'activeCallSince',(select min(r.dial_claimed_at) from public.icash_call_recordings r
   where r.account_id=p_account and r.screening_id=s.id and r.party='seller'
    and r.dial_claimed_at is not null and r.call_ended_at is null
    and not public.icash_seller_recorded_call_finished(p_account,r.id)));
 return c||jsonb_build_object('fingerprint',md5(c::text),'offerState',case when o.snapshot=s.snapshot then o.state else coalesce(o.state,'{}')||'{"acceptedPriceCents":null,"quoteRevision":null,"contractBlocked":true}'::jsonb end,'offerVersion',coalesce(o.version,0));
end $function$
;

CREATE OR REPLACE FUNCTION public.icash_recorded_reception_property_context(p_id uuid, p_nonce_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare context jsonb;s icash_recorded_reception_private.sessions;m public.icash_meta_leads;t public.icash_text_threads;ids uuid[];principal text;assistant text;
begin
 context:=public.icash_reception_context_before_meta(p_id,p_nonce_hash);
 if context is null or context->>'status'<>'ambiguous' then return context;end if;
 select session.* into s from icash_recorded_reception_private.sessions session join icash_recorded_reception_private.configs c on c.id=session.config_id
 where session.id=p_id and session.nonce_hash=p_nonce_hash and session.state='recording' and session.recording_sid is not null
 and session.register_claimed_at is null and session.conversation_id is null and session.call_ended_at is null and session.end_requested_at is null
 and session.call_deadline_at>now() and c.enabled and c.reviewed_until>now() and c.context_policy='automatic_offer_v18';
 if not found then return context;end if;
 -- Only the single, already messaged seller thread can supply the return-call
 -- context. An ambiguous number never selects another account or property.
 select array_agg(id) into ids from public.icash_text_threads where account_id=s.account_id and sender=s.to_phone and recipient=s.from_phone and retired_at is null;
 if cardinality(ids) is distinct from 1 then return context;end if;
 select * into t from public.icash_text_threads where id=ids[1] and party='seller' and not paused and not manual_only;
 if not found then return context;end if;
 select * into m from public.icash_meta_leads where lead_id=t.seller_intake_id and account_id=s.account_id;
 if not found or not public.icash_meta_contact_only(m.account_id,m.screening_id,t.recipient)
 or not exists(select 1 from public.icash_text_messages where thread_id=t.id and account_id=t.account_id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null and created_at>now()-interval '30 days') then return context;end if;
 insert into icash_seller_agreement_private.inbound_bindings(session_id,account_id,deal_id,thread_id) values(s.id,m.account_id,t.deal_id,t.id) on conflict do nothing;
 if not exists(select 1 from icash_seller_agreement_private.inbound_bindings where session_id=s.id and account_id=m.account_id and deal_id=t.deal_id and thread_id=t.id) then return null;end if;
 select i.principal,a.assistant_name into principal,assistant from public.icash_customer_identities i join public.icash_accounts a on a.id=i.account_id and not a.bot_paused where i.account_id=m.account_id;
 if principal is null then return null;end if;
 return jsonb_build_object('status','instant_lead','principal',principal,'assistantName',assistant,'addressProvided',exists(select 1 from public.icash_seller_intakes l where l.id=m.lead_id and nullif(trim(l.address),'') is not null));
end $function$
;
