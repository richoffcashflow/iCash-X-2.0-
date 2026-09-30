-- A human handoff pauses automation, not a permitted reply written by the user.
create function public.icash_manual_handoff_reply(p_account uuid,p_thread uuid) returns boolean language sql stable set search_path='' as $$
 select exists(
 select 1 from public.icash_text_threads t
 cross join lateral(select id,body from public.icash_text_messages where account_id=p_account and thread_id=t.id and direction='incoming' and state='received' order by created_at desc,id desc limit 1) m
 where t.id=p_thread and t.account_id=p_account and t.paused
 and not exists(select 1 from public.icash_text_suppressions where phone=t.recipient)
 and (public.icash_text_signal(m.body,t.party) in ('human','callback') or exists(select 1 from public.icash_text_ai_jobs j where j.account_id=p_account and j.thread_id=t.id and j.message_id=m.id and j.state='handoff' and (j.analysis->>'humanRequested'='true' or j.analysis->>'callbackRequested'='true')))
 );
$$;
revoke all on function public.icash_manual_handoff_reply(uuid,uuid) from public,anon,authenticated;
grant execute on function public.icash_manual_handoff_reply(uuid,uuid) to service_role;
do $$ declare d text;needle text:='if not found or t.paused or t.sender<>p_sender';begin
 d:=pg_get_functiondef('public.icash_claim_text_before_ai(uuid,uuid,text)'::regprocedure);
 if position(needle in d)=0 then raise exception 'Unexpected text claim definition';end if;
 d:=replace(d,needle,'if not found or (t.paused and not (public.icash_manual_handoff_reply(p_account,t.id) and not exists(select 1 from public.icash_text_ai_jobs where outgoing_id=p_message and account_id=p_account))) or t.sender<>p_sender');
 execute d;
end $$;
