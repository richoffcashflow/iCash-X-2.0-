-- Ended calls with missing receipts stay visible, without minute-by-minute loops.
-- Active-call termination, deletion deadlines, identity checks and charges remain intact.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare definition text;
 retry_clause text:=$old$set next_reconcile_at=t+interval '1 minute',last_error=p_payload->>'reason',$old$;
 finish_clause text:=$old$set reconcile_lease_token=null,reconcile_lease_expires_at=null,
    last_action='finish_reconcile'$old$;
begin
 definition:=pg_get_functiondef('public.icash_finish_call_recording_work(uuid,uuid,text,text,uuid,text,jsonb)'::regprocedure);
 if (length(definition)-length(replace(definition,retry_clause,'')))<>length(retry_clause)
  or (length(definition)-length(replace(definition,finish_clause,'')))<>length(finish_clause) then
  raise exception 'Recording reconciliation prerequisite changed';
 end if;
 definition:=replace(definition,retry_clause,$new$set next_reconcile_at=t+case when call_ended_at is null then interval '1 minute'
     else make_interval(secs=>least(3600,60*power(2,least(6,greatest(0,reconcile_attempts-1))))::integer) end,
    last_error=p_payload->>'reason',$new$);
 definition:=replace(definition,finish_clause,$new$set reconcile_lease_token=null,reconcile_lease_expires_at=null,
    next_reconcile_at=case when call_ended_at is not null and conversation_id is null and next_reconcile_at is not null
      then greatest(next_reconcile_at,t+make_interval(secs=>least(3600,60*power(2,least(6,greatest(0,reconcile_attempts-1))))::integer))
      else next_reconcile_at end,
    last_action='finish_reconcile'$new$);
 execute definition;
end $patch$;
commit;
