-- Settle due original call/signing receipts before scheduling more outreach.
-- Preserve every original polling gate, interval, attempt bound and provider ID.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);
do $patch$
declare d text;item record;
begin
 for item in select * from (values
  ('icash_next_before_signing()','fd380071b6c14ae15a42f12271844c2e'),
  ('icash_next_before_voice_dispatch()','fbedbaa93535a9b824fb22198b586086'),
  ('icash_next_outreach_channel()','6b5a294ef6486fb0b8a4da111959989c')
 ) expected(signature,checksum) loop
  if md5(pg_get_functiondef(('public.'||item.signature)::regprocedure))<>item.checksum then
   raise exception 'Receipt priority prerequisite changed: %',item.signature;
  end if;
 end loop;
 d:=pg_get_functiondef('public.icash_next_before_signing()'::regprocedure);
 d:=replace(d,'FUNCTION public.icash_next_before_signing()','FUNCTION public.icash_issue_due_voice_result()');
 execute replace(d,'return public.icash_next_acquisition();','return null;');
 d:=pg_get_functiondef('public.icash_next_before_voice_dispatch()'::regprocedure);
 d:=replace(d,'FUNCTION public.icash_next_before_voice_dispatch()','FUNCTION public.icash_issue_due_signing_result()');
 execute replace(d,'return public.icash_next_before_signing();','return null;');
end $patch$;
revoke all on function public.icash_issue_due_voice_result(),public.icash_issue_due_signing_result() from public,anon,authenticated;
grant execute on function public.icash_issue_due_voice_result(),public.icash_issue_due_signing_result() to service_role;

create or replace function public.icash_next_before_signing() returns jsonb
language plpgsql set search_path='' as $function$
declare ticket jsonb;
begin
 ticket:=public.icash_issue_due_voice_result();
 if ticket->>'token' is not null then return ticket;end if;
 return public.icash_next_acquisition();
end $function$;
create or replace function public.icash_next_before_voice_dispatch() returns jsonb
language plpgsql set search_path='' as $function$
declare ticket jsonb;
begin
 ticket:=public.icash_issue_due_signing_result();
 if ticket->>'token' is not null then return ticket;end if;
 return public.icash_next_before_signing();
end $function$;

do $patch$
declare d text;needle text:=' perform pg_advisory_xact_lock(726341927);';
begin
 d:=pg_get_functiondef('public.icash_next_outreach_channel()'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))/length(needle)<>1 then raise exception 'Outreach receipt entry changed';end if;
 execute replace(d,needle,needle||$new$
 -- Original-result reads release only receipt-verified work; no resend/redial.
 ticket:=public.icash_issue_due_signing_result();
 if ticket->>'token' is not null then return ticket;end if;
 ticket:=public.icash_issue_due_voice_result();
 if ticket->>'token' is not null then return ticket;end if;
$new$);
end $patch$;
commit;
