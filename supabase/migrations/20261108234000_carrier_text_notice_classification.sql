-- Classification only: original message/event, route, consent and financial
-- evidence stay in their existing tables. No provider operation or resend.
begin;
set local lock_timeout='5s';
set local statement_timeout='60s';

create function public.icash_is_carrier_text_notice(p_body text,p_attachments jsonb default '[]') returns boolean
language sql immutable security invoker set search_path='' as $fn$
 select coalesce(p_attachments='[]'::jsonb and
  translate(trim(regexp_replace(p_body,E'[ \t\n\r\f\013]+',' ','g')),'ABCDEFGHIJKLMNOPQRSTUVWXYZ','abcdefghijklmnopqrstuvwxyz') ~
  '^free msg: receiver \+?[0-9]{10,15} unable to receive message - message blocking is active[.!]?$',false);
$fn$;

-- This view is solely for response interpretation. Transport/history, costs,
-- suppression and provider receipt recovery continue reading the raw table.
create view public.icash_response_text_messages with(security_invoker=true) as
 select m.* from public.icash_text_messages m
 where not(m.direction='incoming' and public.icash_is_carrier_text_notice(m.body,m.attachments));
create view public.icash_response_text_attention with(security_invoker=true) as
 select a.* from public.icash_text_attention a where not exists(
  select 1 from public.icash_text_messages m where m.id=a.message_id and m.account_id=a.account_id and m.thread_id=a.thread_id
  and m.direction='incoming' and public.icash_is_carrier_text_notice(m.body,m.attachments));

create view public.icash_response_sms_call_requests with(security_invoker=true) as
 select r.* from public.icash_sms_call_requests r where not exists(
  select 1 from public.icash_text_messages m where m.id=r.message_id and m.account_id=r.account_id and m.thread_id=r.thread_id
  and m.direction='incoming' and public.icash_is_carrier_text_notice(m.body,m.attachments));
create view public.icash_response_seller_gaps with(security_invoker=true) as
 select g.* from public.icash_seller_gaps g where not exists(
  select 1 from public.icash_text_ai_jobs j
  join public.icash_text_messages m on m.id=j.message_id and m.account_id=j.account_id and m.thread_id=j.thread_id
  where g.source='text_ai' and j.id=g.source_id and j.account_id=g.account_id and j.thread_id=g.thread_id
  and m.direction='incoming' and public.icash_is_carrier_text_notice(m.body,m.attachments));

create function public.icash_text_ai_source_is_notice(p_account uuid,p_job uuid) returns boolean
language sql stable security invoker set search_path='' as $fn$
 select exists(select 1 from public.icash_text_ai_jobs j
  join public.icash_text_messages m on m.id=j.message_id and m.account_id=j.account_id and m.thread_id=j.thread_id
  where j.id=p_job and j.account_id=p_account and m.direction='incoming'
  and public.icash_is_carrier_text_notice(m.body,m.attachments));
$fn$;

create function public.icash_text_reply_source_is_notice(p_account uuid,p_message uuid) returns boolean
language sql stable security invoker set search_path='' as $fn$
 select exists(
  select 1 from public.icash_text_messages outgoing
  join public.icash_text_messages source on source.account_id=outgoing.account_id and source.direction='incoming'
  where outgoing.id=p_message and outgoing.account_id=p_account and outgoing.direction='outgoing'
  and outgoing.customer_author_id is null
  and public.icash_is_carrier_text_notice(source.body,source.attachments)
  and (
   (source.id=outgoing.request_key and (source.thread_id=outgoing.thread_id or source.thread_id is null))
   or exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=outgoing.thread_id
    and j.message_id=source.id and source.thread_id=j.thread_id and (j.outgoing_id=outgoing.id or j.id=outgoing.request_key))
   or exists(select 1 from public.icash_sms_inbound_invitations i where i.account_id=p_account and i.thread_id=outgoing.thread_id
    and i.reply_id=source.id and i.message_id=outgoing.id and source.thread_id=i.thread_id)
   or exists(select 1 from public.icash_seller_recovery_attempts a
    join public.icash_seller_gaps g on g.id=a.gap_id and g.account_id=a.account_id and g.thread_id=a.thread_id
    join public.icash_text_ai_jobs j on j.id=g.source_id and j.account_id=g.account_id and j.thread_id=g.thread_id
    where a.account_id=p_account and a.thread_id=outgoing.thread_id and a.message_id=outgoing.id
    and g.source='text_ai' and j.message_id=source.id and source.thread_id=j.thread_id)
   or exists(select 1 from public.icash_meta_lead_messages mm
    join public.icash_meta_leads ml on ml.lead_id=mm.lead_id and ml.account_id=p_account
    join public.icash_text_threads t on t.id=outgoing.thread_id and t.account_id=p_account and t.seller_intake_id=ml.lead_id
    where mm.message_id=outgoing.id and mm.purpose='reply' and mm.evidence_key=source.id::text and source.thread_id=t.id)
   or exists(select 1 from public.icash_seller_text_replies r where r.account_id=p_account and r.thread_id=outgoing.thread_id
    and r.source_id=source.id and r.message_id=outgoing.id)
  ));
