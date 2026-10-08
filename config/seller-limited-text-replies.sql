begin;
set local lock_timeout='2s';
create table public.icash_seller_limited_text_replies(
 account_id uuid not null references public.icash_accounts(id),thread_id uuid not null references public.icash_text_threads(id),
 source_id uuid not null unique references public.icash_text_messages(id),message_id uuid unique references public.icash_text_messages(id),
 action text not null check(action in ('ask_payoff','review_received')),body text not null,
 created_at timestamptz not null default now(),primary key(thread_id,action),
 check(body=case action when 'ask_payoff' then 'Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?' else 'Thanks. We need to review the mortgage and title details before moving forward.' end)
);
alter table public.icash_seller_limited_text_replies enable row level security;
revoke all on public.icash_seller_limited_text_replies from public,anon,authenticated;
grant all on public.icash_seller_limited_text_replies to service_role;
create function public.icash_limited_seller_text_current(p_account uuid,p_message uuid) returns boolean language sql stable set search_path='' as $$
 select exists(select 1 from public.icash_seller_limited_text_replies w
 join public.icash_text_messages m on m.id=w.message_id and m.thread_id=w.thread_id and m.account_id=w.account_id
 join public.icash_text_messages s on s.id=w.source_id and s.thread_id=w.thread_id and s.account_id=w.account_id and s.direction='incoming' and s.state='received'
 join public.icash_text_threads t on t.id=w.thread_id and t.account_id=w.account_id
 join public.icash_deal_files d on d.id=t.deal_id and d.account_id=t.account_id
 join public.icash_sms_routes r on r.sender=t.sender and r.recipient=t.recipient and r.account_id=t.account_id
 where w.account_id=p_account and w.message_id=p_message and m.request_key=s.id and m.body=w.body
 and m.direction='outgoing' and cardinality(m.asset_ids)=0 and m.attachments='[]'::jsonb
 and s.route_revision=r.revision and m.route_revision=r.revision and not r.needs_review
 and w.created_at>now()-interval '15 minutes' and s.created_at>now()-interval '15 minutes'
 and not t.paused and not t.manual_only and t.ai_mode='auto' and t.retired_at is null and d.stage='draft'
 and public.icash_seller_limited_contact(p_account,d.screening_id)
 and not exists(select 1 from public.icash_text_messages later where later.thread_id=t.id and later.direction='incoming' and later.created_at>s.created_at));
$$;
create function public.icash_prepare_limited_seller_text(p_account uuid,p_thread uuid,p_reply uuid) returns uuid language plpgsql set search_path='' as $$
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
end $$;
-- Reuse the existing inbound enqueue hook and webhook's source-keyed immediate
-- dispatch. No model request or historical event replay is needed for two fixed replies.
do $patch$
declare definition text;needle text;
begin
 definition:=pg_get_functiondef('public.icash_prepare_sms_inbound_reply(uuid,uuid,uuid)'::regprocedure);
 needle:=' select * into opening from public.icash_sms_seller_openings where thread_id=p_thread and account_id=p_account;';
 if position(needle in definition)=0 then raise exception 'Limited reply enqueue prerequisite changed';end if;
 execute replace(definition,needle,$new$ if exists(select 1 from public.icash_text_threads candidate_thread join public.icash_deal_files candidate_deal on candidate_deal.id=candidate_thread.deal_id and candidate_deal.account_id=candidate_thread.account_id where candidate_thread.id=p_thread and candidate_thread.account_id=p_account and public.icash_seller_limited_contact(p_account,candidate_deal.screening_id)) then
  return public.icash_prepare_limited_seller_text(p_account,p_thread,p_reply);
 end if;
$new$||needle);
 definition:=pg_get_functiondef('public.icash_claim_text_before_owner_question(uuid,uuid,text)'::regprocedure);
 needle:=$old$or m.body='Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?'$old$;
 if position(needle in definition)=0 then raise exception 'Limited reply claim prerequisite changed';end if;
 execute replace(definition,needle,needle||' or public.icash_limited_seller_text_current(p_account,p_message)');
end $patch$;
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_limited_replies;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql set search_path='' as $$
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_seller_limited_text_replies where message_id=p_message)
  and not public.icash_limited_seller_text_current(p_account,p_message) then return null;end if;
 return public.icash_claim_text_before_limited_replies(p_account,p_message,p_sender);
end $$;
alter function public.icash_next_automation() rename to icash_next_before_limited_replies;
create function public.icash_next_automation() returns jsonb language plpgsql set search_path='' as $$
declare work record;ticket public.icash_automation_tickets;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 and enabled for update;
 if found then
  select m.id,m.account_id into work from public.icash_seller_limited_text_replies w join public.icash_text_messages m on m.id=w.message_id
   where m.state='ready' and m.provider_id is null and m.last_delivery_at is null and public.icash_limited_seller_text_current(m.account_id,m.id)
   and not exists(select 1 from public.icash_operation_spend where operation_key='text:'||m.id)
   and not exists(select 1 from public.icash_automation_tickets x where x.opener_message_id=m.id and (x.state='consumed' or (x.state='issued' and x.expires_at>now())))
   and (select count(*) from public.icash_automation_tickets x where x.opener_message_id=m.id)<3 order by w.created_at limit 1;
  if found then
   insert into public.icash_automation_tickets(account_id,kind,opener_message_id) values(work.account_id,'seller_opener',work.id) returning * into ticket;
   return jsonb_build_object('token',ticket.token);
  end if;
 end if;
 return public.icash_next_before_limited_replies();
end $$;
revoke all on function public.icash_limited_seller_text_current(uuid,uuid),public.icash_prepare_limited_seller_text(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_limited_seller_text_current(uuid,uuid),public.icash_prepare_limited_seller_text(uuid,uuid,uuid) to service_role;
revoke all on function public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_limited_replies(uuid,uuid,text),public.icash_next_automation(),public.icash_next_before_limited_replies() from public,anon,authenticated;
grant execute on function public.icash_claim_text(uuid,uuid,text),public.icash_claim_text_before_limited_replies(uuid,uuid,text),public.icash_next_automation(),public.icash_next_before_limited_replies() to service_role;
commit;
