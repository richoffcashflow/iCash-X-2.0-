-- Gate-only costs follow the immutable entry policy, not the decline state alone.
-- Patch one verified clause in the installed function, preserving concurrent changes,
-- privileges, security settings, actual carrier costs, caps and exact replay checks.
-- No existing usage is settled or rewritten by this configuration change.
begin;
do $gate_policy$
declare definition text; target regprocedure;
 old_clause text:=$old$or (r.state='declined' and p_receipt->'speechGatherUsed' is distinct from 'true'::jsonb)$old$;
 new_clause text:=$new$or r.entry_policy is null or r.entry_policy not in ('spoken_v1','direct_recorded_v1')
  or p_receipt->'speechGatherUsed' is distinct from to_jsonb(r.entry_policy='spoken_v1' and (r.state='declined' or p_receipt->>'status'='completed'))$new$;
begin
 target:=to_regprocedure('public.icash_settle_unstarted_recorded_call(uuid,uuid,text,jsonb,jsonb,text)');
 if target is null or not exists(select 1 from pg_proc p join pg_language l on l.oid=p.prolang
  where p.oid=target and p.prosecdef and p.prorettype='jsonb'::regtype and l.lanname='plpgsql'
   and p.proconfig @> array['search_path=""']) then raise exception 'Expected gate settlement function security contract';end if;
 if not exists(select 1 from pg_attribute where attrelid='public.icash_call_recordings'::regclass
  and attname='entry_policy' and atttypid='text'::regtype and not attisdropped) then raise exception 'Expected immutable recording entry policy';end if;
 definition:=pg_get_functiondef(target);
 if (length(definition)-length(replace(definition,old_clause,'')))<>length(old_clause)
  or position(new_clause in definition)>0 then raise exception 'Expected one unchanged gate speech validation clause';end if;
 execute replace(definition,old_clause,new_clause);
end $gate_policy$;
commit;