$fn$;

-- Retain the delivery restriction independently of whether this is a human
-- reply. No global opt-out, consent change, money release or replay is created.
-- Apply only to exact cold opener / no-response recovery / unanswered Meta
-- follow-up records. Genuine dialogue, requested agreements, cancellation and
-- manual sends keep their existing separate source and delivery controls.
-- Only a later original same-thread dispatched-and-delivered receipt resolves
-- this narrow delivery hold; an inbound reply, elapsed time or accepted send
-- cannot. This neither changes consent nor authorizes any new operation.
create function public.icash_text_automatic_notice_hold(p_account uuid,p_message uuid) returns boolean
language sql stable security invoker set search_path='' as $fn$
 select exists(select 1 from public.icash_text_messages outgoing
  join public.icash_text_messages notice on notice.account_id=outgoing.account_id and notice.thread_id=outgoing.thread_id
  where outgoing.id=p_message and outgoing.account_id=p_account and outgoing.direction='outgoing'
  and outgoing.customer_author_id is null and notice.direction='incoming'
  and not exists(select 1 from public.icash_cancellation_notices c where c.account_id=p_account and c.sms_id=outgoing.id)
  and (
   exists(select 1 from public.icash_seller_opener_assignments a where a.account_id=p_account and a.thread_id=outgoing.thread_id and a.message_id=outgoing.id)
   or exists(select 1 from public.icash_seller_gaps g where g.account_id=p_account and g.thread_id=outgoing.thread_id
    and g.outgoing_id=outgoing.id and g.reason='no_response' and g.stage='draft')
   or exists(select 1 from public.icash_meta_lead_messages mm
    join public.icash_meta_leads ml on ml.lead_id=mm.lead_id and ml.account_id=p_account
    join public.icash_text_threads t on t.id=outgoing.thread_id and t.account_id=p_account and t.seller_intake_id=ml.lead_id
    where mm.message_id=outgoing.id and mm.purpose in ('followup_1','followup_2'))
  )
  and public.icash_is_carrier_text_notice(notice.body,notice.attachments)
  and not exists(
   select 1 from public.icash_text_messages delivered
   join public.icash_text_threads t on t.id=delivered.thread_id and t.account_id=delivered.account_id
   join public.icash_operation_spend operation on operation.account_id=delivered.account_id and operation.operation_key='text:'||delivered.id
   join public.icash_text_events receipt on receipt.type='text.delivery.confirmed'
    and receipt.payload->'data'->>'message_id'=delivered.provider_id
    and receipt.payload->'data'->>'from'=t.sender and receipt.payload->'data'->>'to'=t.recipient
   where delivered.account_id=notice.account_id and delivered.thread_id=notice.thread_id
    and delivered.direction='outgoing' and delivered.state='delivered' and nullif(delivered.provider_id,'') is not null
    and operation.dispatched_at>to_timestamp(public.icash_sms_reply_time(notice.id)::double precision)
    and operation.dispatched_at>=delivered.created_at and delivered.last_delivery_at between operation.dispatched_at and now()
    and case when jsonb_typeof(receipt.payload->'timestamp')='number'
     then (receipt.payload->>'timestamp')::numeric=extract(epoch from delivered.last_delivery_at) else false end));
