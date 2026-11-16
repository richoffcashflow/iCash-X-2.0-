CREATE OR REPLACE FUNCTION public.icash_run_deal_supervisor()
 RETURNS jsonb
 LANGUAGE plpgsql
 SET search_path TO ''
 SET statement_timeout TO '15s'
 SET lock_timeout TO '1s'
AS $function$
declare c record;result jsonb;processed integer:=0;repairs integer:=0;errors integer:=0;
begin
 if not exists(select 1 from public.icash_deal_supervisor_settings where id=1 and enabled) then
  return jsonb_build_object('status','disabled','processed',0,'repaired',0,'errors',0);end if;
 if not pg_try_advisory_xact_lock(726341972) then return jsonb_build_object('status','busy','processed',0,'repaired',0,'errors',0);end if;
 -- Reserve capacity for overdue checks as well as fresh events. No full draft scan.
 for c in with due as materialized (select account_id,deal_id from public.icash_deal_supervisor where next_check_at<=now() order by next_check_at,deal_id limit 10),
  events as materialized (select id,account_id,deal_id from public.icash_deal_supervisor_events order by id limit 100),
  fresh as (select account_id,deal_id from events group by account_id,deal_id order by min(id) limit 15),
  candidates as (select account_id,deal_id from due union select account_id,deal_id from fresh)
  select candidate.*,array(select e.id from events e where e.account_id=candidate.account_id and e.deal_id=candidate.deal_id) event_ids from candidates candidate loop
  begin
   result:=public.icash_supervise_deal(c.account_id,c.deal_id);
   repairs:=repairs+coalesce((result->>'repaired')::integer,0);processed:=processed+1;
  exception when others then
   errors:=errors+1;
   insert into public.icash_deal_supervisor(account_id,deal_id,state,milestone,reason,next_step,last_error,next_check_at)
   values(c.account_id,c.deal_id,'blocked','review','supervisor_check_failed','Recheck the original workflow; no provider action was retried.',sqlstate,now()+interval '5 minutes')
   on conflict(deal_id) do update set last_error=excluded.last_error,next_check_at=excluded.next_check_at,checked_at=now() where icash_deal_supervisor.account_id=excluded.account_id;
  end;
  -- Sequence order is not commit order: a late-committing lower ID must survive.
  delete from public.icash_deal_supervisor_events where account_id=c.account_id and deal_id=c.deal_id and id=any(c.event_ids);
 end loop;
 return jsonb_build_object('status','checked','processed',processed,'repaired',repairs,'errors',errors);
end $function$
;
