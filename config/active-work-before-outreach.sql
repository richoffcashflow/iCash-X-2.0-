-- Keep active replies and due deal work ahead of new outreach volume.
-- Copy the original issuers without changing their gates, intervals or handlers.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
do $patch$
declare d text;item record;
begin
 for item in select * from (values
  ('icash_next_before_inventory()','9120ebea7bb49765c045d49cda1894d5'),
  ('icash_next_before_text_ai()','f9dd15acfe7bbeee9ff91360151cfd77'),
  ('icash_next_before_title_followup()','4cf5f422415e2846c032f7845fc49bae'),
  ('icash_next_outreach_channel()','98de2cbe53eaf7e22167a69735ffb0e1')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then
   raise exception 'Active-work priority prerequisite changed: %',item.signature;
  end if;
 end loop;
 d:=pg_get_functiondef('public.icash_next_before_inventory()'::regprocedure);
 d:=replace(d,'FUNCTION public.icash_next_before_inventory()','FUNCTION public.icash_issue_due_text_ai()');
 execute replace(d,'return public.icash_next_before_text_ai();','return null;');
 d:=pg_get_functiondef('public.icash_next_before_text_ai()'::regprocedure);
 d:=replace(d,'FUNCTION public.icash_next_before_text_ai()','FUNCTION public.icash_issue_due_title_followup()');
 execute replace(d,'return public.icash_next_before_title_followup();','return null;');
 d:=pg_get_functiondef('public.icash_next_before_title_followup()'::regprocedure);
 d:=replace(d,'FUNCTION public.icash_next_before_title_followup()','FUNCTION public.icash_issue_ready_fulfillment()');
 execute replace(d,'return public.icash_next_before_fulfillment();','return null;');
end $patch$;
revoke all on function public.icash_issue_due_text_ai() from public,anon,authenticated;
grant execute on function public.icash_issue_due_text_ai() to service_role;
create or replace function public.icash_next_before_inventory() returns jsonb
language plpgsql set search_path='' as $function$
declare ticket jsonb;
begin
 ticket:=public.icash_issue_due_text_ai();
 if ticket->>'token' is not null then return ticket;end if;
 return public.icash_next_before_text_ai();
end $function$;
revoke all on function public.icash_issue_due_title_followup() from public,anon,authenticated;
grant execute on function public.icash_issue_due_title_followup() to service_role;
create or replace function public.icash_next_before_text_ai() returns jsonb
language plpgsql set search_path='' as $function$
declare ticket jsonb;
begin
 ticket:=public.icash_issue_due_title_followup();
 if ticket->>'token' is not null then return ticket;end if;
 return public.icash_next_before_title_followup();
end $function$;
revoke all on function public.icash_issue_ready_fulfillment() from public,anon,authenticated;
grant execute on function public.icash_issue_ready_fulfillment() to service_role;
create or replace function public.icash_next_before_title_followup() returns jsonb
language plpgsql set search_path='' as $function$
declare ticket jsonb;
begin
 ticket:=public.icash_issue_ready_fulfillment();
 if ticket->>'token' is not null then return ticket;end if;
 return public.icash_next_before_fulfillment();
end $function$;
do $patch$
declare d text;needle text:=' select last_dispatch_at into last_voice from public.icash_voice_scheduler where id=1;';
begin
 d:=pg_get_functiondef('public.icash_next_outreach_channel()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Active-work router entry changed';end if;
 execute replace(d,needle,$new$
 ticket:=public.icash_issue_due_text_ai();
 if ticket->>'token' is not null then return ticket;end if;
 ticket:=public.icash_issue_due_title_followup();
 if ticket->>'token' is not null then return ticket;end if;
 ticket:=public.icash_issue_ready_fulfillment();
 if ticket->>'token' is not null then return ticket;end if;
$new$||needle);
end $patch$;
commit;
