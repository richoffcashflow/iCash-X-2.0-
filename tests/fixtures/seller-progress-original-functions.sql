-- Original production definitions read on 2026-11-02; code only, no customer data.
CREATE OR REPLACE FUNCTION public.icash_enqueue_text_ai()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from public.icash_text_threads where id=new.thread_id and (manual_only or ai_mode='off')) then return new;end if;
 if new.direction<>'incoming' or new.account_id is null or new.thread_id is null then return new;end if;
 if exists(select 1 from public.icash_text_threads t join public.icash_meta_leads m on m.lead_id=t.seller_intake_id and m.account_id=t.account_id join public.icash_screening_jobs s on s.id=m.screening_id where t.id=new.thread_id and s.state='awaiting_address') then return new;end if;
 if exists(select 1 from public.icash_owner_buyer_tests where thread_id=new.thread_id)
 and not public.icash_sms_thread_review_current(new.account_id,new.thread_id,false) then return new;end if;
 if new.state='received' and public.icash_seller_sms_call_current(new.account_id,new.id) then
  perform public.icash_queue_seller_sms_call(new.account_id,new.id);
  return new;
 end if;
 if new.state='received' and public.icash_seller_conversation_context(new.account_id,new.thread_id) is not null then
  update public.icash_text_ai_jobs set state='superseded',updated_at=now() where thread_id=new.thread_id and account_id=new.account_id and state in ('pending','issued','drafted');
  insert into public.icash_text_ai_jobs(account_id,thread_id,message_id) values(new.account_id,new.thread_id,new.id) on conflict(message_id) do nothing;
  return new;
 end if;
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where thread_id=new.thread_id and state in ('pending','issued','drafted'); if public.icash_outreach_sms_current(new.account_id) and exists(select 1 from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and party='seller') then perform public.icash_prepare_sms_inbound_reply(new.account_id,new.thread_id,new.id);return new;end if;
 if exists(select 1 from public.icash_text_threads where id=new.thread_id and account_id=new.account_id and paused) then return new;end if;
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where thread_id=new.thread_id and state in ('pending','issued','drafted');
 if exists(select 1 from public.icash_text_threads t join public.icash_text_suppressions s on s.phone=t.recipient where t.id=new.thread_id) then return new;end if;
 if new.body ~* '\m(human|real person|speak to someone|talk to someone|call me|call back|callback)\M' then
 update public.icash_text_threads set paused=true where id=new.thread_id;
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id,state,analysis) values(new.account_id,new.thread_id,new.id,'handoff',jsonb_build_object('summary','Seller requested a person or callback. Review and confirm scheduling.','humanRequested',true,'callbackRequested',new.body ~* '\m(call me|call back|callback)\M')) on conflict(message_id) do nothing;
 elsif exists(select 1 from public.icash_text_threads where id=new.thread_id and ai_mode<>'off') then
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id) values(new.account_id,new.thread_id,new.id) on conflict(message_id) do nothing;
 end if;return new;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_issue_due_text_ai()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_text_ai_jobs;t public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 if exists(select 1 from public.icash_text_ai_settings c join public.icash_operation_rates r on r.id=c.rate_id and r.enabled and r.expires_at>now() where c.enabled)
 and exists(select 1 from public.icash_operating_budget where id=1 and enabled)
 and not exists(select 1 from public.icash_automation_tickets where kind='text_ai' and created_at>now()-interval '10 seconds') then
 select q.* into j from public.icash_text_ai_jobs q join public.icash_accounts a on a.id=q.account_id and not a.bot_paused join public.icash_text_threads th on th.id=q.thread_id and not th.paused and th.ai_mode<>'off'
 where q.next_attempt_at<=now() and (q.state='pending' or (q.state='issued' and q.updated_at<now()-interval '15 minutes')) order by q.created_at for update of q skip locked limit 1;
 if found then
 update public.icash_text_ai_jobs set state='issued',updated_at=now(),next_attempt_at=now()+interval '15 minutes' where id=j.id;
 insert into public.icash_automation_tickets(account_id,kind,text_ai_job_id) values(j.account_id,'text_ai',j.id) returning * into t;
 return jsonb_build_object('token',t.token);
 end if;end if;
 return null;
