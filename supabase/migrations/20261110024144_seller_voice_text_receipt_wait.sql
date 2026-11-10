-- A fresh text preference can arrive before its bound call's terminal receipt.
-- Install disabled. Activate prospectively only after exact-release verification.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
alter table public.icash_seller_progress_settings add column voice_receipt_wait_enabled_at timestamptz;
create function public.icash_seller_voice_text_wait_call(p_account uuid,p_message uuid)
returns uuid language plpgsql stable security invoker set search_path='' as $$
declare m public.icash_text_messages;t public.icash_text_threads;d public.icash_deal_files;r public.icash_call_recordings;source_at timestamptz;cutover timestamptz;
begin
 select voice_receipt_wait_enabled_at into cutover from public.icash_seller_progress_settings where id=1 and enabled and dialogue_enabled and voice_text_enabled_at is not null;
 if cutover is null then return null;end if;
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found or (m.event_id is null and m.provider_id is null) or m.created_at<cutover then return null;end if;
 source_at:=to_timestamp(public.icash_sms_reply_time(m.id)::double precision);
 if source_at<cutover or source_at<now()-interval '15 minutes' or source_at>now()
  or not exists(select 1 from public.icash_seller_progress_settings settings where settings.id=1 and settings.voice_text_enabled_at<=m.created_at and settings.voice_text_enabled_at<=source_at) then return null;end if;
 select * into t from public.icash_text_threads where id=m.thread_id and account_id=p_account and party='seller' and not paused and not manual_only and ai_mode='auto' and retired_at is null;
 if not found then return null;end if;
 select * into d from public.icash_deal_files where id=t.deal_id and account_id=p_account and stage='draft' and coalesce(terms->>'practice','false')<>'true';
 if not found then return null;end if;
 select * into r from public.icash_call_recordings
 where from_phone=t.sender and to_phone=t.recipient and dial_claimed_at<=source_at and dial_claimed_at>source_at-interval '2 hours' and call_sid is not null
 order by dial_claimed_at desc,id desc limit 1;
 if r.id is null or r.account_id is distinct from p_account or r.screening_id is distinct from d.screening_id or r.party<>'seller' or public.icash_seller_recorded_call_finished(p_account,r.id)
  or exists(select 1 from public.icash_call_recordings other where other.from_phone=t.sender and other.to_phone=t.recipient and other.id<>r.id and other.dial_claimed_at=r.dial_claimed_at and other.call_sid is not null)
  or exists(select 1 from public.icash_text_messages sent where sent.account_id=p_account and sent.thread_id=t.id and sent.direction='outgoing')
  or exists(select 1 from public.icash_sms_seller_openings opening where opening.account_id=p_account and opening.thread_id=t.id)
  or not exists(select 1 from public.icash_sms_routes route where route.account_id=p_account and route.sender=t.sender and route.recipient=t.recipient and not route.needs_review and route.revision=m.route_revision)
  or exists(select 1 from public.icash_text_ai_jobs j where j.message_id=m.id and
    (j.account_id is distinct from p_account or j.thread_id is distinct from t.id or j.state not in ('pending','issued') or j.outgoing_id is not null or j.provider_id is not null or j.usage is not null
     or j.analysis->'voiceReceiptWait' is distinct from jsonb_build_object('recordingId',r.id,'enabledAt',cutover))) then return null;end if;
 return r.id;
