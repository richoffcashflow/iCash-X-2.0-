CREATE OR REPLACE FUNCTION public.icash_seller_dialogue_reply(p_account uuid, p_job uuid)
 RETURNS text
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;m public.icash_text_messages;s public.icash_screening_jobs;d public.icash_deal_files;c jsonb;
begin
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account and state in ('drafted','queued');
 if not found or j.analysis->>'dialoguePolicy' is distinct from 'seller-dialogue-v1' then return null;end if;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account and party='seller' and not paused and not manual_only and ai_mode='auto' and retired_at is null;
 if not found or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account and state='complete' and completed_at between now()-interval '24 hours' and now() and (result->'financialCheck'->>'status'='eligible' or (j.analysis->>'dialogueAction'='clarify_ownership' and public.icash_seller_limited_contact(p_account,id)));
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
end $function$;

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
 else if not public.icash_confirmed_seller_contract_text_current(p_account,p_message) and not public.icash_customer_authored_text(p_account,p_message) and not public.icash_seller_recovery_nonprice_current(p_account,p_message) and not (exists(select 1 from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and analysis->>'offerPolicy'='seller-text-offer-v1') and public.icash_seller_conversation_message_current(p_account,p_message)) and not (public.icash_seller_limited_contact(p_account,s.id) and (exists(select 1 from public.icash_sms_seller_openings opening where opening.thread_id=t.id and opening.owner_question_id=m.id) or m.body='Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?' or public.icash_limited_seller_text_current(p_account,p_message)
   or (exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=t.id and j.outgoing_id=m.id and j.analysis->>'dialoguePolicy'='seller-dialogue-v1' and j.analysis->>'dialogueAction'='clarify_ownership') and public.icash_seller_conversation_message_current(p_account,p_message)))) and (s.result->'financialCheck'->>'status' is distinct from 'eligible' or s.completed_at is null or s.completed_at>now() or s.completed_at<now()-interval '24 hours') then return null;end if; end if;

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
end $function$;
