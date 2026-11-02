begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
-- Installed inactive; enable after the matching API has passed its release gate.
create table public.icash_seller_progress_settings(id integer primary key check(id=1),enabled boolean not null default false);
insert into public.icash_seller_progress_settings(id) values(1);
create table public.icash_seller_reply_progress(
 message_id uuid primary key references public.icash_text_messages(id),
 account_id uuid not null references public.icash_accounts(id),thread_id uuid not null references public.icash_text_threads(id),
 deal_id uuid references public.icash_deal_files(id),milestone text not null,
 state text not null check(state in ('pending','waiting','needs_review','superseded','stopped')),
 reason text not null,next_step text not null,wait_trigger text,
 outgoing_id uuid references public.icash_text_messages(id),evidence jsonb not null default '{}',
 next_check_at timestamptz,created_at timestamptz not null default now(),updated_at timestamptz not null default now()
);
create index seller_reply_progress_due on public.icash_seller_reply_progress(next_check_at,message_id) where next_check_at is not null;
alter table public.icash_seller_progress_settings enable row level security;
alter table public.icash_seller_reply_progress enable row level security;
revoke all on public.icash_seller_progress_settings,public.icash_seller_reply_progress from public,anon,authenticated;
grant all on public.icash_seller_progress_settings,public.icash_seller_reply_progress to service_role;
alter table public.icash_text_attention add column progress_reason text;
alter table public.icash_text_attention add column next_step text;
alter table public.icash_text_attention drop constraint icash_text_attention_kind_check;
alter table public.icash_text_attention add constraint icash_text_attention_kind_check check(kind in ('declined','human','callback','withdrawal','campaign_reply','seller_progress'));

