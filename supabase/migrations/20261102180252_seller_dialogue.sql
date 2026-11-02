begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Arm only after the matching application release. No historical work is reopened.
alter table public.icash_seller_progress_settings add column dialogue_enabled boolean not null default false;

-- Derive conversational meaning from whole seller statements and actually delivered
-- questions. This is preference/qualification evidence, never purchasing authority.
create function public.icash_seller_dialogue_context(p_account uuid,p_message uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
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
  if prior_action='ask_visit_details' and b ~ '\m(monday|tuesday|wednesday|thursday|friday|saturday|sunday|today|tomorrow|morning|afternoon|evening|after|before|[0-9]{1,2}(:[0-9]{2})? ?(am|pm))\M' then visit_times:=x.body;visit_answer:=x.id;end if;
  if prior_action='ask_visit_access' then visit_access:=x.body;visit_answer:=x.id;end if;
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
end $$;

-- All ordinary contact, route, financial and human-control requirements remain.
create function public.icash_seller_dialogue_reply(p_account uuid,p_job uuid)
returns text language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;m public.icash_text_messages;s public.icash_screening_jobs;d public.icash_deal_files;c jsonb;
begin
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account and state in ('drafted','queued');
 if not found or j.analysis->>'dialoguePolicy' is distinct from 'seller-dialogue-v1' then return null;end if;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account and party='seller' and not paused and not manual_only and ai_mode='auto' and retired_at is null;
 if not found or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete' and completed_at between now()-interval '24 hours' and now() and result->'financialCheck'->>'status'='eligible';
 if not found or public.icash_sms_thread_review_current(p_account,t.id,false) is distinct from true or not public.icash_outreach_sms_current(p_account) then return null;end if;
 if exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=s.snapshot->>'propertyId' and manual)
  or exists(select 1 from public.icash_conversations where account_id=p_account and deal_id=d.id and human_takeover)
  or exists(select 1 from public.icash_handoffs where account_id=p_account and screening_id=s.id and state<>'resolved')
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or exists(select 1 from public.icash_signing_envelopes where account_id=p_account and deal_id=d.id and kind='purchase' and not test_mode) then return null;end if;
 select * into m from public.icash_text_messages where id=j.message_id and account_id=p_account and thread_id=t.id and direction='incoming' and state='received';
 if not found or (m.event_id is null and m.provider_id is null) or public.icash_sms_reply_time(m.id) not between extract(epoch from now()-interval '24 hours') and extract(epoch from now()) then return null;end if;
 if not exists(select 1 from public.icash_sms_routes where account_id=p_account and sender=t.sender and recipient=t.recipient and not needs_review and revision=m.route_revision)
  or exists(select 1 from public.icash_text_messages later where later.account_id=p_account and later.thread_id=t.id and later.direction='outgoing' and later.id is distinct from j.outgoing_id and extract(epoch from later.created_at)>public.icash_sms_reply_time(m.id)) then return null;end if;
 c:=public.icash_seller_dialogue_context(p_account,m.id);
 if c->>'action' is null or j.analysis->>'dialogueAction' is distinct from c->>'action' or j.analysis->>'dialogueAnchor' is distinct from c->>'anchor' then return null;end if;
 return c->>'reply';
end $$;

-- Prepare only a fresh source. Fixed informational replies do not buy another LLM
-- analysis. Existing receipts, handoffs and provider-uncertain work are untouched.
create function public.icash_prepare_seller_dialogue(p_account uuid,p_message uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare m public.icash_text_messages;j public.icash_text_ai_jobs;c jsonb;r jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from public.icash_seller_progress_settings where id=1 and enabled and dialogue_enabled) then return null;end if;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';if not found then return null;end if;
 r:=public.icash_refresh_seller_reply_progress(p_account,m.id);
 c:=r->'context'->'dialogue';
 if r->>'state'='waiting' and r->>'reason'='clarification_receipt_pending' then
  insert into public.icash_text_ai_jobs(account_id,thread_id,message_id,next_attempt_at) values(p_account,m.thread_id,m.id,now()+interval '1 minute') on conflict(message_id) do nothing;
  return null;
 end if;
 if r->>'state' is distinct from 'pending' or c->>'action' is null then return null;end if;
 select * into j from public.icash_text_ai_jobs where message_id=m.id and account_id=p_account and thread_id=m.thread_id for update;
 if found and (j.outgoing_id is not null or j.state not in ('pending','issued','drafted') or j.provider_id is not null or j.usage is not null or (j.state='drafted' and j.analysis->>'dialoguePolicy' is distinct from 'seller-dialogue-v1')) then return null;end if;
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id,state,analysis)
 values(p_account,m.thread_id,m.id,'drafted',jsonb_build_object('action','seller_dialogue','facts','[]'::jsonb,'dialoguePolicy','seller-dialogue-v1','dialogueAction',c->>'action','dialogueAnchor',c->>'anchor','dialogueQuestion',c->>'question'))
 on conflict(message_id) do update set state='drafted',analysis=excluded.analysis,updated_at=now() where icash_text_ai_jobs.account_id=p_account and icash_text_ai_jobs.thread_id=m.thread_id and icash_text_ai_jobs.outgoing_id is null returning * into j;
 if public.icash_seller_dialogue_reply(p_account,j.id) is null then
  perform public.icash_finish_seller_text_progress(p_account,j.id,'action_not_admitted');return null;
 end if;
 -- Resolve only the review for this source that the automatic action replaced.
 update public.icash_text_attention set state='acknowledged',updated_at=now() where account_id=p_account and thread_id=m.thread_id and message_id=m.id and state='open' and kind in ('seller_progress','campaign_reply');
 return j.id;
