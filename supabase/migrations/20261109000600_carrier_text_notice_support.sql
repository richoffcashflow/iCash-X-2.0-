-- Customer-support evidence: change the incoming-reply count only. Keep raw
-- outgoing delivery, attempted work and budget evidence exactly as before.
begin;
set local lock_timeout='5s';
do $patch$
declare definition text;needle text:=$old$'textReplies',(select count(*) from messages where direction='incoming' and state='received' and (provider_id is not null or event_id is not null))$old$;
begin
 definition:=pg_get_functiondef('public.icash_support_outreach_diagnostics(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,needle,'')))/length(needle)<>1 then raise exception 'Carrier support diagnostics prerequisite changed';end if;
 execute replace(definition,needle,$new$'textReplies',(select count(*) from messages m join public.icash_response_text_messages response on response.id=m.id and response.account_id=m.account_id and response.thread_id=m.thread_id where m.direction='incoming' and m.state='received' and (m.provider_id is not null or m.event_id is not null))$new$);
end $patch$;
commit;
