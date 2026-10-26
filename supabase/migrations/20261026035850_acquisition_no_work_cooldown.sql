-- An account that cannot issue work must yield its scheduler turn. Rechecking
-- the same low-spend holds every five seconds starves affordable accounts.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;
 old_block text:=$old$ update public.icash_discovery_configs set next_run_at=now()+case when allowance>0 then interval '5 seconds' else interval '60 seconds' end where account_id=c.account_id;
 if c.exhausted or backlog>=c.max_open_prospects or not public.icash_outbound_search_due(c.account_id) then continue;end if;$old$;
begin
 d:=pg_get_functiondef('public.icash_next_acquisition()'::regprocedure);
 if (length(d)-length(replace(d,old_block,'')))<>length(old_block) then
  raise exception 'Acquisition no-work cooldown prerequisite changed';
 end if;
 execute replace(d,old_block,$new$ if c.exhausted or backlog>=c.max_open_prospects or not public.icash_outbound_search_due(c.account_id) then
  update public.icash_discovery_configs set next_run_at=now()+interval '60 seconds' where account_id=c.account_id;
  continue;
 end if;
 update public.icash_discovery_configs set next_run_at=now()+interval '5 seconds' where account_id=c.account_id;$new$);
end $patch$;
commit;
