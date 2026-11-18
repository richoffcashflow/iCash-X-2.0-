-- Installed scheduler, conversation policy wrapper and voice context at the release boundary.
create role service_role;
create table icash_operating_budget(id int primary key);
create table icash_seller_progress_settings(id int primary key,enabled boolean,buyer_reply_enabled boolean,buyer_reply_enabled_at timestamptz,voice_receipt_wait_enabled_at timestamptz);
create table icash_seller_reply_progress(account_id uuid,message_id uuid,next_check_at timestamptz);
create table icash_buyer_reply_progress(account_id uuid,message_id uuid,state text,reason text,updated_at timestamptz);
create table icash_accounts(id uuid primary key,bot_paused boolean default false);
create table icash_deal_files(id uuid primary key,account_id uuid,screening_id uuid,stage text,terms jsonb);
create table icash_text_threads(id uuid primary key,account_id uuid,deal_id uuid,party text,paused boolean,manual_only boolean,ai_mode text,retired_at timestamptz,sender text,recipient text);
create table icash_text_ai_jobs(id uuid primary key,account_id uuid,thread_id uuid,message_id uuid,state text,analysis jsonb,reply text,outgoing_id uuid,next_attempt_at timestamptz,created_at timestamptz);
create table icash_text_messages(id uuid primary key,account_id uuid,thread_id uuid,request_key uuid,direction text,state text,provider_id text,last_delivery_at timestamptz,customer_author_id uuid,body text,created_at timestamptz,event_id text,route_revision int);
create table icash_text_events(id text primary key,type text,payload jsonb);
create table icash_text_suppressions(phone text primary key);
create table icash_operation_spend(operation_key text primary key,account_id uuid);
create table icash_automation_tickets(id uuid primary key default gen_random_uuid(),token uuid default gen_random_uuid(),account_id uuid,kind text,text_ai_job_id uuid,state text default 'issued',outcome text,expires_at timestamptz default now()+interval '1 minute',completed_at timestamptz,created_at timestamptz default now());
create table icash_call_recordings(id uuid primary key,account_id uuid,screening_id uuid,from_phone text,to_phone text,party text,call_sid text,provider_account_sid text,dial_claimed_at timestamptz,call_ended_at timestamptz);
create table icash_recorded_gate_terminal_receipts(recording_id uuid,account_id uuid,call_sid text,created_at timestamptz,receipt jsonb);
create table icash_sms_seller_openings(account_id uuid,thread_id uuid);
create table icash_sms_routes(account_id uuid,sender text,recipient text,revision int,needs_review boolean);
create function icash_issue_due_text_ai_before_progress() returns jsonb language sql as $$select '{}'::jsonb$$;
create function icash_seller_progress_gate(uuid,uuid) returns boolean language sql as $$select false$$;
create function icash_seller_response_operation_allowed(uuid,text) returns boolean language sql as $$select true$$;
create function icash_sms_message_route_current(uuid,uuid) returns boolean language sql as $$select true$$;
create function icash_seller_text_offer_context(uuid,uuid) returns jsonb language sql as $$select null::jsonb$$;
create function icash_seller_recorded_call_finished(uuid,uuid) returns boolean language sql as $$select exists(select 1 from public.icash_call_recordings r where r.account_id=$1 and r.id=$2 and r.call_ended_at is not null)$$;
CREATE OR REPLACE FUNCTION public.icash_sms_reply_time(p_message uuid)
 RETURNS numeric
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
 select case when jsonb_typeof(e.payload->'timestamp')='number' then
  case when (e.payload->>'timestamp')::numeric between 0 and extract(epoch from m.created_at)+300 then (e.payload->>'timestamp')::numeric else extract(epoch from m.created_at) end
  else extract(epoch from m.created_at) end
 from public.icash_text_messages m left join public.icash_text_events e on e.id=m.event_id where m.id=p_message;
$function$
;
CREATE OR REPLACE FUNCTION public.icash_seller_voice_text_context(p_account uuid, p_message uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare m public.icash_text_messages;t public.icash_text_threads;d public.icash_deal_files;r public.icash_call_recordings;source_at timestamptz;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found or (m.event_id is null and m.provider_id is null) then return false;end if;
 source_at:=to_timestamp(public.icash_sms_reply_time(m.id)::double precision);
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller' and not paused and not manual_only and ai_mode='auto' and retired_at is null;
 if not found then return false;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';
 if not found then return false;end if;
 -- No ambiguous or later call may donate its property context to this reply.
 select * into r from public.icash_call_recordings
 where from_phone=t.sender and to_phone=t.recipient and dial_claimed_at<=source_at and dial_claimed_at>source_at-interval '2 hours' and call_sid is not null
 order by dial_claimed_at desc,id desc limit 1;
 if r.id is null or r.account_id is distinct from p_account or r.screening_id is distinct from d.screening_id or r.party<>'seller' or not public.icash_seller_recorded_call_finished(p_account,r.id)
  or exists(select 1 from public.icash_call_recordings other where other.from_phone=t.sender and other.to_phone=t.recipient
   and other.id<>r.id and other.dial_claimed_at=r.dial_claimed_at and other.call_sid is not null)
  or exists(select 1 from public.icash_text_messages sent where sent.account_id=p_account and sent.thread_id=t.id and sent.direction='outgoing'
   and not exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=t.id and j.message_id=m.id and j.outgoing_id=sent.id and j.analysis->>'dialoguePolicy'='seller-dialogue-v1'))
  or exists(select 1 from public.icash_sms_seller_openings opening where opening.account_id=p_account and opening.thread_id=t.id)
  or not exists(select 1 from public.icash_sms_routes route where route.account_id=p_account and route.sender=t.sender and route.recipient=t.recipient and not route.needs_review and route.revision=m.route_revision) then return false;end if;
 if exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.message_id=m.id and j.analysis ? 'voiceReceiptWait'
  and j.analysis->'voiceReceiptWait'<>'null'::jsonb
  and (source_at<now()-interval '15 minutes' or not exists(select 1 from public.icash_seller_progress_settings settings where settings.id=1 and settings.voice_receipt_wait_enabled_at is not null
   and j.analysis->'voiceReceiptWait'=jsonb_build_object('recordingId',r.id,'enabledAt',settings.voice_receipt_wait_enabled_at)))) then return false;end if;
 return true;
