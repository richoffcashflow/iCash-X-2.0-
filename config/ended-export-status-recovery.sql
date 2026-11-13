-- An ended exact handler can outlive a failed best-effort request-status write.
-- Keep that missing evidence missing; require the existing fresh free probes.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
select pg_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0));
do $check$
begin
 if md5(pg_get_functiondef('icash_research_private.capacity_source_policy(uuid,text)'::regprocedure))<>'8e97fad65ff7522bd13b0b197aa72c01' then
  raise exception 'Ended export status recovery predecessor changed';
 end if;
end $check$;
alter table icash_research_private.export_capacity_automation
 add column missing_finish_enabled boolean not null default false;
do $patch$
declare d text;needle text;replacement text;
begin
 d:=pg_get_functiondef('icash_research_private.capacity_source_policy(uuid,text)'::regprocedure);
 needle:=$old$and q.admitted and q.result='{"outcome":"unknown"}'::jsonb
  and q.finished_at>=q.created_at and q.finished_at<=now()-interval '5 minutes'
  and h->>'state'='held' and h->>'outcome'='held_for_reconciliation' and h->'issue_attempts'='1'::jsonb
  and (h->>'completed_at')::timestamptz>=q.finished_at$old$;
 replacement:=$new$and q.admitted and (
   (q.result='{"outcome":"unknown"}'::jsonb
    and q.finished_at>=q.created_at and q.finished_at<=now()-interval '5 minutes'
    and (h->>'completed_at')::timestamptz>=q.finished_at)
   or (q.result is null and q.finished_at is null
    and exists(select 1 from icash_research_private.export_capacity_automation where id=1 and missing_finish_enabled)
    and q.created_at>=b.created_at
    and q.created_at<=(h->>'expires_at')::timestamptz
    and (h->>'completed_at')::timestamptz>=q.created_at))
  and h->>'state'='held' and h->>'outcome'='held_for_reconciliation' and h->'issue_attempts'='1'::jsonb$new$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then
  raise exception 'Ended export status recovery source changed';
 end if;
 d:=replace(d,needle,replacement);execute d;
 if pg_get_functiondef('icash_research_private.capacity_source_policy(uuid,text)'::regprocedure)<>d then
  raise exception 'Ended export status recovery verification failed';
 end if;
end $patch$;
notify pgrst,'reload schema';
commit;