-- Observation only: no contact/offer authority, queues, wallet or provider writes.
-- Source, facts and prior actions stay inside the original account and thread.
create function public.icash_refresh_seller_reply_progress(p_account uuid,p_message uuid,p_failure text default null)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;d public.icash_deal_files;s public.icash_screening_jobs;
 j public.icash_text_ai_jobs;o public.icash_text_messages;e public.icash_signing_envelopes;
 status text:='pending';why text:='action_required';step text:='Interpret this reply and select the next supported step.';
 milestone text:='qualification';wake text;due timestamptz:=now()+interval '15 minutes';blockers jsonb:='[]';
 facts jsonb;actions jsonb;customer jsonb;statements jsonb;visits jsonb;conditions jsonb;ctx jsonb;
 source_superseded boolean;human_after boolean;viewing_current boolean;negotiation boolean;has_authority boolean;owner_question boolean;latest_question text;source_at timestamptz;attention_kind text;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found then return null;end if;
 source_at:=to_timestamp(public.icash_sms_reply_time(m.id)::double precision);
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller';
 if not found then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 select * into s from public.icash_screening_jobs where id=d.screening_id and account_id=p_account;
 select * into j from public.icash_text_ai_jobs where message_id=m.id and account_id=p_account and thread_id=t.id;
 select * into o from public.icash_text_messages where id=j.outgoing_id and account_id=p_account and thread_id=t.id and direction='outgoing';
 if o.id is null and j.id is null then
  select * into o from public.icash_text_messages where account_id=p_account and thread_id=t.id and direction='outgoing' and request_key=m.id order by created_at desc,id desc limit 1;
 end if;
 select coalesce(jsonb_agg(distinct f->>'kind'),'[]') into facts
 from public.icash_text_ai_jobs a cross join lateral jsonb_array_elements(case when jsonb_typeof(a.analysis->'facts')='array' then a.analysis->'facts' else '[]' end) f
 where a.account_id=p_account and a.thread_id=t.id and exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.direction='incoming' and x.state='received' and public.icash_sms_reply_time(x.id)<=extract(epoch from source_at) and length(coalesce(f->>'quote',''))>=2 and strpos(x.body,f->>'quote')>0);
 select coalesce(jsonb_agg(distinct a.analysis->>'action'),'[]') into actions from public.icash_text_ai_jobs a
 join public.icash_text_messages x on x.id=a.outgoing_id and x.account_id=a.account_id and x.thread_id=a.thread_id
 where a.account_id=p_account and a.thread_id=t.id and a.id is distinct from j.id and a.analysis->>'action' is not null;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'body',left(x.body,1000),'state',x.state,'delivered',x.state='delivered' and x.provider_id is not null) order by x.created_at),'[]') into customer
 from (select * from public.icash_text_messages where account_id=p_account and thread_id=t.id and direction='outgoing' and customer_author_id is not null and created_at<=source_at order by created_at desc,id desc limit 24) x;
 select coalesce(jsonb_agg(jsonb_build_object('id',x.id,'quote',left(x.body,1000)) order by x.created_at) filter(where x.body ~* '(\$[0-9]|[0-9][0-9,]* ?k\M|asking price|works for me|accept.*offer|agree.*price)'),'[]'),
 coalesce(jsonb_agg(jsonb_build_object('id',x.id,'quote',left(x.body,1000)) order by x.created_at) filter(where x.body ~* '\m(visit|showing|view the (house|property)|come (see|look))\M'),'[]'),
 coalesce(jsonb_agg(jsonb_build_object('id',x.id,'quote',left(x.body,1000)) order by x.created_at) filter(where x.body ~* '\m(no (3rd|third)[ -]part(y|ies)|no (middlem(e|a)n|wholesalers)|direct buyers? only)\M'),'[]')
 into statements,visits,conditions from (select * from public.icash_text_messages where account_id=p_account and thread_id=t.id and direction='incoming' and state='received' and public.icash_sms_reply_time(id)<=extract(epoch from source_at) order by created_at desc,id desc) x;
 negotiation:=exists(select 1 from jsonb_array_elements(customer) x where x->>'state' in ('accepted','delivered') and x->>'body' ~* '(\$[0-9]|[0-9][0-9,]* ?k\M|assign(or|ee|ment)|finders fee)');
 has_authority:=exists(select 1 from public.icash_offer_authorities a where a.account_id=p_account and a.screening_id=d.screening_id and a.expires_at>now());
 select * into e from public.icash_signing_envelopes where account_id=p_account and deal_id=d.id and kind='purchase' and not test_mode order by created_at desc,id desc limit 1;
 select body into latest_question from public.icash_text_messages where account_id=p_account and thread_id=t.id and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null and created_at<source_at order by created_at desc,id desc limit 1;
 owner_question:=coalesce(latest_question ~* '(the owner of|do you own|your property)',false)
  and exists(select 1 from public.icash_sms_seller_openings x where x.account_id=p_account and x.thread_id=t.id and x.owner_reply_id is null);
 source_superseded:=exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.direction='incoming' and x.state='received' and (public.icash_sms_reply_time(x.id),x.id)>(extract(epoch from source_at),m.id));
 human_after:=exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.direction='outgoing' and x.customer_author_id is not null and x.state in ('accepted','delivered') and x.provider_id is not null and x.created_at>source_at);
 if not exists(select 1 from public.icash_accounts where id=p_account and not bot_paused) then blockers:=blockers||'"account_paused"'::jsonb;end if;
 if t.paused or t.manual_only or t.ai_mode<>'auto' or t.retired_at is not null
  or exists(select 1 from public.icash_property_controls c where c.account_id=p_account and c.property_id=s.snapshot->>'propertyId' and c.manual)
  or exists(select 1 from public.icash_conversations c where c.account_id=p_account and c.deal_id=d.id and c.human_takeover)
 then blockers:=blockers||'"manual_control"'::jsonb;end if;
 if public.icash_sms_thread_review_current(p_account,t.id,false) is distinct from true then blockers:=blockers||'"contact_checks_required"'::jsonb;end if;
 if source_at<now()-interval '24 hours' then blockers:=blockers||'"historical_reply"'::jsonb;end if;
 if d.id is null or s.id is null or d.stage in ('closed','cancelled') or coalesce(d.terms->>'practice','false')='true' then blockers:=blockers||'"property_review_required"'::jsonb;end if;
 if m.event_id is null and m.provider_id is null then blockers:=blockers||'"source_receipt_missing"'::jsonb;end if;
 viewing_current:=coalesce(public.icash_seller_conversation_context(p_account,t.id)->'sellerViewingAvailability'='true'::jsonb,false);
 if e.id is not null then
  milestone:=case when e.state='completed' and e.provider_id is not null then 'title_handoff' else 'signature_followup' end;
 elsif jsonb_array_length(conditions)>0 then milestone:='buyer_model_review';
 elsif negotiation or (jsonb_array_length(statements)>0 and (d.terms->>'priceCents' is not null or not has_authority)) then milestone:='offer_review';
 elsif jsonb_array_length(visits)>0 then milestone:='visit_coordination';
 elsif facts ?& array['condition','price','timing','owners','occupancy'] then milestone:=case when has_authority then 'contract_preparation' else 'offer_review' end;
 end if;
 if source_superseded then status:='superseded';why:='newer_seller_reply';step:='Continue from the newer source message.';due:=null;
 elsif exists(select 1 from public.icash_text_suppressions where phone=t.recipient) or public.icash_seller_response_disposition(m.body) in ('declined','opt_out') or public.icash_seller_contact_stop(m.body) then
  status:='stopped';why:='contact_stopped';step:='Preserve the refusal or opt-out. Do not resume outreach.';due:=null;
 elsif public.icash_seller_response_disposition(m.body)='review' then status:='needs_review';why:='seller_condition_review';step:='Resolve the seller concern or condition before any further contact or commitment.';due:=null;
 elsif m.body ~* '(message blocking is active|no longer in service|unable to receive message)' then
  status:='stopped';why:='carrier_response';step:='This is a carrier response, not seller interest.';due:=null;
 elsif human_after then status:='waiting';why:='customer_replied';step:='The customer replied. Preserve their conversation and wait for the seller.';wake:='new seller reply';due:=null;
 elsif jsonb_array_length(conditions)>0 and not viewing_current then
  status:='needs_review';why:='third_party_condition';step:='Address the no-third-parties condition honestly. Confirm whether the customer can buy directly or whether assignment is acceptable before offering or arranging the requested visit.';due:=null;
 elsif (negotiation or (jsonb_array_length(statements)>0 and d.terms->>'priceCents' is not null)) and not viewing_current then
  status:='needs_review';why:='price_reconciliation';step:='Reconcile the customer messages, seller price and conditions, saved proposal and current underwriting. Obtain supported offer authority before any commitment or contract.';due:=null;
 elsif jsonb_array_length(visits)>0 and e.id is null then
  status:='needs_review';why:='visit_requested';step:='Coordinate the requested visit: confirm who will attend and collect availability. No appointment is booked. Resolve buyer conditions and contact checks first.';due:=null;
 elsif jsonb_array_length(blockers)>0 then
  status:='needs_review';why:=blockers->>0;step:=case why when 'account_paused' then 'The customer paused the bot. Preserve Pause; the customer must choose whether to resume after current checks.' when 'manual_control' then 'The customer controls this conversation. Preserve takeover and review the latest seller request.' when 'contact_checks_required' then 'Obtain fresh account-bound contact and property checks before the next contact. A note or Return to bot does not renew them.' when 'historical_reply' then 'Review the current conversation and offer facts before contacting this seller. Do not replay an old draft.' else 'Verify the source receipt and property/account binding before continuing.' end;due:=null;
 elsif o.id is not null then
  if o.state='delivered' and o.provider_id is not null then
   status:='waiting';why:='awaiting_seller_reply';step:='Message delivered; wait for the seller. Review follow-up if no reply arrives.';wake:='new seller reply or 24-hour follow-up review';due:=greatest(now(),o.updated_at+interval '24 hours');
   if o.updated_at<now()-interval '24 hours' then status:='needs_review';why:='followup_due';step:='Review a permitted follow-up against the latest conversation and current checks.';due:=null;end if;
  elsif o.state='accepted' and o.provider_id is not null and o.updated_at>now()-interval '15 minutes' then status:='waiting';why:='provider_delivery_pending';step:='The provider accepted the message. Await its delivery receipt; do not resend.';wake:='original provider delivery receipt or 15-minute review';due:=o.updated_at+interval '15 minutes';
  elsif o.state='ready' and o.provider_id is null then why:='awaiting_dispatch';step:='Dispatch the existing source-bound message after final admission.';
  else status:='needs_review';why:=case when o.state in ('failed','undelivered','rejected','cancelled') then 'provider_delivery_failed' else 'provider_receipt_unresolved' end;step:='Reconcile the original provider operation and receipt before deciding another action. Do not resend.';due:=case when why='provider_receipt_unresolved' then now()+interval '1 hour' end;end if;
 elsif e.id is not null and not viewing_current then
  status:='needs_review';why:=case when milestone='title_handoff' then 'title_handoff_review' else 'signature_followup_review' end;
  step:=case when milestone='title_handoff' then 'Verify the completed purchase envelope and the existing fulfillment/title handoff. Do not create another contract.' else 'Inspect the existing envelope and original delivery/signature receipts; follow up through the authorized contract workflow.' end;due:=null;
 elsif owner_question and m.body ~* '(how much|what.*offer|what.*pay)' then
  status:='needs_review';why:='ownership_offer_question';step:='Answer the offer question and clarify ownership. This reply confirms neither ownership nor consent; obtain supported underwriting before quoting a price.';due:=null;
 elsif exists(select 1 from public.icash_sms_call_requests c where c.account_id=p_account and c.thread_id=t.id and c.message_id=m.id and c.state='needs_review') then status:='needs_review';why:='callback_coordination';step:='Resolve the saved callback request with the actual date, time and contact permissions. No appointment is booked.';due:=null;
 elsif j.id is null then status:='needs_review';why:='reply_not_routed';step:='This seller reply has no reply job. Review its question and select the next permitted step.';due:=null;
 elsif j.state in ('needs_review','handoff') or (j.analysis->>'action' in ('review','handoff') and not viewing_current) then
  status:='needs_review';why:=case when milestone='contract_preparation' then 'contract_authorization_review' when milestone='offer_review' then 'supported_offer_required' else 'seller_question_review' end;
  step:=case when milestone='contract_preparation' then 'Confirm seller identity, all owners, reconciled terms and signature authorization using the existing agreement workflow.' when milestone='offer_review' then 'Review current property value, repairs, payoff and buyer fit. Establish a supported offer before negotiation.' else 'Review the seller question and the saved conversation. Choose a supported answer or the next missing qualification step.' end;due:=null;
 elsif j.state='analyzing' and j.updated_at<now()-interval '15 minutes' then status:='needs_review';why:='analysis_receipt_unresolved';step:='The original AI request has no completed result. Reconcile its receipt; do not repeat a potentially charged request.';due:=null;
 end if;
 if status='pending' and p_failure is not null then
  status:='needs_review';why:=case when p_failure in ('action_not_admitted','analysis_not_admitted','analysis_failed','messaging_configuration_required','business_number_mismatch','business_number_verification_required','seller_inventory_unavailable','message_delivery_needs_review','live_work_not_ready','text_ai_configuration_required') then p_failure else 'dispatch_not_admitted' end;
  step:=case when why='action_not_admitted' and actions ? (j.analysis->>'action') then 'This question was already attempted. Choose a different unanswered qualification step or review the next deal milestone.' else 'The next action was blocked at '||why||'. Review the current source, configuration and admission result before continuing.' end;due:=null;
 end if;
 ctx:=jsonb_build_object('sourceAt',source_at,'priorActions',actions,'answered',facts,'customerMessages',customer,'customerNegotiation',negotiation,'priceStatements',statements,'visitRequests',visits,'sellerConditions',conditions,'proposedPriceCents',d.terms->'priceCents','modelEstimateCents',s.result->'preliminarySellerCeilingCents','deliveryState',o.state,'providerReceiptPresent',o.provider_id is not null,'offerAuthorityPresent',has_authority,'offerAuthorized',false,'blockers',blockers,'milestone',milestone,'reviewReason',case when status='needs_review' then why end);
 insert into public.icash_seller_reply_progress(message_id,account_id,thread_id,deal_id,milestone,state,reason,next_step,wait_trigger,outgoing_id,evidence,next_check_at)
 values(m.id,p_account,t.id,d.id,milestone,status,why,step,wake,o.id,ctx,due)
 on conflict(message_id) do update set milestone=excluded.milestone,state=excluded.state,reason=excluded.reason,next_step=excluded.next_step,wait_trigger=excluded.wait_trigger,outgoing_id=excluded.outgoing_id,evidence=excluded.evidence,next_check_at=excluded.next_check_at,updated_at=case when (icash_seller_reply_progress.state,icash_seller_reply_progress.reason,icash_seller_reply_progress.evidence,icash_seller_reply_progress.outgoing_id) is distinct from (excluded.state,excluded.reason,excluded.evidence,excluded.outgoing_id) then now() else icash_seller_reply_progress.updated_at end
 where icash_seller_reply_progress.account_id=excluded.account_id and icash_seller_reply_progress.thread_id=excluded.thread_id;
 if status='needs_review' and d.id is not null then
  -- Reuse the existing campaign/human/callback review for this exact source.
  select kind into attention_kind from public.icash_text_attention where account_id=p_account and thread_id=t.id and message_id=m.id order by created_at,id limit 1;
  attention_kind:=coalesce(attention_kind,'seller_progress');
  insert into public.icash_text_attention(account_id,thread_id,deal_id,screening_id,message_id,kind,party,quote,timezone,progress_reason,next_step)
  values(p_account,t.id,d.id,d.screening_id,m.id,attention_kind,'seller',left(m.body,1000),t.timezone,why,step)
  on conflict(thread_id,kind) do update set message_id=excluded.message_id,quote=excluded.quote,progress_reason=excluded.progress_reason,next_step=excluded.next_step,
   state=case when (icash_text_attention.message_id,icash_text_attention.progress_reason) is distinct from (excluded.message_id,excluded.progress_reason) then 'open' else icash_text_attention.state end,updated_at=case when (icash_text_attention.message_id,icash_text_attention.progress_reason) is distinct from (excluded.message_id,excluded.progress_reason) then now() else icash_text_attention.updated_at end
  where icash_text_attention.account_id=excluded.account_id;
 else
  update public.icash_text_attention a set state='acknowledged',updated_at=now()
   where a.account_id=p_account and a.thread_id=t.id and a.kind='seller_progress' and a.state='open'
   and (a.message_id=m.id or (not source_superseded and exists(select 1 from public.icash_text_messages old_source where old_source.id=a.message_id and old_source.account_id=p_account and (old_source.created_at,old_source.id)<(m.created_at,m.id))));
 end if;
 return jsonb_build_object('state',status,'reason',why,'nextStep',step,'milestone',milestone,'context',ctx,'outgoingId',o.id);
