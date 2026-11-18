-- A terminated request handler may lose both final status writes. Keep those
-- originals unknown; allow the existing three fresh, free inventory checks.
-- The migration runner owns the transaction and its history entry.
set local lock_timeout='500ms';
set local statement_timeout='8s';
do $repair$
declare
 signature text:='icash_research_private.capacity_source_before_credit(uuid,text)';
 d text; original text; patched text; policy jsonb;
 needle text:=$old$  and q.admitted and (
   (q.result='{"outcome":"unknown"}'::jsonb
    and q.finished_at>=q.created_at and q.finished_at<=now()-interval '5 minutes'
    and (h->>'completed_at')::timestamptz>=q.finished_at)
   or (q.result is null and q.finished_at is null
    and exists(select 1 from icash_research_private.export_capacity_automation where id=1 and missing_finish_enabled)
    and q.created_at>=b.created_at
    and q.created_at<=(h->>'expires_at')::timestamptz
    and (h->>'completed_at')::timestamptz>=q.created_at))
  and h->>'state'='held' and h->>'outcome'='held_for_reconciliation' and h->'issue_attempts'='1'::jsonb
  and (h->>'completed_at')::timestamptz<=now()-interval '5 minutes'
  and (h->>'expires_at')::timestamptz<=now()-interval '5 minutes'$old$;
 replacement text:=$new$  and q.admitted and h->'issue_attempts'='1'::jsonb
  and (
   ((
    (q.result='{"outcome":"unknown"}'::jsonb
     and q.finished_at>=q.created_at and q.finished_at<=now()-interval '5 minutes'
     and (h->>'completed_at')::timestamptz>=q.finished_at)
    or (q.result is null and q.finished_at is null
     and exists(select 1 from icash_research_private.export_capacity_automation where id=1 and missing_finish_enabled)
     and q.created_at>=b.created_at
     and q.created_at<=(h->>'expires_at')::timestamptz
     and (h->>'completed_at')::timestamptz>=q.created_at))
    and h->>'state'='held' and h->>'outcome'='held_for_reconciliation'
    and (h->>'completed_at')::timestamptz<=now()-interval '5 minutes'
    and (h->>'expires_at')::timestamptz<=now()-interval '5 minutes')
   or (
    -- Fifteen minutes beyond the exact capability's expiry exceeds the
    -- original automation route's 240-second hard handler limit. This is
    -- abandonment evidence, never a provider failure or zero-cost receipt.
    q.result is null and q.finished_at is null
    and exists(select 1 from icash_research_private.export_capacity_automation where id=1 and missing_finish_enabled)
    and q.created_at>=b.created_at
    and q.created_at<=(h->>'expires_at')::timestamptz
    and h->>'state'='consumed'
    and h->'completed_at'='null'::jsonb and h->'outcome'='null'::jsonb
    and (h->>'expires_at')::timestamptz<=now()-interval '15 minutes'
   )
  )$new$;
begin
 if not pg_try_advisory_xact_lock(hashtextextended('dealmachine:organization:owner-export',0)) then
  raise exception 'Owner export recovery is busy';
 end if;
 select function_hashes into strict policy from icash_research_private.dealmachine_credit_state where id=1 for update nowait;
 original:=pg_get_functiondef(signature::regprocedure);
 if md5(original)<>'835f7a90946f7d1061fbcd28f2ec71ac'
  or policy->>signature is distinct from md5(original)
  or not exists(select 1 from pg_proc where oid=signature::regprocedure
   and proowner='postgres'::regrole and not prosecdef and provolatile='s'
   and proconfig=array['search_path=""'] and proacl::text='{postgres=X/postgres}')
  or md5(pg_get_functiondef('icash_research_private.unknown_capacity_source_snapshot(uuid)'::regprocedure))<>'b28d1311c34d499153e1db7fa4cd6908'
 then raise exception 'Abandoned export recovery predecessor changed';end if;
 if (length(original)-length(replace(original,needle,'')))<>length(needle) then
  raise exception 'Abandoned export recovery clause changed';
 end if;
 patched:=replace(original,needle,replacement);
 execute patched;
 d:=pg_get_functiondef(signature::regprocedure);
 if d<>patched then raise exception 'Abandoned export recovery readback changed';end if;
 update icash_research_private.dealmachine_credit_state
 set function_hashes=jsonb_set(function_hashes,array[signature],to_jsonb(md5(d))) where id=1;
 if not exists(select 1 from icash_research_private.dealmachine_credit_state where id=1
  and function_hashes= jsonb_set(policy,array[signature],to_jsonb(md5(d)))) then
  raise exception 'Abandoned export recovery policy readback changed';
 end if;
end $repair$;
