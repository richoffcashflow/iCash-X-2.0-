begin;
-- Apply once after sms-inbound-campaign, sms-contact-intake, sms-manual-reply-continuity
-- and sms-opener-unstarted-recovery. No provider calls, releases or permission changes.
create table public.icash_sms_seller_openings(
 thread_id uuid primary key references public.icash_text_threads(id),
 account_id uuid not null references public.icash_accounts(id),
 owner_question_id uuid not null unique references public.icash_text_messages(id),
 owner_reply_id uuid unique references public.icash_text_messages(id),
 interest_message_id uuid unique references public.icash_text_messages(id),
 check((owner_reply_id is null)=(interest_message_id is null))
);
alter table public.icash_sms_seller_openings enable row level security;
revoke all on public.icash_sms_seller_openings from public,anon,authenticated;
grant all on public.icash_sms_seller_openings to service_role;

create or replace function public.icash_queue_seller_opener(p_account uuid,p_thread uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare t public.icash_text_threads;d public.icash_deal_files;principal text;address text;seller text;greeting text:='Hi, ';message_body text;message uuid;
begin
 if not public.icash_sms_inbound_campaign_current(p_account) then return null;end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='seller' and not paused and ai_mode='auto' and permission_until>now() for update;
 if not found or exists(select 1 from public.icash_seller_opener_assignments where thread_id=t.id)
  or exists(select 1 from public.icash_text_messages where thread_id=t.id and (state in ('ready','dispatching','needs_review') or created_at>now()-interval '1 day')) then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage not in ('closed','cancelled') and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select trim(i.principal) into principal from public.icash_customer_identities i where i.account_id=p_account;
 address:=trim(d.terms->>'address');
 if coalesce(length(address),0)=0 or coalesce(length(principal),0)=0 then return null;end if;
 -- A property-record owner is not necessarily the person replying. Use only
 -- a strict self-introduction from this same contact after an actually sent text.
 -- Capture the FIRST name, never disclose terms.seller or another recorded owner.
 select substring(m.body from '^(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[ ''-][A-Z][a-z]{1,24}){0,2}[.!]?$') into seller
 from public.icash_text_messages m
 where m.thread_id=t.id and m.account_id=p_account and m.direction='incoming' and m.state='received'
 and m.body ~ '^(?:[Tt]his is|[Mm]y name is|I''m|I am) ([A-Z][a-z]{1,24})(?:[ ''-][A-Z][a-z]{1,24}){0,2}[.!]?$'
 and exists(select 1 from public.icash_text_messages sent where sent.thread_id=t.id and sent.account_id=p_account and sent.direction='outgoing' and sent.state in ('accepted','delivered') and sent.provider_id is not null and sent.created_at<m.created_at)
 order by m.created_at desc,m.id desc limit 1;
 if lower(seller) in ('interested','owner','selling','ready','not','yes','no') then seller:=null;end if;
 if seller is not null then greeting:='Hi '||seller||', ';end if;
 message_body:=greeting||'I am the AI assistant for '||principal||'. Is this the owner of '||address||'? Reply STOP to opt out.';
 -- Retain the existing one-segment rate. Never silently truncate identity/address or bill extra segments.
 if length(message_body)>160 or message_body ~ '[^A-Za-z0-9 .,!?]' then return null;end if;
 if public.icash_assign_seller_opener(p_account,t.id) is null then return null;end if;
 update public.icash_seller_opener_assignments a set body=message_body where a.thread_id=t.id and a.account_id=p_account and a.message_id is null;
 message:=public.icash_queue_text(p_account,t.id,t.id,message_body,'{}');
 insert into public.icash_sms_seller_openings(thread_id,account_id,owner_question_id) values(t.id,p_account,message);
 return message;
end $$;

-- Existing already-sent campaign questions retain their existing interpretation. For
-- new conversations only, an invitation must answer the SENT all-cash question.
do $patch$declare definition text;needle text;replacement text;begin
 definition:=pg_get_functiondef('public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)'::regprocedure);
 needle:=$n$ select msg.* into opener from public.icash_seller_opener_assignments a join public.icash_text_messages msg on msg.id=a.message_id and msg.account_id=a.account_id and msg.thread_id=a.thread_id where a.thread_id=t.id and a.account_id=p_account and msg.state in ('accepted','delivered') and msg.provider_id is not null and not a.opted_out;$n$;
 replacement:=$n$ select msg.* into opener from public.icash_seller_opener_assignments a
 left join public.icash_sms_seller_openings opening on opening.thread_id=a.thread_id and opening.account_id=a.account_id
 join public.icash_text_messages msg on msg.id=case when opening.thread_id is null then a.message_id else opening.interest_message_id end and msg.account_id=a.account_id and msg.thread_id=a.thread_id
 where a.thread_id=t.id and a.account_id=p_account and msg.state in ('accepted','delivered') and msg.provider_id is not null and not a.opted_out;$n$;
 if position(needle in definition)=0 then raise exception 'SMS invitation anchor implementation changed';end if;
 execute replace(definition,needle,replacement);
end $patch$;
alter function public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid) rename to icash_prepare_sms_reply_before_owner_question;
create function public.icash_prepare_sms_inbound_reply(p_account uuid,p_thread uuid,p_reply uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare t public.icash_text_threads;m public.icash_text_messages;question public.icash_text_messages;opening public.icash_sms_seller_openings;outgoing uuid;
begin
 select * into opening from public.icash_sms_seller_openings where thread_id=p_thread and account_id=p_account;
 if not found then return public.icash_prepare_sms_reply_before_owner_question(p_account,p_thread,p_reply);end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account for update;
 select * into opening from public.icash_sms_seller_openings where thread_id=t.id and account_id=p_account for update;
 if opening.owner_reply_id=p_reply then return null;end if;
 if opening.interest_message_id is not null then return public.icash_prepare_sms_reply_before_owner_question(p_account,p_thread,p_reply);end if;
 if not public.icash_sms_inbound_campaign_current(p_account) or t.party<>'seller' or t.paused or t.ai_mode<>'auto'
  or t.permission_until is null or t.permission_until<=now()
  or exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
  or not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then return null;end if;
 select * into m from public.icash_text_messages where id=p_reply and thread_id=t.id and account_id=p_account and direction='incoming' and state='received';
 if not found then return null;end if;
 select * into question from public.icash_text_messages where id=opening.owner_question_id and account_id=p_account and thread_id=t.id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null;
 -- Whole-message answers only. A bare interested reply is not ownership confirmation.
 if question.id is null or m.created_at<question.created_at
  or lower(trim(m.body)) !~ '^(yes|yeah|yep|yes i am|i am|i am the owner|i''m the owner|yes i am the owner|yes that is me|yes that''s me)[.! ,]*$'
  or exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.account_id=p_account and x.id not in (m.id,question.id) and x.created_at>=question.created_at) then return null;end if;
 outgoing:=public.icash_queue_text(p_account,t.id,m.id,'Would you be interested in selling your property for all cash? Reply STOP to opt out.','{}');
 update public.icash_sms_seller_openings set owner_reply_id=m.id,interest_message_id=outgoing where thread_id=t.id and account_id=p_account;
 return outgoing;
