begin;
-- A seller's immediate SMS request is a distinct, idempotent call source. It
-- does not reopen a dispatched call or manufacture new contact permission.
alter table public.icash_voice_jobs
 add column sms_source_message_id uuid unique references public.icash_text_messages(id),
 add column sms_requested_at timestamptz,
 add column sms_requested_by uuid,
 add constraint icash_voice_sms_source check(sms_source_message_id is null or (permission_id is not null and operational_contact_id is null and callback_id is null and sms_requested_at is not null));
drop index public.icash_voice_first_once;
create unique index icash_voice_first_once on public.icash_voice_jobs(permission_id) where callback_id is null and sms_source_message_id is null;

create function public.icash_seller_call_now_intent(p_account uuid,p_thread uuid,p_body text,p_before timestamptz)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare b text;last_sent text;
begin
 b:=trim(regexp_replace(lower(coalesce(p_body,'')),'[[:space:]]+',' ','g'));
 b:=trim(both ' .!?' from b);
 -- Whole-message matching preserves refusals, future times and human requests.
 if b ~ '^(please )?((can|could|would) you |you can )?(call( me)?( back)?|give me a call)( (right )?now)?( please)?$' then return true;end if;
 if b !~ '^(yes[, ]+|sure[, ]+|okay[, ]+|ok[, ]+)?((right )?now( works( for me)?| is (good|fine))?|(i am|i''m|im) (free|available)( (right )?now)?|you can (call|call me) now)$' then return false;end if;
 select body into last_sent from public.icash_text_messages
 where account_id=p_account and thread_id=p_thread and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null
 and created_at<p_before and created_at>=p_before-interval '24 hours' order by created_at desc,id desc limit 1;
 return coalesce(last_sent ~* '(when|what (date|day|time)|good time|available).*(call|talk)|can (i|we) call',false);
end $$;

