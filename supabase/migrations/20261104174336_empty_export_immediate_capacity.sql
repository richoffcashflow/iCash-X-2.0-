-- The exact HTTP400 rejection is saved before the request is marked finished.
-- Its handler has no export ID to recover and cannot submit another POST.
-- Do not occupy global capacity for another five minutes after that proof.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
do $patch$
declare d text;patched text;prior text;
 needle text:='q.finished_at>=q.created_at and q.finished_at<=now()-interval ''5 minutes''';
 replacement text:='q.finished_at>=q.created_at and q.finished_at<=now()';
begin
 d:=pg_get_functiondef('icash_research_private.capacity_source_policy(uuid,text)'::regprocedure);
 prior:=pg_get_functiondef('icash_research_private.capacity_source_before_empty(uuid,text)'::regprocedure);
 if md5(d)<>'8f433a6eb4aaf8ef0ccf1b883f1fe132' or md5(prior)<>'45ba0074ed0c1d307383a9822d8f8cf8'
  or (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Immediate empty export prerequisite changed';
 end if;
 patched:=replace(d,needle,replacement);
 execute patched;
 if pg_get_functiondef('icash_research_private.capacity_source_policy(uuid,text)'::regprocedure)<>patched
  or pg_get_functiondef('icash_research_private.capacity_source_before_empty(uuid,text)'::regprocedure)<>prior then
  raise exception 'Immediate empty export verification failed';
 end if;
end $patch$;
commit;
