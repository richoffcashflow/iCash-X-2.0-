CREATE OR REPLACE FUNCTION public.icash_enqueue_text_ai()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
 if exists(select 1 from public.icash_text_threads where id=new.thread_id and (manual_only or ai_mode='off')) then return new;end if;
 if new.direction<>'incoming' or new.account_id is null or new.thread_id is null then return new;end if;
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