end $function$;

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
 -- Whole-message answers only. A bare interested reply is not ownership confirmation.
 if question.id is null or m.created_at<question.created_at
  or lower(trim(m.body)) !~ '^(yes|yeah|yep|yes i am|i am|i am the owner|i''m the owner|yes i am the owner|yes that is me|yes that''s me)[.! ,]*$'
  or exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.account_id=p_account and x.id not in (m.id,question.id) and x.created_at>=question.created_at) then return null;end if;
 outgoing:=public.icash_queue_text(p_account,t.id,m.id,case when t.seller_intake_id is not null then 'Would you consider a cash offer?' else 'Would you be interested in selling your property for all cash?' end,'{}');
 update public.icash_sms_seller_openings set owner_reply_id=m.id,interest_message_id=outgoing where thread_id=t.id and account_id=p_account;
 return outgoing;
end $function$;

CREATE OR REPLACE FUNCTION public.icash_queue_ai_reply_before_campaign(p_account uuid, p_job uuid, p_reply text)
 RETURNS uuid
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;prop text;outgoing uuid;body text:=p_reply;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 if t.id is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account for update;
 if j.state<>'drafted' or t.ai_mode<>'auto' or t.paused or j.outgoing_id is not null then return null;end if;

 if j.analysis->>'action' in ('ask_flexibility','ask_payoff') and public.icash_text_property_context(p_account,t.id) is null then return null;end if;
 if p_reply is distinct from (case j.analysis->>'action'
 when 'ask_condition' then 'What repairs or updates does the property need?'
 when 'ask_price' then 'What price did you have in mind?'
 when 'ask_timing' then 'When would you like to sell?'
 when 'ask_owners' then 'Are all property owners on board with selling?'
 when 'ask_occupancy' then 'Is the property vacant, owner occupied, or rented?'
 when 'ask_callback' then 'When is a good time to talk about a cash offer?'
 when 'ask_flexibility' then 'Is there flexibility in your asking price?'
 when 'ask_payoff' then 'Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?' end) then return null;end if;
 if p_reply is null or (j.analysis->>'action') in ('handoff','review') then return null;end if;
 if exists(select 1 from public.icash_text_suppressions where phone=t.recipient) or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 select s.snapshot->>'propertyId' into prop from public.icash_deal_files d join public.icash_screening_jobs s on s.id=d.screening_id and s.account_id=d.account_id where d.id=t.deal_id and d.account_id=p_account and d.stage not in ('closed','cancelled');
 if prop is null or exists(select 1 from public.icash_property_controls where account_id=p_account and property_id=prop and manual) then return null;end if;
 if exists(select 1 from public.icash_text_messages where thread_id=t.id and created_at>(select created_at from public.icash_text_messages where id=j.message_id)) then return null;end if;
 if exists(select 1 from public.icash_text_ai_jobs where thread_id=t.id and id<>j.id and outgoing_id is not null and analysis->>'action'=j.analysis->>'action') then return null;end if;
 if (select count(*) from public.icash_text_ai_jobs where thread_id=t.id and outgoing_id is not null and created_at>now()-interval '1 day')>=12 then return null;end if;
 if not exists(select 1 from public.icash_text_ai_jobs where thread_id=t.id and outgoing_id is not null) then body:='I am the AI assistant for this property inquiry. '||body;end if;
 outgoing:=public.icash_queue_text(p_account,t.id,j.id,body,'{}');
 update public.icash_text_ai_jobs set outgoing_id=outgoing,state='queued',updated_at=now() where id=j.id;
 return outgoing;
end $function$;

