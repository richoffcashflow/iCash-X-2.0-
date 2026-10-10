begin;
-- Recognize the seller's actual wording and the callback question we send.
-- Whole-message matching still excludes future times, refusals and conditions.
create or replace function public.icash_seller_call_now_intent(p_account uuid,p_thread uuid,p_body text,p_before timestamptz)
returns boolean language plpgsql stable security invoker set search_path='' as $$
declare b text;last_sent text;
begin
 b:=trim(both ' .!?' from trim(regexp_replace(lower(coalesce(p_body,'')),'[[:space:]]+',' ','g')));
 if b ~ '^(please )?((can|could|would) you |you can )?(call( me)?( back)?|give me a call)( (right )?now)?( please)?$' then return true;end if;
 if b !~ '^(yes[, ]+|sure[, ]+|okay[, ]+|ok[, ]+)?((right )?now( works( for me)?| is (good|fine))?|((i am|i''m|im) )?(free|available)( (right )?now)?|(i can |can |you can )(call|call me)( (right )?now))$' then return false;end if;
 select body into last_sent from public.icash_text_messages
 where account_id=p_account and thread_id=p_thread and direction='outgoing' and state in ('accepted','delivered') and provider_id is not null
 and created_at<p_before and created_at>=p_before-interval '24 hours' order by created_at desc,id desc limit 1;
 return coalesce(last_sent ~* '(when|what (date|day|time)|good time|available).*(call|talk)|can (i|we) call'
  or last_sent='Are you free for a quick call now, or would later work better?',false);
end $$;

create function public.icash_seller_sms_call_failure_reply(p_account uuid,p_message uuid)
returns text language plpgsql stable security invoker set search_path='' as $$
declare m public.icash_text_messages;j public.icash_voice_jobs;k text;question text;
begin
 select * into m from public.icash_text_messages where id=p_message and account_id=p_account and direction='incoming' and state='received';
 if not found or not public.icash_seller_sms_call_current(p_account,m.id) then return null;end if;
 select * into j from public.icash_voice_jobs where account_id=p_account and sms_source_message_id=m.id and state='held' and operation_key is null
  and outcome in ('production_agent_review_required','voice_configuration_required','recorded_call_review_required','recorded_call_release_required','business_number_verification_required','business_number_mismatch','voice_selection_setup_required','property_context_required','voice_context_too_large');
 if not found or exists(select 1 from public.icash_call_recordings r where r.account_id=p_account and r.voice_job_id=j.id) then return null;end if;
 -- Use the saved conversation to ask only a fact that has not been answered or asked.
 foreach k in array array['condition','price','timing','owners','occupancy'] loop
  if not exists(select 1 from public.icash_text_ai_jobs a where a.account_id=p_account and a.thread_id=m.thread_id and a.created_at<=m.created_at
   and ((a.analysis->>'action'='ask_'||k and a.outgoing_id is not null)
    or exists(select 1 from jsonb_array_elements(case when jsonb_typeof(a.analysis->'facts')='array' then a.analysis->'facts' else '[]'::jsonb end) f
     where f->>'kind'=k and exists(select 1 from public.icash_text_messages src where src.account_id=p_account and src.thread_id=m.thread_id and src.direction='incoming' and src.state='received' and src.body=f->>'quote')))) then
   question:=case k when 'condition' then 'What repairs or updates does the property need?' when 'price' then 'What price did you have in mind?' when 'timing' then 'When would you ideally like to sell?' when 'owners' then 'Are all property owners on board with selling?' when 'occupancy' then 'Is the property vacant, owner occupied, or rented?' end;
   exit;
  end if;
 end loop;
 return 'I could not start the call. We can keep going by text. '||coalesce(question,'What would you like to know?');
end $$;

do $$declare d text;target regprocedure;needle text:=$n$ if a='call_now' then$n$;begin
 -- The signed-property viewing wrapper delegates acquisition replies here.
 -- Patch that delegate and preserve the newer viewing workflow unchanged.
 target:=coalesce(to_regprocedure('public.icash_seller_reply_before_viewings(uuid,uuid)'),to_regprocedure('public.icash_seller_conversation_reply(uuid,uuid)'));
 d:=pg_get_functiondef(target);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Seller call reply prerequisite changed';end if;
 execute replace(d,needle,$n$ if a='call_unavailable' then
  return public.icash_seller_sms_call_failure_reply(p_account,m.id);
 elsif a='call_now' then$n$);
end $$;

create function public.icash_seller_sms_call_unavailable(p_account uuid,p_job uuid)
returns uuid language plpgsql security invoker set search_path='' as $$
declare j public.icash_voice_jobs;m public.icash_text_messages;ai uuid;reply text;
begin
 perform 1 from public.icash_operating_budget where id=1 for update;
 select * into j from public.icash_voice_jobs where id=p_job and account_id=p_account;
 if not found or j.sms_source_message_id is null then return null;end if;
 reply:=public.icash_seller_sms_call_failure_reply(p_account,j.sms_source_message_id);if reply is null then return null;end if;
 select * into m from public.icash_text_messages where id=j.sms_source_message_id and account_id=p_account;
 insert into public.icash_text_ai_jobs(account_id,thread_id,message_id,state,analysis,reply)
 values(p_account,m.thread_id,m.id,'drafted',jsonb_build_object('action','call_unavailable','facts','[]'::jsonb),reply) on conflict(message_id) do nothing;
 select id into ai from public.icash_text_ai_jobs where account_id=p_account and message_id=m.id and state='drafted' and analysis->>'action'='call_unavailable';
 if ai is null then return null;end if;
 return public.icash_queue_seller_conversation_reply(p_account,ai);
end $$;

revoke all on function public.icash_seller_sms_call_failure_reply(uuid,uuid),public.icash_seller_sms_call_unavailable(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_seller_sms_call_failure_reply(uuid,uuid),public.icash_seller_sms_call_unavailable(uuid,uuid) to service_role;
commit;