end $$;

create function public.icash_observe_seller_reply_progress() returns trigger language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.icash_seller_progress_settings where id=1 and enabled) then return new;end if;
 if new.direction='incoming' and new.state='received' then
  perform 1 from public.icash_operating_budget where id=1 for update;
  perform public.icash_refresh_seller_reply_progress(new.account_id,new.id);
 end if;
 return new;
end $$;
-- Receipt observation is done after the writer transaction by finish/sweep; never
-- acquire the budget lock from a trigger holding an outgoing provider receipt row.
create trigger zz_seller_reply_progress after insert on public.icash_text_messages for each row execute function public.icash_observe_seller_reply_progress();

create function public.icash_seller_progress_gate(p_account uuid,p_job uuid) returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;r jsonb;
begin
 if not exists(select 1 from public.icash_seller_progress_settings where id=1 and enabled) then return true;end if;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 if not found then return false;end if;
 if not exists(select 1 from public.icash_text_threads where id=j.thread_id and account_id=p_account and party='seller') then return true;end if;
 r:=public.icash_refresh_seller_reply_progress(p_account,j.message_id);
 if r->>'state'='pending' then return true;end if;
 update public.icash_text_ai_jobs set state=case when r->>'state'='superseded' then 'superseded' else 'needs_review' end,updated_at=now()
 where id=j.id and account_id=p_account and state in ('pending','issued','drafted') and outgoing_id is null;
 return false;
