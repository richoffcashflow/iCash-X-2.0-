begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_seller_progress_settings add column buyer_reply_enabled boolean not null default false,add column buyer_reply_enabled_at timestamptz;
create table public.icash_buyer_reply_progress(
 message_id uuid primary key references public.icash_text_messages(id),account_id uuid not null references public.icash_accounts(id),thread_id uuid not null references public.icash_text_threads(id),
 state text not null,reason text not null,next_step text not null,wait_trigger text,outgoing_id uuid references public.icash_text_messages(id),updated_at timestamptz not null default now()
);
alter table public.icash_buyer_reply_progress enable row level security;
revoke all on public.icash_buyer_reply_progress from public,anon,authenticated;
grant all on public.icash_buyer_reply_progress to service_role;

alter function public.icash_buyer_factual_text(uuid,uuid,text) rename to icash_buyer_reply_before_progress;
create function public.icash_buyer_factual_text(p_account uuid,p_thread uuid,p_incoming text) returns text language plpgsql stable security invoker set search_path='' as $$
declare t public.icash_text_threads;p jsonb;b text;answer text;price text;
begin
 if not exists(select 1 from public.icash_seller_progress_settings cfg join public.icash_text_messages src on src.account_id=p_account and src.thread_id=p_thread and src.direction='incoming' and src.state='received' and src.body=p_incoming
  where cfg.buyer_reply_enabled and public.icash_sms_reply_time(src.id)>=extract(epoch from cfg.buyer_reply_enabled_at) and public.icash_sms_reply_time(src.id) between extract(epoch from now()-interval '24 hours') and extract(epoch from now())) then return public.icash_buyer_reply_before_progress(p_account,p_thread,p_incoming);end if;
 select * into t from public.icash_text_threads where id=p_thread and account_id=p_account and party='buyer';if not found then return null;end if;
 p:=public.icash_buyer_package_data(p_account,t.deal_id);if p is null then return null;end if;
 b:=lower(trim(p_incoming));
 if b is null or length(b)>500 or b ~ '\m(stop|unsubscribe|cancel|not interested|no thanks|human|real person|wire|bank|lawsuit|attorney)\M' then return public.icash_buyer_reply_before_progress(p_account,p_thread,p_incoming);end if;
 if p->'reserved'='true'::jsonb then return public.icash_buyer_reply_before_progress(p_account,p_thread,p_incoming);end if;
 if p->>'askingPriceCents' ~ '^[1-9][0-9]{0,11}$' then price:='$'||to_char((p->>'askingPriceCents')::numeric/100,'FM999,999,999,990.00');end if;
 -- A buyer counteroffer is a negotiation turn, not authority to discount the
 -- published deal, disclose the seller price or take payment.
 if price is not null and (b ~ '^(i (can offer|offer|would pay|can pay|will pay|would take it for)|would you (take|accept)|can you (take|do|accept)) \$?[0-9][0-9,.]* ?k?[?! .]*$'
  or b ~ '^(can you (do (any )?better|lower the price)|is (the )?price negotiable|that(''s| is) too (high|expensive))[?! .]*$') then
  return 'The current buyer price is '||price||', including our fee, plus buyer closing costs. Would that work, or what property detail concerns you?';
 end if;
 answer:=public.icash_buyer_reply_before_progress(p_account,p_thread,p_incoming);
 if answer is null or public.icash_sms_single_segment(answer) then return answer;end if;
 -- Preserve factual distinctions while fitting the approved single-SMS rate.
 -- Never truncate off a condition, payment disclaimer or privacy restriction.
 if b ~ '\m(title|escrow)\M' then
  return case p->>'titleSelectionStatus' when 'selected' then 'A title contact is selected. A different closer needs confirmation. What company and contact do you prefer?'
   when 'needs_confirmation' then 'The recorded title contact still needs confirmation for this transaction. What company and contact do you prefer?'
   else 'Title is not selected yet. Which local title company and contact have you used for an assignment closing?' end;
 elsif b ~ '\m(deposit|payment|pay)\M' then return 'Use verified receiving details from the deal contact after agreement review. A signed assignment and verified cleared deposit are needed to reserve it.';
 elsif b ~ '\m(view|viewing|visit|showing|access)\M' then return 'A visit needs seller or occupant confirmation. What date, time and time zone work for you?';
 elsif price is not null and b ~ '\m(price|fee|spread|margin|profit|how much)\M' then return 'Buyer price: '||price||', including our fee, plus buyer closing costs. Internal acquisition pricing and margins are private.';
 end if;
 return null;
end $$;