end $$;

create function public.icash_queue_seller_dialogue(p_account uuid,p_job uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;body text;mid uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;if not found then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 if j.outgoing_id is not null then return j.outgoing_id;end if;
 if j.state<>'drafted' or not public.icash_seller_progress_gate(p_account,p_job) then return null;end if;
 body:=public.icash_seller_dialogue_reply(p_account,p_job);if body is null then return null;end if;
 if (select count(*) from public.icash_text_ai_jobs where account_id=p_account and thread_id=t.id and outgoing_id is not null and created_at>now()-interval '1 day')>=12 then return null;end if;
 mid:=public.icash_queue_text(p_account,t.id,j.id,body,'{}');if mid is null then return null;end if;
 update public.icash_text_ai_jobs set outgoing_id=mid,state='queued',updated_at=now() where id=j.id and account_id=p_account;
 return mid;
end $$;

-- Refresh retains its established receipts and blockers. Only supported, nonbinding
-- clarification can advance past a price/condition observation, never past controls.
do $patch$declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.icash_refresh_seller_reply_progress(uuid,uuid,text)'::regprocedure);
 old:='attention_kind text;';replacement:=old||'dialogue jsonb;dialogue_auto boolean:=false;';
 if position(old in definition)=0 then raise exception 'Progress declaration changed';end if;definition:=replace(definition,old,replacement);
 old:='viewing_current:=coalesce';replacement:='dialogue:=public.icash_seller_dialogue_context(p_account,p_message);'||E'\n '||old;
 if position(old in definition)=0 then raise exception 'Progress context changed';end if;definition:=replace(definition,old,replacement);
 old:='if e.id is not null then';replacement:='dialogue_auto:=dialogue->>''action'' is not null and jsonb_array_length(blockers)=0 and e.id is null and not viewing_current and (j.id is null or j.state in (''pending'',''issued'',''drafted'',''queued''));'||E'\n '||old;
 if position(old in definition)=0 then raise exception 'Progress milestone changed';end if;definition:=replace(definition,old,replacement);
 old:='elsif jsonb_array_length(conditions)>0 and not viewing_current then';
 replacement:=$r$elsif dialogue->>'reason' is not null and jsonb_array_length(blockers)=0 and e.id is null and not viewing_current then
  status:='needs_review';why:=dialogue->>'reason';step:=case why when 'direct_purchase_required' then 'Seller requires a direct buyer. Confirm actual purchasing capacity or respect the restriction; do not claim funds or hide assignment.' when 'visit_attendee_required' then 'Seller supplied visit availability and access details. Confirm the actual attendee and proposed time before booking; no visit is booked.' when 'buyer_condition_unresolved' then 'The seller condition remains unclear after a concrete explanation. Review their exact answer before making a commitment.' else 'The original clarification was already attempted. Reconcile its receipt and the seller answer; do not repeat the question.' end;due:=null;
  if why='clarification_receipt_pending' then status:='waiting';step:='Wait for the original clarification delivery receipt before interpreting this answer; do not resend.';wake:='original clarification receipt or 15-minute delivery review';due:=now()+interval '1 minute';end if;
 elsif jsonb_array_length(conditions)>0 and not coalesce((dialogue->>'conditionResolved')::boolean,false) and dialogue->>'action' is null and not viewing_current then$r$;
 if position(old in definition)=0 then raise exception 'Progress condition changed';end if;definition:=replace(definition,old,replacement);
 old:=') and not viewing_current then'||E'\n  status:=''needs_review'';why:=''price_reconciliation'';';
 replacement:=') and not dialogue_auto and not viewing_current then'||E'\n  status:=''needs_review'';why:=''price_reconciliation'';';
 if position(old in definition)=0 then raise exception 'Progress pricing changed';end if;definition:=replace(definition,old,replacement);
 old:='elsif jsonb_array_length(visits)>0 and e.id is null then';replacement:='elsif jsonb_array_length(visits)>0 and e.id is null and dialogue->>''action'' is null then';
 if position(old in definition)=0 then raise exception 'Progress visits changed';end if;definition:=replace(definition,old,replacement);
 old:='elsif owner_question and m.body';replacement:=$r$elsif dialogue_auto then
  status:='pending';why:='automatic_clarification';step:='Answer the seller question and continue the next supported step.';
 $r$||old;
 if position(old in definition)=0 then raise exception 'Progress ownership changed';end if;definition:=replace(definition,old,replacement);
 old:='''sourceAt'',source_at';replacement:=old||',''dialogue'',dialogue';
 if position(old in definition)=0 then raise exception 'Progress evidence changed';end if;definition:=replace(definition,old,replacement);
 execute definition;
 definition:=pg_get_functiondef('public.icash_seller_progress_gate(uuid,uuid)'::regprocedure);
 old:='if r->>''state''=''pending'' then return true;end if;';
 replacement:=old||$r$
 if r->>'state'='waiting' and r->>'reason'='clarification_receipt_pending' then
  update public.icash_text_ai_jobs set state='pending',next_attempt_at=now()+interval '1 minute',updated_at=now() where id=j.id and account_id=p_account and state in ('pending','issued') and outgoing_id is null and provider_id is null and usage is null;
  return false;
 end if;
 $r$;
 if position(old in definition)=0 then raise exception 'Progress wait gate changed';end if;
 execute replace(definition,old,replacement);
end $patch$;

-- The existing analysis/send worker can resume these deterministic saved actions.
alter function public.icash_resume_seller_text_ai(uuid,uuid) rename to icash_resume_seller_text_before_dialogue;
create function public.icash_resume_seller_text_ai(p_account uuid,p_job uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;mid uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 if not found then return jsonb_build_object('mode','held');end if;
 if not exists(select 1 from public.icash_seller_progress_settings where id=1 and enabled and dialogue_enabled) then return public.icash_resume_seller_text_before_dialogue(p_account,p_job);end if;
 if j.outgoing_id is null and j.state in ('pending','issued') then perform public.icash_prepare_seller_dialogue(p_account,j.message_id);end if;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 if j.analysis->>'dialoguePolicy' is distinct from 'seller-dialogue-v1' then return public.icash_resume_seller_text_before_dialogue(p_account,p_job);end if;
 if not public.icash_seller_progress_gate(p_account,p_job) then return jsonb_build_object('mode','held');end if;
 if j.outgoing_id is not null then
  if exists(select 1 from public.icash_text_messages where id=j.outgoing_id and account_id=p_account and thread_id=j.thread_id and state='ready' and provider_id is null) then return jsonb_build_object('mode','dispatch','messageId',j.outgoing_id);end if;
  return jsonb_build_object('mode','held');
 end if;
 mid:=public.icash_queue_seller_dialogue(p_account,p_job);
 if mid is not null then return jsonb_build_object('mode','dispatch','messageId',mid);end if;
 perform public.icash_finish_seller_text_progress(p_account,p_job,'action_not_admitted');
 return jsonb_build_object('mode','held');
end $$;

alter function public.icash_seller_conversation_message_current(uuid,uuid) rename to icash_seller_message_before_dialogue;
create function public.icash_seller_conversation_message_current(p_account uuid,p_message uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;m public.icash_text_messages;body text;
begin
 select * into j from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and state='queued' and analysis->>'dialoguePolicy'='seller-dialogue-v1';
 if not found then return public.icash_seller_message_before_dialogue(p_account,p_message);end if;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=j.thread_id and direction='outgoing' and state='ready';
 if not found or not public.icash_sms_message_route_current(p_account,p_message) then return false;end if;
 body:=public.icash_seller_dialogue_reply(p_account,j.id);
 return body is not null and m.body is not distinct from body;
end $$;

-- A reply to a delivered ownership clarification can answer the ownership question.
-- Preserve the original opening receipt; neither the earlier price question nor an
-- undelivered clarification can establish ownership.
do $patch$declare definition text;old text;replacement text;begin
 definition:=pg_get_functiondef('public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)'::regprocedure);
 old:='-- Whole-message answers only.';
 replacement:=$r$if exists(select 1 from public.icash_seller_progress_settings where enabled and dialogue_enabled) then
  select sent.* into question from public.icash_text_messages sent join public.icash_text_ai_jobs j on j.outgoing_id=sent.id and j.account_id=sent.account_id and j.thread_id=sent.thread_id
   where sent.account_id=p_account and sent.thread_id=t.id and sent.direction='outgoing' and sent.state='delivered' and sent.provider_id is not null and sent.created_at<m.created_at
    and j.analysis->>'dialoguePolicy'='seller-dialogue-v1' and j.analysis->>'dialogueAction'='clarify_ownership'
   order by sent.created_at desc,sent.id desc limit 1;
  if not found then select * into question from public.icash_text_messages where id=opening.owner_question_id and account_id=p_account and thread_id=t.id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null;end if;
 end if;
 $r$||old;
 if position(old in definition)=0 then raise exception 'Ownership reply boundary changed';end if;
 execute replace(definition,old,replacement);
end $patch$;

create function public.icash_observe_seller_dialogue() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if new.direction='incoming' and new.state='received' then perform public.icash_prepare_seller_dialogue(new.account_id,new.id);end if;
 return new;
end $$;
create trigger zzz_seller_dialogue after insert on public.icash_text_messages for each row execute function public.icash_observe_seller_dialogue();
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('icash_seller_dialogue_context','icash_seller_dialogue_reply','icash_prepare_seller_dialogue','icash_queue_seller_dialogue','icash_resume_seller_text_ai','icash_resume_seller_text_before_dialogue','icash_seller_conversation_message_current','icash_seller_message_before_dialogue','icash_observe_seller_dialogue') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