end $$;

-- Retain the original send functions, their locks and final admission checks.
alter function public.icash_queue_ai_reply(uuid,uuid,text) rename to icash_queue_ai_reply_before_progress;
create function public.icash_queue_ai_reply(p_account uuid,p_job uuid,p_reply text) returns uuid language plpgsql security invoker set search_path='' as $$
declare mid uuid;j public.icash_text_ai_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not public.icash_seller_progress_gate(p_account,p_job) then return null;end if;
 mid:=public.icash_queue_ai_reply_before_progress(p_account,p_job,p_reply);
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 if exists(select 1 from public.icash_seller_progress_settings where enabled) then perform public.icash_refresh_seller_reply_progress(p_account,j.message_id,case when mid is null then 'action_not_admitted' end);end if;
 return mid;
end $$;
alter function public.icash_queue_seller_conversation_reply(uuid,uuid) rename to icash_queue_seller_reply_before_progress;
create function public.icash_queue_seller_conversation_reply(p_account uuid,p_job uuid) returns uuid language plpgsql security invoker set search_path='' as $$
declare mid uuid;j public.icash_text_ai_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not public.icash_seller_progress_gate(p_account,p_job) then return null;end if;
 mid:=public.icash_queue_seller_reply_before_progress(p_account,p_job);
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 if exists(select 1 from public.icash_seller_progress_settings where enabled) then perform public.icash_refresh_seller_reply_progress(p_account,j.message_id,case when mid is null then 'action_not_admitted' end);end if;
 return mid;