-- Remove the lifetime same-answer dead end. Idempotency is per incoming source;
-- receipt uncertainty, newer messages, manual controls and final admission still
-- prevent retries. A later price question may receive the current price again.
do $patch$declare definition text;old text;begin
 definition:=pg_get_functiondef('public.icash_queue_buyer_factual_reply(uuid,uuid)'::regprocedure);
 old:='if exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.direction=''outgoing'' and x.body=reply_body) then return null;end if;';
 if position(old in definition)=0 then raise exception 'Buyer duplicate gate changed';end if;
 definition:=replace(definition,old,$r$if not exists(select 1 from public.icash_seller_progress_settings where buyer_reply_enabled) then
  if exists(select 1 from public.icash_text_messages x where x.thread_id=t.id and x.direction='outgoing' and x.body=reply_body) then return null;end if;
 end if;
 if exists(select 1 from public.icash_text_messages x where x.account_id=p_account and x.thread_id=t.id and x.direction='outgoing' and x.state in ('ready','dispatching','accepted') and x.created_at<m.created_at) then return null;end if;$r$);
 execute definition;
end $patch$;

alter function public.icash_resume_seller_text_ai(uuid,uuid) rename to icash_resume_text_before_buyer_progress;
create function public.icash_resume_seller_text_ai(p_account uuid,p_job uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;m public.icash_text_messages;mid uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account and party='buyer';
 if not found or not exists(select 1 from public.icash_seller_progress_settings where buyer_reply_enabled and buyer_reply_enabled_at is not null and public.icash_sms_reply_time(j.message_id)>=extract(epoch from buyer_reply_enabled_at)) then return public.icash_resume_text_before_buyer_progress(p_account,p_job);end if;
 if j.outgoing_id is not null then
  if j.state='queued' and exists(select 1 from public.icash_text_messages where id=j.outgoing_id and account_id=p_account and thread_id=t.id and state='ready' and provider_id is null) then return jsonb_build_object('mode','dispatch','messageId',j.outgoing_id);end if;
  return jsonb_build_object('mode','held');
 end if;
 select * into m from public.icash_text_messages where id=j.message_id and account_id=p_account and thread_id=t.id and direction='incoming' and state='received';
 if j.state in ('pending','issued','drafted') and j.provider_id is null and j.usage is null and (m.provider_id is not null or m.event_id is not null)
  and public.icash_sms_reply_time(m.id) between extract(epoch from now()-interval '24 hours') and extract(epoch from now())
  and public.icash_buyer_factual_text(p_account,t.id,m.body) is not null then
  update public.icash_text_ai_jobs set state='drafted',analysis=jsonb_build_object('action','review','facts','[]'::jsonb),updated_at=now() where id=j.id and account_id=p_account;
  mid:=public.icash_queue_buyer_factual_reply(p_account,j.id);
  if mid is not null then return jsonb_build_object('mode','dispatch','messageId',mid);end if;
  return jsonb_build_object('mode','held');
 end if;
 return public.icash_resume_text_before_buyer_progress(p_account,p_job);
end $$;

alter function public.icash_finish_seller_text_progress(uuid,uuid,text) rename to icash_finish_text_before_buyer_progress;
create function public.icash_finish_seller_text_progress(p_account uuid,p_job uuid,p_status text default null) returns jsonb language plpgsql security invoker set search_path='' as $$
declare j public.icash_text_ai_jobs;t public.icash_text_threads;m public.icash_text_messages;o public.icash_text_messages;d public.icash_deal_files;result_state text;reason text;step text;wake text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_text_ai_jobs where id=p_job and account_id=p_account;
 select * into t from public.icash_text_threads where id=j.thread_id and account_id=p_account and party='buyer';
 if not found or not exists(select 1 from public.icash_seller_progress_settings where buyer_reply_enabled) then return public.icash_finish_text_before_buyer_progress(p_account,p_job,p_status);end if;
 select * into m from public.icash_text_messages where id=j.message_id and account_id=p_account and thread_id=t.id;
 select * into o from public.icash_text_messages where id=j.outgoing_id and account_id=p_account and thread_id=t.id;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 if exists(select 1 from public.icash_text_suppressions where phone=t.recipient) or m.body ~* '\m(stop|unsubscribe|not interested|no thanks)\M' then result_state:='stopped';reason:='buyer_contact_stopped';step:='Preserve the buyer refusal or opt-out.';
 elsif exists(select 1 from public.icash_text_messages newer where newer.account_id=p_account and newer.thread_id=t.id and newer.direction='incoming' and newer.state='received' and (public.icash_sms_reply_time(newer.id),newer.id)>(public.icash_sms_reply_time(m.id),m.id)) then result_state:='superseded';reason:='newer_buyer_reply';step:='Continue from the newer buyer source.';
 elsif o.state='delivered' and o.provider_id is not null then result_state:='waiting';reason:='awaiting_buyer_reply';step:='Message delivered. Continue from the next buyer reply or the existing buyer journey.';wake:='buyer reply or journey deadline';
 elsif o.state='accepted' and o.provider_id is not null and o.updated_at>now()-interval '15 minutes' then result_state:='waiting';reason:='provider_delivery_pending';step:='Await the original provider receipt; do not resend.';wake:='original provider delivery receipt or 15-minute reconciliation';
 elsif o.id is null and exists(select 1 from public.icash_text_messages prior where prior.account_id=p_account and prior.thread_id=t.id and prior.direction='outgoing' and prior.state in ('accepted','dispatching') and prior.updated_at>now()-interval '15 minutes' and prior.created_at<m.created_at) then
  result_state:='waiting';reason:='prior_delivery_pending';step:='Wait for the prior answer delivery before responding to this newer source.';wake:='original delivery receipt or 15-minute reconciliation';
  update public.icash_text_ai_jobs set state='pending',next_attempt_at=now()+interval '1 minute',updated_at=now() where id=j.id and state in ('pending','issued','drafted') and provider_id is null and usage is null;
 elsif o.id is null and exists(select 1 from public.icash_deal_journeys where account_id=p_account and deal_id=d.id and thread_id=t.id and state<>'closed') then result_state:='waiting';reason:='buyer_journey_active';step:='Continue buyer details, viewing or assignment through the existing journey.';wake:='buyer details, showing confirmation, signature or deposit receipt';
 else
  result_state:='needs_review';reason:=case when t.paused or t.manual_only or t.ai_mode<>'auto' then 'buyer_manual_control' when exists(select 1 from public.icash_accounts where id=p_account and bot_paused) then 'account_paused' when public.icash_sms_thread_review_current(p_account,t.id,false) is distinct from true then 'contact_checks_required' when o.id is not null then 'buyer_delivery_unresolved' else 'buyer_next_action_required' end;
  step:=case reason when 'buyer_manual_control' then 'Preserve the buyer handoff or manual control.' when 'account_paused' then 'Preserve the customer Pause.' when 'contact_checks_required' then 'Obtain fresh buyer contact checks before contact.' when 'buyer_delivery_unresolved' then 'Reconcile the original outgoing receipt before another action.' else 'Review the exact buyer question and current package. Select a supported answer, requested viewing or buyer-details step.' end;
  if j.outgoing_id is null then update public.icash_text_ai_jobs set state='needs_review',updated_at=now() where id=j.id and state in ('pending','issued','drafted');end if;
  insert into public.icash_text_attention(account_id,thread_id,deal_id,screening_id,message_id,kind,party,quote,timezone,progress_reason,next_step)
  values(p_account,t.id,d.id,d.screening_id,m.id,'campaign_reply','buyer',left(m.body,1000),t.timezone,reason,step)
  on conflict(thread_id,kind) do update set message_id=excluded.message_id,quote=excluded.quote,progress_reason=excluded.progress_reason,next_step=excluded.next_step,state='open',updated_at=now() where icash_text_attention.account_id=p_account;
 end if;
 insert into public.icash_buyer_reply_progress(message_id,account_id,thread_id,state,reason,next_step,wait_trigger,outgoing_id) values(m.id,p_account,t.id,result_state,reason,step,wake,o.id)
 on conflict(message_id) do update set state=excluded.state,reason=excluded.reason,next_step=excluded.next_step,wait_trigger=excluded.wait_trigger,outgoing_id=excluded.outgoing_id,updated_at=now() where icash_buyer_reply_progress.account_id=p_account;
 return jsonb_build_object('state',result_state,'reason',reason,'nextStep',step,'waitTrigger',wake);
end $$;

-- Due drafted buyers must reach the existing resume/final-dispatch path too.
do $patch$declare definition text;old text;begin
 definition:=pg_get_functiondef('public.icash_issue_due_text_ai()'::regprocedure);
 old:='and th.party=''seller''';if position(old in definition)=0 then raise exception 'Draft issuer changed';end if;
 definition:=replace(definition,old,'and (th.party=''seller'' or (th.party=''buyer'' and exists(select 1 from public.icash_seller_progress_settings where buyer_reply_enabled and public.icash_sms_reply_time(q.message_id)>=extract(epoch from buyer_reply_enabled_at))))');
 old:='return public.icash_issue_due_text_ai_before_progress();';
 if position(old in definition)=0 then raise exception 'Due-work reconciliation boundary changed';end if;
 execute replace(definition,old,$r$if exists(select 1 from public.icash_seller_progress_settings where buyer_reply_enabled) then
  for p in select j.account_id,j.id from public.icash_buyer_reply_progress b join public.icash_text_ai_jobs j on j.account_id=b.account_id and j.message_id=b.message_id
   where b.state='waiting' and b.reason in ('provider_delivery_pending','prior_delivery_pending') and b.updated_at<now()-interval '1 minute' order by b.updated_at limit 10 loop
   perform public.icash_finish_seller_text_progress(p.account_id,p.id);
  end loop;
 end if;
 return public.icash_issue_due_text_ai_before_progress();$r$);
end $patch$;
do $$declare f record;begin
 for f in select p.oid::regprocedure signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in ('icash_buyer_factual_text','icash_buyer_reply_before_progress','icash_resume_seller_text_ai','icash_resume_text_before_buyer_progress','icash_finish_seller_text_progress','icash_finish_text_before_buyer_progress') loop
  execute format('revoke all on function %s from public,anon,authenticated',f.signature);execute format('grant execute on function %s to service_role',f.signature);
 end loop;
end $$;
commit;
