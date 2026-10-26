-- Let eligible calls and new texts both advance under sustained text volume.
-- Keep the original voice issuer and every final provider/contact/wallet gate.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
do $patch$
declare d text;needle text;item record;
begin
 for item in select * from (values
  ('icash_next_before_fulfillment()','fd4701ae1d6015c756bcd6a26f9dcc97'),
  ('icash_next_before_owner_question()','8fee41b7f7ab62c0f7f41a30a24eb77c')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then
   raise exception 'Outreach fairness prerequisite changed: %',item.signature;
  end if;
 end loop;
 d:=pg_get_functiondef('public.icash_next_before_fulfillment()'::regprocedure);
 needle:='return public.icash_next_before_voice_dispatch();';
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Voice issuer fallback changed';end if;
 d:=replace(d,'FUNCTION public.icash_next_before_fulfillment()','FUNCTION public.icash_issue_ready_voice_ticket()');
 execute replace(d,needle,'return null;');
end $patch$;
revoke all on function public.icash_issue_ready_voice_ticket() from public,anon,authenticated;
grant execute on function public.icash_issue_ready_voice_ticket() to service_role;

create or replace function public.icash_next_before_fulfillment() returns jsonb
language plpgsql set search_path='' as $function$
declare ticket jsonb;
begin
 ticket:=public.icash_issue_ready_voice_ticket();
 if ticket->>'token' is not null then return ticket;end if;
 return public.icash_next_before_voice_dispatch();
end $function$;

create function public.icash_next_outreach_channel() returns jsonb
language plpgsql set search_path='' as $function$
declare last_voice timestamptz;last_text timestamptz;ticket jsonb;
begin
 perform pg_advisory_xact_lock(726341927);
 select last_dispatch_at into last_voice from public.icash_voice_scheduler where id=1;
 -- Existing (kind,created_at DESC) index keeps this read bounded.
 select created_at into last_text from public.icash_automation_tickets
 where kind='seller_opener' order by created_at desc limit 1;
 -- Give a waiting call its turn after a text. If either lane has no eligible
 -- work, the existing fallback continues through the other work immediately.
 if last_voice is null or last_text>last_voice then
  ticket:=public.icash_issue_ready_voice_ticket();
  if ticket->>'token' is not null then return ticket;end if;
 end if;
 return public.icash_next_before_unstarted_sms_recovery();
end $function$;
revoke all on function public.icash_next_outreach_channel() from public,anon,authenticated;
grant execute on function public.icash_next_outreach_channel() to service_role;

do $patch$
declare d text;needle text:='return public.icash_next_before_unstarted_sms_recovery();';
begin
 d:=pg_get_functiondef('public.icash_next_before_owner_question()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Outreach scheduler entry changed';end if;
 execute replace(d,needle,'return public.icash_next_outreach_channel();');
end $patch$;
commit;

