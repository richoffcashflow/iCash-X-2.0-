-- Resume an original seller reply when preparation succeeded but its first dispatch was held.
-- An already dispatched message is owned by receipt recovery. No provider, wallet or draft writes.
set local lock_timeout='2s';
set local statement_timeout='20s';

create index if not exists icash_text_ai_queued_dispatch_due
 on public.icash_text_ai_jobs(next_attempt_at,created_at,id) where state='queued' and outgoing_id is not null;
create index if not exists icash_text_ai_ticket_history
 on public.icash_automation_tickets(text_ai_job_id,created_at desc,id desc) where kind='text_ai' and text_ai_job_id is not null;

do $patch$
declare
 scheduler regprocedure:='public.icash_issue_due_text_ai()'::regprocedure;
 voice_context regprocedure:='public.icash_seller_voice_text_context(uuid,uuid)'::regprocedure;
 source text;patched text;anchor text;
begin
 if not exists(select 1 from pg_proc where oid=scheduler and md5(pg_get_functiondef(oid))='4882c22f0255272d12804a47f4620100' and provolatile='v'
  and not prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=""'] and proacl::text='{postgres=X/postgres,service_role=X/postgres}')
 or not exists(select 1 from pg_proc where oid=voice_context and md5(pg_get_functiondef(oid))='bc70a31e17a73e648ee2172ddfb9af09' and provolatile='s'
  and not prosecdef and proowner='postgres'::regrole and proconfig=array['search_path=""'] and proacl::text='{postgres=X/postgres,service_role=X/postgres}')
 or md5(pg_get_functiondef('public.icash_seller_conversation_message_current(uuid,uuid)'::regprocedure))<>'c7e842be600ec3fb0330174feb8a40fa' then
  raise exception 'Seller reply predecessor or authority changed';
 end if;

 -- The 15-minute deadline still governs receipt discovery and first preparation.
 -- A delayed dispatch may reuse only the exact reply already prepared in time, with the same completed call.
 source:=pg_get_functiondef(voice_context);
 anchor:=$old$(source_at<now()-interval '15 minutes' or not exists(select 1 from public.icash_seller_progress_settings settings$old$;
 patched:=replace(source,anchor,$new$((source_at<now()-interval '15 minutes' and not (
   source_at>=now()-interval '24 hours' and j.state='queued' and j.thread_id=t.id and (j.analysis->>'dialoguePolicy') is not distinct from 'seller-dialogue-v1'
   and exists(select 1 from public.icash_text_messages original where original.id=j.outgoing_id and original.account_id=p_account
    and original.thread_id=t.id and original.request_key=j.id and original.direction='outgoing' and original.state='ready'
    and original.provider_id is null and original.last_delivery_at is null and original.customer_author_id is null
    and original.created_at between source_at and source_at+interval '15 minutes'
    and ((r.call_ended_at between r.dial_claimed_at and original.created_at) or exists(
     select 1 from public.icash_recorded_gate_terminal_receipts saved where saved.recording_id=r.id and saved.account_id=r.account_id and saved.call_sid=r.call_sid
      and saved.created_at between r.dial_claimed_at and original.created_at and saved.receipt->>'sid'=r.call_sid
      and saved.receipt->>'account_sid'=r.provider_account_sid and saved.receipt->>'from'=r.from_phone and saved.receipt->>'to'=r.to_phone
      and saved.receipt->>'direction'='outbound-api' and saved.receipt->>'status' in ('completed','busy','no-answer','failed','canceled')))
    and not exists(select 1 from public.icash_operation_spend spend where spend.operation_key='text:'||original.id and spend.account_id=p_account))))
   or not exists(select 1 from public.icash_seller_progress_settings settings$new$);
 if patched=source then raise exception 'Voice reply deadline changed';end if;
 execute patched;
 if pg_get_functiondef(voice_context)<>patched then raise exception 'Voice reply readback changed';end if;

 source:=pg_get_functiondef(scheduler);
 anchor:=$old$   for j in select q.* from public.icash_text_ai_jobs q join public.icash_text_threads th$old$;
 patched:=replace(source,anchor,$new$   select q.* into j from public.icash_text_ai_jobs q
    join public.icash_accounts a on a.id=q.account_id and not a.bot_paused
    join public.icash_text_threads th on th.id=q.thread_id and th.account_id=q.account_id and th.party='seller'
     and not th.paused and not th.manual_only and th.ai_mode='auto' and th.retired_at is null
    join public.icash_text_messages m on m.id=q.message_id and m.account_id=q.account_id and m.thread_id=q.thread_id
     and m.direction='incoming' and m.state='received'
    join public.icash_text_events e on e.id=m.event_id and e.type='text.incoming.sms' and e.payload->>'type'=e.type
     and e.payload->>'id'=e.id and e.payload#>>'{data,from}'=th.recipient and e.payload#>>'{data,to}'=th.sender
     and e.payload#>>'{data,body}'=m.body and coalesce(e.payload->>'optOut','false')='false'
    join public.icash_text_messages o on o.id=q.outgoing_id and o.account_id=q.account_id and o.thread_id=q.thread_id and o.request_key=q.id
     and o.direction='outgoing' and o.state='ready' and o.provider_id is null and o.last_delivery_at is null and o.customer_author_id is null
    join lateral (select prev.state,prev.outcome,prev.expires_at,prev.completed_at from public.icash_automation_tickets prev
     where prev.kind='text_ai' and prev.text_ai_job_id=q.id and prev.account_id=q.account_id
     order by prev.created_at desc,prev.id desc limit 1) previous on true
    where q.state='queued' and q.next_attempt_at<=now() and (
      q.analysis->>'dialoguePolicy'='seller-dialogue-v1' or q.analysis->>'offerPolicy'='seller-text-offer-v1')
     and ((previous.state='held' and previous.outcome='message_held' and previous.completed_at<=now()-interval '1 minute')
      or (previous.state in ('consumed','issued') and previous.expires_at<=now()))
     and public.icash_sms_reply_time(m.id) between extract(epoch from now()-interval '24 hours') and extract(epoch from now())
     and not exists(select 1 from public.icash_operation_spend spend where spend.operation_key='text:'||o.id)
     and not exists(select 1 from public.icash_text_suppressions s where s.phone=th.recipient)
     and not exists(select 1 from public.icash_text_messages newer where newer.account_id=q.account_id and newer.thread_id=q.thread_id
      and ((newer.direction='incoming' and newer.state='received' and (public.icash_sms_reply_time(newer.id),newer.id)>(public.icash_sms_reply_time(m.id),m.id))
       or (newer.direction='outgoing' and newer.id<>o.id and newer.created_at>=to_timestamp(public.icash_sms_reply_time(m.id)::double precision))))
     and public.icash_seller_response_operation_allowed(q.account_id,'text:'||o.id)
     and public.icash_seller_conversation_message_current(q.account_id,o.id)
    order by q.next_attempt_at,q.created_at,q.id limit 1 for update of q skip locked;
   if found then
    -- Back off repeated pre-dispatch holds. The global ten-second lane limit still applies.
    update public.icash_text_ai_jobs set next_attempt_at=now()+case
     when (select count(*) from (select 1 from public.icash_automation_tickets prev where prev.kind='text_ai'
      and prev.text_ai_job_id=j.id and prev.account_id=j.account_id limit 3) tries)>=3 then interval '2 hours'
     else interval '10 minutes' end where id=j.id;
    insert into public.icash_automation_tickets(account_id,kind,text_ai_job_id) values(j.account_id,'text_ai',j.id) returning * into t;
    return jsonb_build_object('token',t.token);
   end if;
$new$||anchor);
 if patched=source then raise exception 'Seller dispatch scheduler changed';end if;
 execute patched;
 if pg_get_functiondef(scheduler)<>patched then raise exception 'Seller dispatch scheduler readback changed';end if;
end $patch$;