end $function$
;
create function icash_seller_message_before_offer(uuid,uuid) returns boolean language sql as $$
 select exists(select 1 from public.icash_text_ai_jobs q join public.icash_text_messages o on o.id=q.outgoing_id
  where q.account_id=$1 and q.outgoing_id=$2 and o.body='Which property?' and
  (not (q.analysis ? 'voiceReceiptWait') or public.icash_seller_voice_text_context($1,q.message_id)))$$;
CREATE OR REPLACE FUNCTION public.icash_seller_conversation_message_current(p_account uuid, p_message uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare j public.icash_text_ai_jobs;c jsonb;m public.icash_text_messages;
begin
 select * into j from public.icash_text_ai_jobs where account_id=p_account and outgoing_id=p_message and state='queued' and analysis->>'offerPolicy'='seller-text-offer-v1';
 if not found then return public.icash_seller_message_before_offer(p_account,p_message);end if;
 c:=public.icash_seller_text_offer_context(p_account,j.message_id);
 select * into m from public.icash_text_messages where account_id=p_account and thread_id=j.thread_id and id=p_message and direction='outgoing' and state='ready' and provider_id is null;
 return c is not null and m.id is not null and public.icash_sms_message_route_current(p_account,m.id)
  and c->>'fingerprint'=j.analysis->>'offerFingerprint' and c->'offerState'=j.analysis->'offerState' and m.body=j.reply;
end $function$
;
CREATE OR REPLACE FUNCTION public.icash_issue_due_text_ai()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
declare p record;j public.icash_text_ai_jobs;t public.icash_automation_tickets;r jsonb;
begin
 perform pg_advisory_xact_lock(726341927);
 perform 1 from public.icash_operating_budget where id=1 for update;
 if exists(select 1 from public.icash_seller_progress_settings where enabled) then
  for p in select account_id,message_id from public.icash_seller_reply_progress where next_check_at<=now() order by next_check_at,message_id limit 20 loop
   perform public.icash_refresh_seller_reply_progress(p.account_id,p.message_id);
  end loop;
  if not exists(select 1 from public.icash_automation_tickets where kind='text_ai' and created_at>now()-interval '10 seconds') then
   for j in select q.* from public.icash_text_ai_jobs q join public.icash_text_threads th on th.id=q.thread_id and th.account_id=q.account_id and (th.party='seller' or (th.party='buyer' and exists(select 1 from public.icash_seller_progress_settings where buyer_reply_enabled and public.icash_sms_reply_time(q.message_id)>=extract(epoch from buyer_reply_enabled_at))))
    where q.state='drafted' and q.next_attempt_at<=now() order by q.created_at limit 10 for update of q skip locked loop
    if public.icash_seller_progress_gate(j.account_id,j.id) then
     update public.icash_text_ai_jobs set next_attempt_at=now()+interval '15 minutes' where id=j.id;
     insert into public.icash_automation_tickets(account_id,kind,text_ai_job_id) values(j.account_id,'text_ai',j.id) returning * into t;
     return jsonb_build_object('token',t.token);
    end if;
   end loop;
  end if;
 end if;
 if exists(select 1 from public.icash_seller_progress_settings where buyer_reply_enabled) then
  for p in select buyer_job.account_id,buyer_job.id from public.icash_buyer_reply_progress b join public.icash_text_ai_jobs buyer_job on buyer_job.account_id=b.account_id and buyer_job.message_id=b.message_id
   where b.state='waiting' and b.reason in ('provider_delivery_pending','prior_delivery_pending') and b.updated_at<now()-interval '1 minute' order by b.updated_at limit 10 loop
   perform public.icash_finish_seller_text_progress(p.account_id,p.id);
  end loop;
 end if;
 return public.icash_issue_due_text_ai_before_progress();
end $function$
;
revoke all on function icash_issue_due_text_ai(),icash_seller_voice_text_context(uuid,uuid),icash_seller_conversation_message_current(uuid,uuid) from public;
grant execute on function icash_issue_due_text_ai(),icash_seller_voice_text_context(uuid,uuid),icash_seller_conversation_message_current(uuid,uuid) to service_role;