end $$;

-- Reuse the same atomic claim and its consent, DNC, timing, wallet, rate, cost,
-- account and campaign checks. A later reply always invalidates a queued question.
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_owner_question;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare opening public.icash_sms_seller_openings;reply public.icash_text_messages;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into opening from public.icash_sms_seller_openings where interest_message_id=p_message and account_id=p_account;
 if found then
  perform 1 from public.icash_text_threads where id=opening.thread_id and account_id=p_account for update;
  select * into reply from public.icash_text_messages where id=opening.owner_reply_id and thread_id=opening.thread_id and account_id=p_account and direction='incoming' and state='received';
  if reply.id is null or lower(trim(reply.body)) !~ '^(yes|yeah|yep|yes i am|i am|i am the owner|i''m the owner|yes i am the owner|yes that is me|yes that''s me)[.! ,]*$'
   or not exists(select 1 from public.icash_text_messages where id=opening.owner_question_id and thread_id=opening.thread_id and account_id=p_account and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null)
   or exists(select 1 from public.icash_text_messages where thread_id=opening.thread_id and account_id=p_account and direction='incoming' and id<>reply.id and created_at>=reply.created_at)
   or not exists(select 1 from public.icash_text_messages where id=p_message and account_id=p_account and thread_id=opening.thread_id and body='Would you be interested in selling your property for all cash? Reply STOP to opt out.') then return null;end if;
 end if;
 return public.icash_claim_text_before_owner_question(p_account,p_message,p_sender);