end $$;
revoke all on function public.icash_seller_voice_text_wait_call(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_voice_text_wait_call(uuid,uuid) to service_role;

do $patch$
declare d text;old text;replacement text;
begin
 -- Keep the original account/property/number-pair predicate and final admission.
 -- A saved wait cannot adopt another call or survive a disabled/replaced cutover.
 d:=pg_get_functiondef('public.icash_seller_voice_text_context(uuid,uuid)'::regprocedure);
 old:=' return true;';
 replacement:=$r$ if exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.message_id=m.id and j.analysis ? 'voiceReceiptWait'
  and j.analysis->'voiceReceiptWait'<>'null'::jsonb
  and (source_at<now()-interval '15 minutes' or not exists(select 1 from public.icash_seller_progress_settings settings where settings.id=1 and settings.voice_receipt_wait_enabled_at is not null
   and j.analysis->'voiceReceiptWait'=jsonb_build_object('recordingId',r.id,'enabledAt',settings.voice_receipt_wait_enabled_at)))) then return false;end if;
 return true;$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Voice context return changed';end if;
 execute replace(d,old,replacement);

 d:=pg_get_functiondef('public.icash_seller_dialogue_context(uuid,uuid)'::regprocedure);
 old:=$old$ elsif b ~ '^(please |can you |could you )?text me( instead| please)?[.! ]*$'$old$;
 replacement:=$r$ elsif b ~ '^(please |can you |could you )?text me( instead| please)?[.! ]*$'
   and public.icash_seller_voice_text_wait_call(p_account,m.id) is not null then
  reason:='voice_call_receipt_pending';
 elsif exists(select 1 from public.icash_text_ai_jobs wait_job where wait_job.account_id=p_account and wait_job.message_id=m.id
  and wait_job.analysis->'voiceReceiptWait' is not null and wait_job.analysis->'voiceReceiptWait'<>'null'::jsonb)
  and (not public.icash_seller_voice_text_context(p_account,m.id)
   or not exists(select 1 from public.icash_seller_progress_settings settings where settings.id=1 and settings.voice_text_enabled_at<=m.created_at and extract(epoch from settings.voice_text_enabled_at)<=source_at)) then
  reason:='voice_call_receipt_unresolved';
$r$||old;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Voice dialogue branch changed';end if;
 execute replace(d,old,replacement);

 d:=pg_get_functiondef('public.icash_refresh_seller_reply_progress(uuid,uuid,text)'::regprocedure);
 old:=$old$if why='clarification_receipt_pending' then$old$;
 replacement:=$r$if why='voice_call_receipt_unresolved' then step:='Review the original call receipt and current conversation before continuing. Do not replay an old request.';end if;
  if why='voice_call_receipt_pending' then status:='waiting';step:='Wait for this conversation call to finish before preparing the requested text.';wake:='original call receipt or 15-minute source review';due:=now()+interval '1 minute';end if;
  $r$||old;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Progress receipt wait changed';end if;
 execute replace(d,old,replacement);

 d:=pg_get_functiondef('public.icash_prepare_seller_dialogue(uuid,uuid)'::regprocedure);
 old:=$old$ if r->>'state'='waiting' and r->>'reason'='clarification_receipt_pending' then$old$;
 replacement:=$r$ if r->>'state'='waiting' and r->>'reason'='voice_call_receipt_pending' then
  insert into public.icash_text_ai_jobs(account_id,thread_id,message_id,next_attempt_at,analysis)
  select p_account,m.thread_id,m.id,now()+interval '1 minute',
   jsonb_build_object('voiceReceiptWait',jsonb_build_object('recordingId',public.icash_seller_voice_text_wait_call(p_account,m.id),'enabledAt',settings.voice_receipt_wait_enabled_at))
  from public.icash_seller_progress_settings settings where settings.id=1
  on conflict(message_id) do nothing;
  return null;
 end if;
$r$||old;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Dialogue preparation wait changed';end if;
 d:=replace(d,old,replacement);
 old:=$old$'dialogueQuestion',c->>'question'))$old$;
 replacement:=$r$'dialogueQuestion',c->>'question','voiceReceiptWait',j.analysis->'voiceReceiptWait'))$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Dialogue source analysis changed';end if;
 execute replace(d,old,replacement);

 d:=pg_get_functiondef('public.icash_seller_progress_gate(uuid,uuid)'::regprocedure);
 old:=$old$r->>'reason'='clarification_receipt_pending'$old$;
 replacement:=$r$r->>'reason' in ('clarification_receipt_pending','voice_call_receipt_pending')$r$;
 if (length(d)-length(replace(d,old,'')))/length(old)<>1 then raise exception 'Progress gate wait changed';end if;
 execute replace(d,old,replacement);
end $patch$;
commit;