create function public.icash_seller_sms_call_current(p_account uuid,p_message uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found or m.created_at>now() then return false;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller';
 if not found or public.icash_seller_conversation_context(p_account,t.id) is null
 or not public.icash_seller_call_now_intent(p_account,t.id,m.body,m.created_at) then return false;end if;
 if not exists(select 1 from public.icash_sms_routes where account_id=p_account and sender=t.sender and recipient=t.recipient and not needs_review and revision=m.route_revision)
 or exists(select 1 from public.icash_text_messages newer where newer.account_id=p_account and newer.thread_id=t.id and newer.direction='incoming' and (newer.created_at,newer.id)>(m.created_at,m.id))
 or exists(select 1 from public.icash_contact_suppressions where contact_key=encode(sha256(convert_to(t.recipient,'UTF8')),'hex')) then return false;end if;
 return true;
end $$;

create function public.icash_queue_seller_sms_call(p_account uuid,p_message uuid,p_actor uuid default null)
returns uuid language plpgsql security invoker set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;p public.icash_contact_permissions;j public.icash_voice_jobs;screening uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 perform 1 from public.icash_accounts where id=p_account and not bot_paused for update;if not found then return null;end if;
 if p_actor is not null and not exists(select 1 from public.icash_accounts where id=p_account and owner_user_id=p_actor) then return null;end if;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account;
 if not found or not public.icash_seller_sms_call_current(p_account,p_message) then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account;
 perform pg_advisory_xact_lock(hashtextextended(t.recipient,74));
 select * into j from public.icash_voice_jobs where account_id=p_account and sms_source_message_id=m.id;
 if found then return j.id;end if;
 -- Only an explicit, audited owner restart can renew an older received request.
 if m.created_at<now()-(case when p_actor is null then interval '5 minutes' else interval '24 hours' end) then return null;end if;
 select screening_id into screening from public.icash_deal_files where id=t.deal_id and account_id=p_account;
 select cp.* into p from public.icash_contact_permissions cp where cp.account_id=p_account and cp.screening_id=screening and cp.phone=t.recipient and cp.party='seller'
 and cp.seller_intake_id=t.seller_intake_id and public.icash_seller_voice_permission_current(p_account,cp.id) order by cp.id limit 1;
 if not found then return null;end if;
 -- Never stack a new call onto an active or provider-uncertain attempt.
 if exists(select 1 from public.icash_voice_jobs prior join public.icash_contact_permissions cp on cp.id=prior.permission_id where cp.phone=p.phone and (prior.state='dispatching' or (prior.state='held' and prior.outcome in ('provider_receipt_needs_reconciliation','provider_outcome_unknown_no_retry'))))
 or exists(select 1 from public.icash_live_conversations where contact_key=p.contact_key and state in ('waiting','review'))
 or exists(select 1 from public.icash_call_recordings where contact_key=p.contact_key and call_sid is not null and call_ended_at is null and created_at>now()-interval '10 minutes') then return null;end if;
 -- Reuse an untouched first-call job so the reply and intake cannot both dial.
 select * into j from public.icash_voice_jobs where account_id=p_account and permission_id=p.id and callback_id is null and sms_source_message_id is null and state in ('ready','issued') and operation_key is null order by created_at limit 1 for update;
 if found then
  update public.icash_voice_jobs set sms_source_message_id=m.id,sms_requested_at=now(),sms_requested_by=p_actor,due_at=now(),updated_at=now() where id=j.id;
 else
  -- Supersede only unstarted, earlier immediate requests; never retry a provider claim.
  update public.icash_voice_jobs set state='canceled',outcome='Superseded by newer seller call request',updated_at=now()
   where account_id=p_account and permission_id=p.id and sms_source_message_id is not null and state in ('ready','issued') and operation_key is null;
  insert into public.icash_voice_jobs(account_id,permission_id,sms_source_message_id,sms_requested_at,sms_requested_by)
  values(p_account,p.id,m.id,now(),p_actor) returning * into j;
 end if;
 update public.icash_sms_call_requests set state='resolved',updated_at=now() where account_id=p_account and thread_id=t.id and requested_at<=m.created_at and state='needs_review';
 update public.icash_text_attention set state='acknowledged',updated_at=now() where account_id=p_account and thread_id=t.id and kind='callback' and state='open';
 update public.icash_text_ai_jobs set state='superseded',updated_at=now() where account_id=p_account and thread_id=t.id and state in ('pending','issued','drafted');
 update public.icash_text_messages set state='cancelled',updated_at=now() where account_id=p_account and thread_id=t.id and direction='outgoing' and state='ready';
 return j.id;
end $$;

-- Run after the existing signal/cancellation triggers, before paid AI analysis.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_enqueue_text_ai()'::regprocedure);
 needle:=$n$ if new.direction<>'incoming' or new.account_id is null or new.thread_id is null then return new;end if;$n$;
 if position(needle in d)=0 then raise exception 'SMS enqueue prerequisite changed';end if;
 execute replace(d,needle,needle||$n$
 if new.state='received' and public.icash_seller_sms_call_current(new.account_id,new.id) then
  perform public.icash_queue_seller_sms_call(new.account_id,new.id);
  return new;
 end if;$n$);
end $$;

alter function public.icash_prepare_seller_text_event(text) rename to icash_prepare_seller_text_event_before_call_now;
create function public.icash_prepare_seller_text_event(p_event text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare m public.icash_text_messages;job uuid;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into m from public.icash_text_messages where event_id=p_event and direction='incoming' and state='received';
 if found and public.icash_seller_sms_call_current(m.account_id,m.id) then
  job:=public.icash_queue_seller_sms_call(m.account_id,m.id);
  update public.icash_voice_jobs set state='issued',updated_at=now() where id=job and account_id=m.account_id and state='ready' and due_at<=now();
  return case when job is not null then jsonb_build_object('accountId',m.account_id,'voiceJobId',job) else null end;
 end if;
 return public.icash_prepare_seller_text_event_before_call_now(p_event);
end $$;

alter function public.icash_seller_callback_voice_pending(uuid) rename to icash_seller_callback_voice_pending_before_now;
create function public.icash_seller_callback_voice_pending(p_job uuid)
returns boolean language plpgsql security invoker set search_path='' as $$
declare j public.icash_voice_jobs;
begin
 select * into j from public.icash_voice_jobs where id=p_job;
 if j.sms_source_message_id is null then return public.icash_seller_callback_voice_pending_before_now(p_job);end if;
 return j.sms_requested_at<now()-interval '5 minutes' or j.sms_requested_at>now()
 or not public.icash_seller_sms_call_current(j.account_id,j.sms_source_message_id);
end $$;

-- A confirmed provider call may produce one short acknowledgement. No AI tokens
-- are needed and the ordinary SMS consent/route/spending chain still owns sending.
create function public.icash_seller_sms_call_ack(p_account uuid,p_job uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.icash_voice_jobs;m public.icash_text_messages;ai uuid;
begin
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account;
 if j.sms_source_message_id is null or not public.icash_seller_sms_call_current(p_account,j.sms_source_message_id)
 or not exists(select 1 from public.icash_call_recordings where account_id=p_account and voice_job_id=j.id and call_sid is not null and call_ended_at is null) then return null;end if;
 select * into m from public.icash_text_messages where id=j.sms_source_message_id;
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id,state,analysis,reply)
 values(p_account,m.thread_id,m.id,'drafted',jsonb_build_object('action','call_now','facts','[]'::jsonb),'Calling you now.')
 on conflict(message_id) do nothing;
 select id into ai from public.icash_text_ai_jobs where account_id=p_account and message_id=m.id and state='drafted' and analysis->>'action'='call_now';
 return public.icash_queue_seller_conversation_reply(p_account,ai);
end $$;

-- Preserve all source/route/prose checks; immediate calls are the sole new action.
do $$declare d text;needle text;begin
 d:=pg_get_functiondef('public.icash_seller_conversation_reply(uuid,uuid)'::regprocedure);
 needle:=$n$ if a='reply_identity' then$n$;
 if position(needle in d)=0 then raise exception 'Seller reply prerequisite changed';end if;
 d:=replace(d,needle,$n$ if a='call_now' then
  if not public.icash_seller_sms_call_current(p_account,m.id) or not exists(
   select 1 from public.icash_voice_jobs v join public.icash_call_recordings r on r.voice_job_id=v.id and r.account_id=v.account_id
   where v.account_id=p_account and v.sms_source_message_id=m.id and r.call_sid is not null and r.call_ended_at is null) then return null;end if;
  return 'Calling you now.';
 elsif a='reply_identity' then$n$);
 -- Ask only for the missing detail; never demand a year for ordinary availability.
 d:=replace(d,$n$else reply:='What exact date including year, time with AM or PM, and time zone would work for a call?';end if;$n$,$n$else
   if b ~ '\m(tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\M' and b !~ '\m[0-9]{1,2}(:[0-9]{2})? ?(am|pm)\M' then reply:='What time works for you?';
   elsif b ~ '\m[0-9]{1,2}(:[0-9]{2})? ?(am|pm)\M' and b !~ '\m(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|[0-9]{4}-[0-9]{2}-[0-9]{2})\M' then reply:='Does that time work today or tomorrow?';
   elsif b ~ '\m[0-9]{1,2}(:[0-9]{2})? ?(am|pm)\M' then reply:='What time zone are you in?';
   else reply:='Are you free for a quick call now, or would later work better?';end if;
  end if;$n$);
 execute d;
end $$;

revoke all on function public.icash_seller_call_now_intent(uuid,uuid,text,timestamptz),public.icash_seller_sms_call_current(uuid,uuid),public.icash_queue_seller_sms_call(uuid,uuid,uuid),public.icash_seller_sms_call_ack(uuid,uuid),public.icash_prepare_seller_text_event(text),public.icash_prepare_seller_text_event_before_call_now(text),public.icash_seller_callback_voice_pending(uuid),public.icash_seller_callback_voice_pending_before_now(uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_call_now_intent(uuid,uuid,text,timestamptz),public.icash_seller_sms_call_current(uuid,uuid),public.icash_queue_seller_sms_call(uuid,uuid,uuid),public.icash_seller_sms_call_ack(uuid,uuid),public.icash_prepare_seller_text_event(text),public.icash_prepare_seller_text_event_before_call_now(text),public.icash_seller_callback_voice_pending(uuid),public.icash_seller_callback_voice_pending_before_now(uuid) to service_role;
commit;