end $$;

-- New questions use existing seller_opener worker tickets. Every send still has its
-- own existing price reservation. At most three capabilities may be issued, and
-- only for a provably unstarted question. No provider retries or broader admission.
alter function public.icash_next_automation() rename to icash_next_before_owner_question;
create function public.icash_next_automation() returns jsonb language plpgsql security invoker set search_path='' as $$
declare candidate record;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 if exists(select 1 from public.icash_operating_budget where id=1 and enabled)
  and not exists(select 1 from public.icash_automation_tickets where kind='seller_opener' and created_at>now()-interval '1 minute') then
  select o.account_id,m.id as message_id,coalesce(history.attempt,0)+1 as attempt into candidate from public.icash_sms_seller_openings o
  join public.icash_text_messages m on m.id=o.interest_message_id and m.account_id=o.account_id and m.thread_id=o.thread_id and m.state='ready' and m.provider_id is null and m.last_delivery_at is null
  join public.icash_text_threads t on t.id=o.thread_id and t.account_id=o.account_id and not t.paused and t.ai_mode='auto' and t.permission_until>now()
  join public.icash_accounts a on a.id=t.account_id and not a.bot_paused
  cross join lateral(select count(*) as total,max(issue_attempts) as attempt from public.icash_automation_tickets where opener_message_id=m.id) history
  left join lateral(select * from public.icash_automation_tickets where opener_message_id=m.id order by created_at desc,id desc limit 1) previous on true
  where public.icash_sms_inbound_campaign_current(t.account_id) and public.icash_sms_thread_review_current(t.account_id,t.id,true)
  and (history.total=0 or (history.total between 1 and 2 and history.attempt between 1 and 2
   and previous.account_id=t.account_id and previous.kind='seller_opener'
   and ((previous.state='issued' and previous.expires_at<=now()) or (previous.state='held' and previous.outcome in ('expired','message_held','messaging_configuration_required','business_number_mismatch','business_number_verification_required')))))
  and not exists(select 1 from public.icash_automation_tickets active where active.opener_message_id=m.id and (active.state='consumed' or (active.state='issued' and active.expires_at>now()) or active.account_id<>t.account_id or active.kind<>'seller_opener'))
  and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||m.id)
  and not exists(select 1 from public.icash_text_messages newer join public.icash_text_messages replied on replied.id=o.owner_reply_id where newer.thread_id=t.id and newer.account_id=t.account_id and newer.direction='incoming' and newer.id<>replied.id and newer.created_at>=replied.created_at)
  order by m.created_at,m.id for update of t,m skip locked limit 1;
  if found then
   insert into public.icash_automation_tickets(account_id,kind,opener_message_id,issue_attempts) values(candidate.account_id,'seller_opener',candidate.message_id,candidate.attempt) returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
 end if;
 return public.icash_next_before_owner_question();
end $$;
revoke all on function public.icash_queue_seller_opener(uuid,uuid),public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid),public.icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_owner_question(uuid,uuid,text),public.icash_next_automation(),public.icash_next_before_owner_question() from public,anon,authenticated;
grant execute on function public.icash_queue_seller_opener(uuid,uuid),public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid),public.icash_prepare_sms_reply_before_owner_question(uuid,uuid,uuid),public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_owner_question(uuid,uuid,text),public.icash_next_automation(),public.icash_next_before_owner_question() to service_role;
commit;
