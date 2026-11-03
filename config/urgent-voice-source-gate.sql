-- Ordinary first calls cannot satisfy the urgent source CASE. Exclude them
-- before expensive contact checks using the existing source/ready indexes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text:=E' where v.state=''ready'' and v.due_at<=now()\n';at integer;
begin
 d:=pg_get_functiondef('public.icash_issue_ready_voice_ticket()'::regprocedure);
 if md5(d)<>'5d1f4bb69ab6e0e49eb49b3cc9fdce54' then
  raise exception 'Urgent voice source gate prerequisite changed';
 end if;
 at:=strpos(d,needle);
 if at=0 or at>=strpos(d,' if not found then')
  or (length(d)-length(replace(d,needle,'')))<>2*length(needle) then
  raise exception 'Urgent voice source gate insertion point changed';
 end if;
 -- Retain the complete urgent CASE, all final guards, row locks and ordering.
 -- The ordinary-account fairness branch is byte-for-byte unchanged.
 execute overlay(d placing needle||E' and (v.sms_source_message_id is not null or v.callback_id is not null or v.cancellation_notice_id is not null)\n'
  from at for length(needle));
end $patch$;
commit;