$fn$;

create function public.icash_operation_source_is_carrier_notice(p_account uuid,p_operation text) returns boolean
language sql stable security invoker set search_path='' as $fn$
 select exists(select 1 from public.icash_text_messages m where m.account_id=p_account and 'text:'||m.id=p_operation
  and (public.icash_text_reply_source_is_notice(p_account,m.id) or public.icash_text_automatic_notice_hold(p_account,m.id)))
 or exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and 'sms-ai:'||j.id=p_operation
  and public.icash_text_ai_source_is_notice(p_account,j.id))
 or exists(select 1 from public.icash_voice_jobs j join public.icash_text_messages m
  on m.id=j.sms_source_message_id and m.account_id=j.account_id and m.direction='incoming'
  where j.account_id=p_account and 'voice:'||j.id=p_operation
  and public.icash_is_carrier_text_notice(m.body,m.attachments));
$fn$;

do $patch$
declare p record;definition text;
begin
 for p in select * from (values
  ($sig$public.icash_enqueue_text_ai()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_capture_text_signal()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_capture_sms_call_request()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_capture_sms_campaign_reply()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_sms_save_route_review()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_remember_sms_property()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_observe_seller_opener()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_observe_seller_recovery_text()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_observe_seller_reply_progress()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_observe_seller_dialogue()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_prepare_seller_text_offer()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_meta_observe_text()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_capture_viewing_and_purchase_text()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_capture_buyer_title_text()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_capture_buyer_viewing_text()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),
  ($sig$public.icash_capture_buyer_scenario_text()$sig$,$old$
begin
$old$,$new$
begin
 if new.direction='incoming' and public.icash_is_carrier_text_notice(new.body,new.attachments) then return new;end if;
$new$,1),

  ($sig$public.icash_capture_seller_ai_gap()$sig$,$old$
begin
$old$,$new$
begin
 if public.icash_text_ai_source_is_notice(new.account_id,new.id) then return new;end if;
$new$,1),
  ($sig$public.icash_sms_message_route()$sig$,$old$  update public.icash_sms_routes set revision=revision+1,needs_review=(new.thread_id is null) where sender=pair_sender and recipient=pair_recipient returning * into r;$old$,$new$  if not public.icash_is_carrier_text_notice(new.body,new.attachments) then
  update public.icash_sms_routes set revision=revision+1,needs_review=(new.thread_id is null) where sender=pair_sender and recipient=pair_recipient returning * into r;
  end if;$new$,1),
  ($sig$public.icash_seller_reply_before_viewings(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,6),
  ($sig$public.icash_seller_reply_before_viewings(uuid,uuid)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,1),
  ($sig$public.icash_manual_handoff_reply(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,1),
  ($sig$public.icash_prepare_limited_seller_text(uuid,uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,3),
  ($sig$public.icash_prepare_limited_seller_text(uuid,uuid,uuid)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,1),
  ($sig$public.icash_claim_text_before_buyer_package(uuid,uuid,text)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,5),
  ($sig$public.icash_claim_text_before_owner_question(uuid,uuid,text)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,3),
  ($sig$public.icash_claim_text_before_owner_question(uuid,uuid,text)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,2),
  ($sig$public.icash_observe_seller_opener()$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,1),
  ($sig$public.icash_observe_seller_opener()$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,1),
  ($sig$public.icash_review_sms_campaign_reply(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,1),
  ($sig$public.icash_review_sms_campaign_reply(uuid,uuid)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,2),
  ($sig$public.icash_prepare_seller_text_event(text)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,1),
  ($sig$public.icash_prepare_seller_text_event_before_call_now(text)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,3),
  ($sig$public.icash_prepare_seller_text_event_before_call_now(text)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,1),
  ($sig$public.icash_meta_text_context(text)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,1),
  ($sig$public.icash_claim_text_ai_before_campaign(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,3),
  ($sig$public.icash_claim_text_ai_before_progress(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,1),
  ($sig$public.icash_queue_ai_reply_before_campaign(uuid,uuid,text)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,2),
  ($sig$public.icash_claim_text_before_campaign(uuid,uuid,text)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,2),
  ($sig$public.icash_claim_text_before_seller_conversation(uuid,uuid,text)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,3),
  ($sig$public.icash_seller_dialogue_context(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,7),
  ($sig$public.icash_seller_dialogue_context(uuid,uuid)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,3),
  ($sig$public.icash_seller_text_offer_context(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,5),
  ($sig$public.icash_seller_conversation_reply(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,2),
  ($sig$public.icash_refresh_seller_reply_progress(uuid,uuid,text)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,10),
  ($sig$public.icash_refresh_seller_reply_progress(uuid,uuid,text)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,1),
  ($sig$public.icash_seller_sms_call_current(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,2),
  ($sig$public.icash_limited_seller_text_current(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,1),
  ($sig$public.icash_limited_seller_text_current(uuid,uuid)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,2),
  ($sig$public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,5),
  ($sig$public.icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,2),
  ($sig$public.icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,1),
  ($sig$public.icash_seller_sms_interest_at(uuid,uuid,timestamp with time zone,timestamp with time zone)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,1),
  ($sig$public.icash_seller_sms_interest_at(uuid,uuid,timestamp with time zone,timestamp with time zone)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,2),
  ($sig$public.icash_refresh_seller_reply_progress(uuid,uuid,text)$sig$,$old$m.body ~* '(message blocking is active|no longer in service|unable to receive message)'$old$,$new$public.icash_is_carrier_text_notice(m.body,m.attachments)$new$,1),
  ($sig$public.icash_seller_progress_gate(uuid,uuid)$sig$,$old$
begin
$old$,$new$
begin
 if public.icash_text_ai_source_is_notice(p_account,p_job) then return false;end if;
$new$,1),
  ($sig$public.icash_claim_text_ai(uuid,uuid)$sig$,$old$
begin
$old$,$new$
begin
 if public.icash_text_ai_source_is_notice(p_account,p_job) then return null;end if;
$new$,1),
  ($sig$public.icash_queue_ai_reply(uuid,uuid,text)$sig$,$old$
begin
$old$,$new$
begin
 if public.icash_text_ai_source_is_notice(p_account,p_job) then return null;end if;
$new$,1),
  ($sig$public.icash_resume_seller_text_ai(uuid,uuid)$sig$,$old$
begin
$old$,$new$
begin
 if public.icash_text_ai_source_is_notice(p_account,p_job) then return jsonb_build_object('mode','held');end if;
$new$,1),
  ($sig$public.icash_claim_text(uuid,uuid,text)$sig$,$old$
begin
$old$,$new$
begin
 if public.icash_text_reply_source_is_notice(p_account,p_message) or public.icash_text_automatic_notice_hold(p_account,p_message) then return null;end if;
$new$,1),
  ($sig$public.icash_meta_claim_text(uuid,uuid,text)$sig$,$old$
begin
$old$,$new$
begin
 if public.icash_text_reply_source_is_notice(p_account,p_message) or public.icash_text_automatic_notice_hold(p_account,p_message) then return null;end if;
$new$,1),
  ($sig$public.icash_claim_operation(text)$sig$,$old$ select account_id into a from public.icash_operation_spend where operation_key=p_operation;$old$,$new$ select account_id into a from public.icash_operation_spend where operation_key=p_operation;
 if a is not null and public.icash_operation_source_is_carrier_notice(a,p_operation) then return false;end if;$new$,1),
  ($sig$public.icash_save_text_ai_before_token_billing(uuid,uuid,jsonb,text,text,jsonb)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,2),
  ($sig$public.icash_save_text_ai_before_token_billing(uuid,uuid,jsonb,text,text,jsonb)$sig$,$old$ if coalesce((p_analysis->>'humanRequested')::boolean,false) or coalesce((p_analysis->>'callbackRequested')::boolean,false) then$old$,$new$ if not public.icash_text_ai_source_is_notice(p_account,p_job) and (coalesce((p_analysis->>'humanRequested')::boolean,false) or coalesce((p_analysis->>'callbackRequested')::boolean,false)) then$new$,1),
  ($sig$public.icash_save_text_ai_before_token_billing(uuid,uuid,jsonb,text,text,jsonb)$sig$,$old$usage=p_usage,state=case$old$,$new$usage=p_usage,state=case
 when public.icash_text_ai_source_is_notice(p_account,p_job) then 'superseded'$new$,1),
  ($sig$public.icash_issue_due_text_ai()$sig$,$old$q.next_attempt_at<=now()$old$,$new$q.next_attempt_at<=now() and not public.icash_text_ai_source_is_notice(q.account_id,q.id)$new$,1),
  ($sig$public.icash_issue_due_text_ai_before_progress()$sig$,$old$q.next_attempt_at<=now()$old$,$new$q.next_attempt_at<=now() and not public.icash_text_ai_source_is_notice(q.account_id,q.id)$new$,1),
  ($sig$public.icash_issue_due_text_ai()$sig$,$old$from public.icash_seller_reply_progress where next_check_at<=now()$old$,$new$from public.icash_seller_reply_progress where next_check_at<=now() and not exists(select 1 from public.icash_text_messages carrier where carrier.id=icash_seller_reply_progress.message_id and carrier.account_id=icash_seller_reply_progress.account_id and carrier.thread_id=icash_seller_reply_progress.thread_id and carrier.direction='incoming' and public.icash_is_carrier_text_notice(carrier.body,carrier.attachments))$new$,1),
  ($sig$public.icash_meta_queue_message(uuid,text,text,text)$sig$,$old$ select * into l from public.icash_seller_intakes where id=p_lead;$old$,$new$ select * into l from public.icash_seller_intakes where id=p_lead;
 if p_purpose='reply' and exists(select 1 from public.icash_text_messages source join public.icash_text_threads t on t.id=source.thread_id and t.account_id=source.account_id and t.seller_intake_id=p_lead where source.id::text=p_key and source.account_id=m.account_id and source.direction='incoming' and public.icash_is_carrier_text_notice(source.body,source.attachments)) then return null;end if;$new$,1)
 ) patches(signature,needle,replacement,expected_count) loop
  definition:=pg_get_functiondef(p.signature::regprocedure);
  if (length(definition)-length(replace(definition,p.needle,'')))/length(p.needle)<>p.expected_count then
   raise exception 'Carrier notice prerequisite changed: %',p.signature;
  end if;
  execute replace(definition,p.needle,p.replacement);
 end loop;
end $patch$;

-- Existing contact windows and operator monitoring use the same conservative
-- notice semantics. No limits, actual block state or suppression are changed.
do $patch$
declare p record;definition text;
begin
 for p in select * from (values
  ($sig$public.icash_outreach_active_conversation(uuid,uuid,text,timestamp with time zone)$sig$,$old$m.direction='incoming' and m.state='received'$old$,$new$m.direction='incoming' and m.state='received' and not public.icash_is_carrier_text_notice(m.body,m.attachments)$new$,1),
  ($sig$public.icash_owner_text_health(uuid)$sig$,$old$m.body,m.created_at at,t.account_id,t.id thread_id$old$,$new$m.body,m.attachments,m.created_at at,t.account_id,t.id thread_id$new$,1),
  ($sig$public.icash_owner_text_health(uuid)$sig$,$old$select event_id,recipient,sender,body,created_at,null::uuid,null::uuid$old$,$new$select event_id,recipient,sender,body,attachments,created_at,null::uuid,null::uuid$new$,1),
  ($sig$public.icash_owner_text_health(uuid)$sig$,$old$m.body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'$old$,$new$not public.icash_is_carrier_text_notice(m.body,m.attachments) and m.body !~* '(verification code|one.time (password|code))'$new$,2),
  ($sig$public.icash_owner_text_health(uuid)$sig$,$old$body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'$old$,$new$not public.icash_is_carrier_text_notice(body,attachments) and body !~* '(verification code|one.time (password|code))'$new$,2),
  ($sig$public.icash_owner_text_health(uuid)$sig$,$old$body ~* '(^Free Msg:|Message Blocking is active)'$old$,$new$public.icash_is_carrier_text_notice(body,attachments)$new$,1)
 ) patches(signature,needle,replacement,expected_count) loop
  definition:=pg_get_functiondef(p.signature::regprocedure);
  if (length(definition)-length(replace(definition,p.needle,'')))/length(p.needle)<>p.expected_count then
   raise exception 'Carrier notice prerequisite changed: %',p.signature;
  end if;
  execute replace(definition,p.needle,p.replacement);
 end loop;
end $patch$;

-- Preserve raw incoming blockers in gap recovery and every original cadence
-- and source gate. Carrier classification cannot reopen no-response outreach.
do $patch$
declare p record;definition text;
begin
 for p in select * from (values
  ($sig$public.icash_filter_sms_interest(uuid,uuid)$sig$,$old$from public.icash_text_messages$old$,$new$from public.icash_response_text_messages$new$,1),
  ($sig$public.icash_filter_sms_interest(uuid,uuid)$sig$,$old$join public.icash_text_messages$old$,$new$join public.icash_response_text_messages$new$,2),
  ($sig$public.icash_manual_contact_reason(uuid,uuid,text,text,uuid)$sig$,$old$m.direction='incoming' and m.account_id=p_account$old$,$new$m.direction='incoming' and m.account_id=p_account and not public.icash_is_carrier_text_notice(m.body,m.attachments)$new$,1),
  ($sig$public.icash_seller_recovery_current(uuid)$sig$,$old$ select * into g from public.icash_seller_gaps where id=p_gap and state in ('open','queued') and expires_at>now();if not found then return false;end if;$old$,$new$ select * into g from public.icash_seller_gaps where id=p_gap and state in ('open','queued') and expires_at>now();if not found then return false;end if;
 if g.source='text_ai' and public.icash_text_ai_source_is_notice(g.account_id,g.source_id) then return false;end if;$new$,1),
  ($sig$public.icash_seller_text_cadence_current(uuid,uuid,uuid,boolean)$sig$,$old$m.body !~* '(^Free Msg:|Message Blocking is active|verification code|one.time (password|code))'$old$,$new$not public.icash_is_carrier_text_notice(m.body,m.attachments) and m.body !~* '(verification code|one.time (password|code))'$new$,1)
 ) patches(signature,needle,replacement,expected_count) loop
  definition:=pg_get_functiondef(p.signature::regprocedure);
  if (length(definition)-length(replace(definition,p.needle,'')))/length(p.needle)<>p.expected_count then
   raise exception 'Carrier notice prerequisite changed: %',p.signature;
  end if;
  execute replace(definition,p.needle,p.replacement);
 end loop;
end $patch$;

-- Some installations have not activated the separately staged v5 experiment.
-- If present, exclude notices from source/intervening dialogue only. Original
-- expense keys, allocations, cohorts and decisions are never rewritten.
do $patch$
declare target regprocedure:=to_regprocedure('public.icash_seller_sms_interest_v5_at(uuid,uuid,timestamptz,timestamptz)');definition text;
begin
 if target is null then return;end if;
 definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,'join public.icash_text_messages','')))/length('join public.icash_text_messages')<>2
  or (length(definition)-length(replace(definition,'from public.icash_text_messages','')))/length('from public.icash_text_messages')<>1
 then raise exception 'Carrier notice v5 interest prerequisite changed';end if;
 execute replace(replace(definition,'join public.icash_text_messages','join public.icash_response_text_messages'),'from public.icash_text_messages','from public.icash_response_text_messages');
end $patch$;

revoke all on public.icash_response_text_messages,public.icash_response_text_attention,public.icash_response_sms_call_requests,public.icash_response_seller_gaps from public,anon,authenticated;
grant select on public.icash_response_text_messages,public.icash_response_text_attention,public.icash_response_sms_call_requests,public.icash_response_seller_gaps to service_role;
revoke all on function public.icash_is_carrier_text_notice(text,jsonb),public.icash_text_ai_source_is_notice(uuid,uuid),public.icash_text_reply_source_is_notice(uuid,uuid),public.icash_operation_source_is_carrier_notice(uuid,text),public.icash_text_automatic_notice_hold(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_is_carrier_text_notice(text,jsonb),public.icash_text_ai_source_is_notice(uuid,uuid),public.icash_text_reply_source_is_notice(uuid,uuid),public.icash_operation_source_is_carrier_notice(uuid,text),public.icash_text_automatic_notice_hold(uuid,uuid) to service_role;
commit;
