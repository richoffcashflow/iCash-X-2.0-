-- The current free property preview includes licensed:0 alongside the four
-- existing credit counters. Accept only these two explicit zero-credit shapes.
-- Preserve the complete original receipt and every other recorder predicate.
begin;
set local lock_timeout='5s';
set local statement_timeout='30s';
do $patch$
declare d text;needle text;
begin
 d:=pg_get_functiondef('public.icash_record_empty_owner_preview(uuid,uuid,uuid,jsonb,jsonb)'::regprocedure);
 if md5(d)<>'e5fbeb7c2deb5efd30072317ef39e607' then raise exception 'Empty owner preview credit-shape prerequisite changed';end if;
 needle:=$old$  or p_preview->'credits' is distinct from '{"used":0,"people":0,"properties":0,"deduplicated":0}'::jsonb$old$;
 if (length(d)-length(replace(d,needle,'')))<>length(needle) then raise exception 'Empty owner preview credit predicate changed';end if;
 execute replace(d,needle,$new$  or (p_preview->'credits' is distinct from '{"used":0,"people":0,"properties":0,"deduplicated":0}'::jsonb
   and p_preview->'credits' is distinct from '{"used":0,"people":0,"properties":0,"deduplicated":0,"licensed":0}'::jsonb)$new$);
end $patch$;
commit;
