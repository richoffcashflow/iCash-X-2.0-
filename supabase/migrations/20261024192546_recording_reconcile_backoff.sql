-- Old unresolved receipts must leave room for fresh reconciliation work.
-- Delay only confirmed-ended calls or attempts with no carrier identity;
-- known calls without an ended receipt retain prompt termination/credit checks.
-- This changes scheduling only: no receipt, hold, call, charge or lease is reset.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $backoff$
declare definition text;target regprocedure;needle text;replacement text;
begin
 target:=to_regprocedure('public.icash_finish_call_recording_work(uuid,uuid,text,text,uuid,text,jsonb)');
 if target is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid=target and p.prosecdef and p.prorettype='jsonb'::regtype and l.lanname='plpgsql'
   and p.proconfig @> array['search_path=""'])
  or has_function_privilege('anon',target,'execute') or has_function_privilege('authenticated',target,'execute')
  or not has_function_privilege('service_role',target,'execute')
  then raise exception 'Expected private recording reconciliation security contract';end if;
 definition:=pg_get_functiondef(target);
 needle:=$old$update public.icash_call_recordings set next_reconcile_at=t+interval '1 minute',last_error=p_payload->>'reason',$old$;
 replacement:=$new$update public.icash_call_recordings set next_reconcile_at=t+make_interval(secs=>case
     when r.call_sid is not null and r.call_ended_at is null then 60
     when r.reconcile_attempts<=3 then 60 when r.reconcile_attempts<=6 then 120
     when r.reconcile_attempts<=12 then 300 else 900 end),last_error=p_payload->>'reason',$new$;
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'Expected one unchanged recording retry schedule';end if;
 definition:=replace(definition,needle,replacement);
 -- A verified audio receipt can still lack its AI conversation identity.
 -- Back off that repeat work only after the exact carrier call is known ended.
 -- Read the row after the validated transition; preserve its null schedule when done.
 needle:=$old$update public.icash_call_recordings set reconcile_lease_token=null,reconcile_lease_expires_at=null,
    last_action='finish_reconcile',$old$;
 replacement:=$new$update public.icash_call_recordings as work set next_reconcile_at=case
     when p_outcome='available' and work.call_ended_at is not null and work.conversation_id is null and work.next_reconcile_at is not null
      then icash_recording_private.clock_now()+make_interval(secs=>case
       when work.reconcile_attempts<=3 then 60 when work.reconcile_attempts<=6 then 120
       when work.reconcile_attempts<=12 then 300 else 900 end)
     else work.next_reconcile_at end,reconcile_lease_token=null,reconcile_lease_expires_at=null,
    last_action='finish_reconcile',$new$;
 if array_length(string_to_array(definition,needle),1)<>2 then raise exception 'Expected one unchanged recording finish schedule';end if;
 definition:=replace(definition,needle,replacement);
 execute definition;
end $backoff$;
-- CREATE OR REPLACE preserves the existing owner, ACL, SECURITY DEFINER,
-- search_path, receipt validation and lease capability checks. Claiming is unchanged.
commit;
