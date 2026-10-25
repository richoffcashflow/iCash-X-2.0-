-- Prioritize a first call only while the provider has room to start it.
-- A saturated or uncertain call queue must not freeze new SMS/research work.
-- Recipient, wallet, prospecting, inventory and provider-outcome holds remain.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;
 old_start text:=' select (public.icash_outreach_voice_current(p_account) and exists(';
 new_start text:=' select (case when public.icash_outgoing_voice_capacity_open() then public.icash_outreach_voice_current(p_account) and exists(';
 old_end text:=' )) or (public.icash_outreach_sms_current(p_account) and exists(';
 new_end text:=' ) else false end) or (public.icash_outreach_sms_current(p_account) and exists(';
begin
 definition:=pg_get_functiondef('public.icash_research_waiting_on_outreach(uuid)'::regprocedure);
 if (length(definition)-length(replace(definition,old_start,'')))<>length(old_start)
  or (length(definition)-length(replace(definition,old_end,'')))<>length(old_end) then
  raise exception 'Research voice-capacity priority prerequisite changed';
 end if;
 execute replace(replace(definition,old_start,new_start),old_end,new_end);
end $patch$;
commit;