end $$;
alter function public.icash_claim_text_ai(uuid,uuid) rename to icash_claim_text_ai_before_progress;
create function public.icash_claim_text_ai(p_account uuid,p_job uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare result jsonb;j public.icash_text_ai_jobs;r jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not public.icash_seller_progress_gate(p_account,p_job) then return null;end if;
 result:=public.icash_claim_text_ai_before_progress(p_account,p_job);
 if not exists(select 1 from public.icash_seller_progress_settings where enabled) then return result;end if;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 r:=public.icash_refresh_seller_reply_progress(p_account,j.message_id,case when result is null then 'analysis_not_admitted' end);
 if result is null or r is null then return result;end if;
 return jsonb_set(result,'{context}',coalesce(result->'context','{}')||jsonb_build_object('sellerProgress',r->'context'));
end $$;
alter function public.icash_claim_text(uuid,uuid,text) rename to icash_claim_text_before_progress;
create function public.icash_claim_text(p_account uuid,p_message uuid,p_sender text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message;
 if found and not public.icash_seller_progress_gate(p_account,j.id) then return null;end if;
 return public.icash_claim_text_before_progress(p_account,p_message,p_sender);
end $$;

-- A saved draft resumes from its existing analysis, never another charged LLM call.
create function public.icash_resume_seller_text_ai(p_account uuid,p_job uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;mid uuid;body text;r jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from public.icash_seller_progress_settings where enabled) then return jsonb_build_object('mode','analyze');end if;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account for update;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account;
 if t.party is distinct from 'seller' then return jsonb_build_object('mode','analyze');end if;
 if not public.icash_seller_progress_gate(p_account,p_job) then return jsonb_build_object('mode','held');end if;
 if j.outgoing_id is not null then
  if exists(select 1 from public.icash_text_messages where id=j.outgoing_id and account_id=p_account and thread_id=t.id and state='ready' and provider_id is null) then return jsonb_build_object('mode','dispatch','messageId',j.outgoing_id);end if;
  return jsonb_build_object('mode','held');
 end if;
 if j.state<>'drafted' then return jsonb_build_object('mode','analyze');end if;
 if public.icash_seller_conversation_context(p_account,t.id) is not null then mid:=public.icash_queue_seller_conversation_reply(p_account,p_job);
 elsif t.seller_intake_id is null then
  body:=case j.analysis->>'action' when 'ask_condition' then 'What repairs or updates does the property need?' when 'ask_price' then 'What price did you have in mind?' when 'ask_timing' then 'When would you like to sell?' when 'ask_owners' then 'Are all property owners on board with selling?' when 'ask_occupancy' then 'Is the property vacant, owner occupied, or rented?' when 'ask_callback' then 'When is a good time to talk about a cash offer?' when 'ask_flexibility' then 'Is there flexibility in your asking price?' when 'ask_payoff' then 'Are there any mortgages, liens, or unpaid taxes that would need to be paid at closing?' end;
  if body is not null then mid:=public.icash_queue_ai_reply(p_account,p_job,body);end if;
 end if;
 if mid is not null then return jsonb_build_object('mode','dispatch','messageId',mid);end if;
 perform public.icash_refresh_seller_reply_progress(p_account,j.message_id,'action_not_admitted');
 update public.icash_text_ai_jobs set state='needs_review',updated_at=now() where id=j.id and account_id=p_account and state='drafted' and outgoing_id is null;
 return jsonb_build_object('mode','held');
end $$;

create function public.icash_finish_seller_text_progress(p_account uuid,p_job uuid,p_status text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;r jsonb;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 if not exists(select 1 from public.icash_seller_progress_settings where enabled) then return null;end if;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 r:=public.icash_refresh_seller_reply_progress(p_account,j.message_id,p_status);
 if r->>'state'='needs_review' then update public.icash_text_ai_jobs set state='needs_review',updated_at=now() where id=j.id and account_id=p_account and outgoing_id is null and state in ('pending','issued','drafted');end if;
 return r;
end $$;

-- Bounded observation + fresh saved-draft recovery under the existing scheduler lock.
alter function public.icash_issue_due_text_ai() rename to icash_issue_due_text_ai_before_progress;
create function public.icash_issue_due_text_ai() returns jsonb language plpgsql security invoker set search_path='' as $$
declare p record;j public.icash_text_ai_jobs;t public.icash_automation_tickets;r jsonb;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_seller_progress_settings where enabled) then
  for p in select account_id,message_id from public.icash_seller_reply_progress where next_check_at<=now() order by next_check_at,message_id limit 20 loop
   perform public.icash_refresh_seller_reply_progress(p.account_id,p.message_id);
  end loop;
  if not exists(select 1 from public.icash_automation_tickets where kind='text_ai' and created_at>now()-interval '10 seconds') then
   for j in select q.* from public.icash_text_ai_jobs q join public.icash_text_threads th on th.id=q.thread_id and th.account_id=q.account_id and th.party='seller'
    where q.state='drafted' and q.next_attempt_at<=now() order by q.created_at limit 10 for update of q skip locked loop
    if public.icash_seller_progress_gate(j.account_id,j.id) then
     update public.icash_text_ai_jobs set next_attempt_at=now()+interval '15 minutes' where id=j.id;
     insert into public.icash_automation_tickets(account_id,kind,text_ai_job_id) values(j.account_id,'text_ai',j.id) returning * into t;
     return jsonb_build_object('token',t.token);
    end if;
   end loop;
  end if;
 end if;
 return public.icash_issue_due_text_ai_before_progress();
end $$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
 'icash_refresh_seller_reply_progress','icash_observe_seller_reply_progress','icash_seller_progress_gate','icash_queue_ai_reply','icash_queue_ai_reply_before_progress','icash_queue_seller_conversation_reply','icash_queue_seller_reply_before_progress','icash_claim_text_ai','icash_claim_text_ai_before_progress','icash_claim_text','icash_claim_text_before_progress','icash_resume_seller_text_ai','icash_finish_seller_text_progress','icash_issue_due_text_ai','icash_issue_due_text_ai_before_progress') loop
 execute format('revoke all on function %s from public,anon,authenticated',f.signature);
 execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
