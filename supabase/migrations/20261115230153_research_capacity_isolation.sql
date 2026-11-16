-- Avoid global voice-capacity work when this account has no possible introduction.
-- This necessary local hint grants no authority; the complete existing checks remain.
-- The release runner owns the enclosing schema-and-ledger transaction.
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(726341927);

do $patch$
declare d text;before_start text;after_start text;before_end text;after_end text;
begin
 d:=pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure);
 if md5(d)<>'fe4b99a1d27ddae7b63f8d8eadb9f9ea' then
  raise exception 'Research capacity isolation prerequisite changed';
 end if;
 before_start:=' select (case when public.icash_outgoing_voice_capacity_open() then ';
 after_start:=$replacement$ select (case when exists(
  select 1 from public.icash_voice_jobs possible
  where possible.account_id=p_account
   and (possible.state in ('ready','issued') or (possible.state='held' and possible.outcome='prospecting_budget_held'))
   and possible.callback_id is null and possible.sms_source_message_id is null and possible.cancellation_notice_id is null
   and possible.provider_call_sid is null and possible.conversation_id is null and possible.operation_key is null
   and possible.due_at<=now()
 ) then case when public.icash_outgoing_voice_capacity_open() then $replacement$;
 before_end:=') else false end) or (';
 after_end:=') else false end else false end) or (';
 if (length(d)-length(replace(d,before_start,'')))<>length(before_start)
  or (length(d)-length(replace(d,before_end,'')))<>length(before_end) then
  raise exception 'Research capacity isolation source shape changed';
 end if;
 execute replace(replace(d,before_start,after_start),before_end,after_end);
end $patch$;

-- Account equality and due time must be index conditions. A NULL-operation
-- index alone still scans unrelated jobs before rejecting an empty account.
create index icash_voice_jobs_possible_introduction
 on public.icash_voice_jobs(account_id,due_at)
 where (state in ('ready','issued') or (state='held' and outcome='prospecting_budget_held'))
  and callback_id is null and sms_source_message_id is null and cancellation_notice_id is null
  and provider_call_sid is null and conversation_id is null and operation_key is null;
