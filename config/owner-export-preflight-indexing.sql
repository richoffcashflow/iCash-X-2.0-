-- Production lists sometimes remained unindexed after 39–41 seconds; exact
-- baselines and successful exports followed at 86–94 seconds. Give new lists
-- 90 seconds before their one-use count. Preserve every prior claim/receipt.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text:='next_check_at=clock_timestamp()+interval ''30 seconds''';
begin
 d:=pg_get_functiondef('public.icash_record_owner_preflight(uuid,uuid,text,jsonb)'::regprocedure);
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Owner preflight indexing prerequisite changed';end if;
 execute replace(d,needle,'next_check_at=clock_timestamp()+interval ''90 seconds''');
end $patch$;
commit;
