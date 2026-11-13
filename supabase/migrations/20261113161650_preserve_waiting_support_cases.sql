begin;
set local lock_timeout='5s';
set local statement_timeout='30s';

-- Waiting on a customer is not evidence of recovery. Preserve the existing
-- maintenance RPC for old/new web callers, but remove its age-only mutations.
-- Explicit operator/customer outcome workflows retain their own guards.
-- No historical status, timestamp, message, notification or queue flag changes.
do $patch$
declare
 source text;
 definition text;
 replacement constant text:=$body$
begin
 return jsonb_build_object('accountChats',0,'guestChats',0);
end $body$;
begin
 select prosrc,pg_get_functiondef(oid) into source,definition
 from pg_proc where oid='public.icash_close_inactive_support()'::regprocedure;
 if source=replacement then return;end if;
 if md5(source)<>'2ae161356daacac17f779cfee38acb4c' then
  raise exception 'Support inactivity source changed; review the current function before replacement';
 end if;
 -- Replacing only the reviewed body preserves function identity, owner, ACLs,
 -- language, invoker security and its empty search_path.
 execute replace(definition,source,replacement);
end $patch$;
commit;
